import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Device, DeviceDocument } from './schemas/device.schema'
import { Model, Types } from 'mongoose'
import * as firebaseAdmin from 'firebase-admin'
import {
  ReceivedSMSDTO,
  RegisterDeviceInputDTO,
  RetrieveSMSDTO,
  SendBulkSMSInputDTO,
  SendSMSInputDTO,
  UpdateSMSStatusDTO,
} from './gateway.dto'
import { User } from '../users/schemas/user.schema'
import { AuthService } from '../auth/auth.service'
import { SMS } from './schemas/sms.schema'
import { SMSType } from './sms-type.enum'
import { SMSBatch } from './schemas/sms-batch.schema'
import { BatchResponse, Message } from 'firebase-admin/messaging'
import { WebhookEvent } from '../webhook/webhook-event.enum'
import { WebhookService } from '../webhook/webhook.service'
import { BillingService } from '../billing/billing.service'
import { SmsQueueService } from './queue/sms-queue.service'
import { UsagePlan, UsagePlanDocument } from './schemas/usage-plan.schema'
import { DeviceUsageCalculatorService } from './services/device-usage-calculator.service'
import { PREDEFINED_PLANS } from './constants/usage-plan-templates'

@Injectable()
export class GatewayService {
  constructor(
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
    @InjectModel(SMS.name) private smsModel: Model<SMS>,
    @InjectModel(SMSBatch.name) private smsBatchModel: Model<SMSBatch>,
    @InjectModel(UsagePlan.name) private usagePlanModel: Model<UsagePlanDocument>,
    private authService: AuthService,
    private webhookService: WebhookService,
    private billingService: BillingService,
    private smsQueueService: SmsQueueService,
    private usageCalculator: DeviceUsageCalculatorService,
  ) {}

  private async getUsagePlanById(planId: string | Types.ObjectId): Promise<UsagePlan | null> {
    if (typeof planId === 'string' && planId.startsWith('template_')) {
      const templatePlan = PREDEFINED_PLANS.find(template => template._id === planId)
      return templatePlan ? templatePlan as any : null
    }

    if (Types.ObjectId.isValid(planId as string)) {
      return await this.usagePlanModel.findById(planId).exec()
    }

    return null
  }

  async registerDevice(
    input: RegisterDeviceInputDTO,
    user: User,
  ): Promise<any> {
    const device = await this.deviceModel.findOne({
      user: user._id,
      model: input.model,
      buildId: input.buildId,
    })

    if (device && device.appVersionCode <= 11) {
      return await this.updateDevice(device._id.toString(), {
        ...input,
        enabled: true,
      })
    } else {
      return await this.deviceModel.create({ ...input, user })
    }
  }

  async getDevicesForUser(user: User): Promise<any> {
    const devices = await this.deviceModel
      .find({ user: user._id })
      .exec()

    // Enrich devices with real-time rolling window usage stats
    const enrichedDevices = await Promise.all(
      devices.map(async (device) => {
        const deviceObj = device.toObject()

        // Calculate current window usage if device has a usage plan
        if (device.usagePlan) {
          try {
            const stats = await this.usageCalculator.getDeviceUsageStats(device)

            return {
              ...deviceObj,
              // Add calculated fields for frontend (backward compatible)
              messages_sent_today: stats.messagesSentInWindow,
              usage_window_minutes: stats.windowMinutes,
              usage_percentage: stats.usagePercentage,
              estimated_cooldown_end: stats.estimatedCooldownEndTime,
            }
          } catch (error) {
            console.error(`Failed to calculate usage for device ${device._id}:`, error)
            // Return device without calculated stats if calculation fails
            return deviceObj
          }
        }

        return deviceObj
      })
    )

    return enrichedDevices
  }

  async getDeviceById(deviceId: string): Promise<any> {
    return await this.deviceModel.findById(deviceId)
  }

  async updateDevice(
    deviceId: string,
    input: RegisterDeviceInputDTO,
  ): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    if (input.enabled !== false) {
      input.enabled = true;
    }

    // Phone number change detection
    const updateData: any = { ...input }
    if (input.phoneNumber && device.phoneNumber && input.phoneNumber !== device.phoneNumber) {
      updateData.previousPhoneNumber = device.phoneNumber
      updateData.phoneNumberLastUpdated = new Date()
      console.log(`Phone number changed for device ${deviceId}: ${device.phoneNumber} -> ${input.phoneNumber}`)
    } else if (input.phoneNumber && !device.phoneNumber) {
      updateData.phoneNumberLastUpdated = new Date()
      console.log(`Phone number set for device ${deviceId}: ${input.phoneNumber}`)
    }

    // Same for phoneNumber2 (dual-SIM)
    if (input.phoneNumber2 && device.phoneNumber2 && input.phoneNumber2 !== device.phoneNumber2) {
      updateData.phoneNumberLastUpdated = new Date()
      console.log(`Phone number 2 changed for device ${deviceId}: ${device.phoneNumber2} -> ${input.phoneNumber2}`)
    }

    return await this.deviceModel.findByIdAndUpdate(
      deviceId,
      { $set: updateData },
      { new: true },
    )
  }

  async deleteDevice(deviceId: string): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      )
    }

    return {}
    // return await this.deviceModel.findByIdAndDelete(deviceId)
  }

  async sendSMS(deviceId: string, smsData: SendSMSInputDTO, campaignId?: string): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device?.enabled) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist or is not enabled',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Check if device is on cooldown (rolling window based)
    if (device.is_on_cooldown) {
      // Get current usage stats to estimate cooldown end
      const stats = await this.usageCalculator.getDeviceUsageStats(device)
      const cooldownMessage = stats.estimatedCooldownEndTime
        ? `Device is on cooldown until approximately ${stats.estimatedCooldownEndTime.toLocaleString()}`
        : 'Device is on cooldown. Please wait before sending more messages.'

      throw new HttpException(
        {
          success: false,
          error: cooldownMessage,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const message = smsData.message || smsData.smsBody
    const recipients = smsData.recipients || smsData.receivers

    if (!message) {
      throw new HttpException(
        {
          success: false,
          error: 'Message cannot be blank',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new HttpException(
        {
          success: false,
          error: 'Invalid recipients',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.billingService.canPerformAction(
      device.user.toString(),
      'send_sms',
      recipients.length,
    )

    // TODO: Implement a queue to send the SMS if recipients are too many

    let smsBatch: SMSBatch

    try {
      smsBatch = await this.smsBatchModel.create({
        device: device._id,
        message,
        recipientCount: recipients.length,
        recipientPreview: this.getRecipientsPreview(recipients),
        status: 'pending',
      })
    } catch (e) {
      throw new HttpException(
        {
          success: false,
          error: 'Failed to create SMS batch',
          additionalInfo: e,
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const fcmMessages: Message[] = []

    for (const recipient of recipients) {
      const sms = await this.smsModel.create({
        device: device._id,
        smsBatch: smsBatch._id,
        message: message,
        type: SMSType.SENT,
        recipient,
        requestedAt: new Date(),
        status: 'pending',
        campaignId: campaignId, // Include campaignId if provided
      })
      const updatedSMSData = {
        smsId: sms._id,
        smsBatchId: smsBatch._id,
        message,
        recipients: [recipient],

        // Legacy fields to be removed in the future
        smsBody: message,
        receivers: [recipient],
      }
      const stringifiedSMSData = JSON.stringify(updatedSMSData)

      const fcmMessage: Message = {
        data: {
          smsData: stringifiedSMSData,
        },
        token: device.fcmToken,
        android: {
          priority: 'high',
        },
      }
      fcmMessages.push(fcmMessage)
    }

    // Check if we should use the queue
    if (this.smsQueueService.isQueueEnabled()) {
      try {
        // Update batch status to processing
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'processing' },
        })

        // Add to queue
        await this.smsQueueService.addSendSmsJob(
          deviceId,
          fcmMessages,
          smsBatch._id.toString(),
        )

        return {
          success: true,
          message: 'SMS added to queue for processing',
          smsBatchId: smsBatch._id,
          recipientCount: recipients.length,
        }
      } catch (e) {
        // Update batch status to failed
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'failed', error: e.message },
        })

        // Update all SMS in batch to failed
        await this.smsModel.updateMany(
          { smsBatch: smsBatch._id },
          { $set: { status: 'failed', error: e.message } },
        )

        throw new HttpException(
          {
            success: false,
            error: 'Failed to add SMS to queue',
            additionalInfo: e,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }
    }

    try {
      const response = await firebaseAdmin.messaging().sendEach(fcmMessages)

      console.log(response)

      if (response.successCount === 0) {
        throw new HttpException(
          {
            success: false,
            error: 'Failed to send SMS',
            additionalInfo: response,
          },
          HttpStatus.BAD_REQUEST,
        )
      }

      // Update device: increment total count and last message timestamp
      this.deviceModel
        .findByIdAndUpdate(deviceId, {
          $inc: {
            sentSMSCount: response.successCount,
          },
          $set: {
            lastMessageSentAt: new Date(),
          },
        })
        .exec()
        .then(async (updatedDevice) => {
          if (updatedDevice) {
            // Check if device needs tier progression based on rolling window usage
            await this.checkTierProgression(updatedDevice._id)
          }
        })
        .catch((e) => {
          console.log('Failed to update device counters')
          console.log(e)
        })

      this.smsBatchModel
        .findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'completed' },
        })
        .exec()
        .catch((e) => {
          console.error('failed to update sms batch status to completed')
        })

      return response
    } catch (e) {
      this.smsBatchModel
        .findByIdAndUpdate(smsBatch._id, {
          $set: { status: 'failed', error: e.message },
        })
        .exec()
        .catch((e) => {
          console.error('failed to update sms batch status to failed')
        })
      throw new HttpException(
        {
          success: false,
          error: 'Failed to send SMS',
          additionalInfo: e,
        },
        HttpStatus.BAD_REQUEST,
      )
    }
  }

  async sendBulkSMS(deviceId: string, body: SendBulkSMSInputDTO): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device?.enabled) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist or is not enabled',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Check if device is on cooldown (rolling window based)
    if (device.is_on_cooldown) {
      // Get current usage stats to estimate cooldown end
      const stats = await this.usageCalculator.getDeviceUsageStats(device)
      const cooldownMessage = stats.estimatedCooldownEndTime
        ? `Device is on cooldown until approximately ${stats.estimatedCooldownEndTime.toLocaleString()}`
        : 'Device is on cooldown. Please wait before sending more messages.'

      throw new HttpException(
        {
          success: false,
          error: cooldownMessage,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    if (
      !Array.isArray(body.messages) ||
      body.messages.length === 0 ||
      body.messages.map((m) => m.recipients).flat().length === 0
    ) {
      throw new HttpException(
        {
          success: false,
          error: 'Invalid message list',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.billingService.canPerformAction(
      device.user.toString(),
      'bulk_send_sms',
      body.messages.map((m) => m.recipients).flat().length,
    )

    const { messageTemplate, messages } = body

    const smsBatch = await this.smsBatchModel.create({
      device: device._id,
      message: messageTemplate,
      recipientCount: messages
        .map((m) => m.recipients.length)
        .reduce((a, b) => a + b, 0),
      recipientPreview: this.getRecipientsPreview(
        messages.map((m) => m.recipients).flat(),
      ),
      status: 'pending',
    })

    const fcmMessages: Message[] = []

    for (const smsData of messages) {
      const message = smsData.message
      const recipients = smsData.recipients

      if (!message) {
        continue
      }

      if (!Array.isArray(recipients) || recipients.length === 0) {
        continue
      }

      for (const recipient of recipients) {
        const sms = await this.smsModel.create({
          device: device._id,
          smsBatch: smsBatch._id,
          message: message,
          type: SMSType.SENT,
          recipient,
          requestedAt: new Date(),
          status: 'pending',
        })
        const updatedSMSData = {
          smsId: sms._id,
          smsBatchId: smsBatch._id,
          message,
          recipients: [recipient],

          // Legacy fields to be removed in the future
          smsBody: message,
          receivers: [recipient],
        }
        const stringifiedSMSData = JSON.stringify(updatedSMSData)

        const fcmMessage: Message = {
          data: {
            smsData: stringifiedSMSData,
          },
          token: device.fcmToken,
          android: {
            priority: 'high',
          },
        }
        fcmMessages.push(fcmMessage)
      }
    }

    // Check if we should use the queue
    if (this.smsQueueService.isQueueEnabled()) {
      try {
        // Add to queue
        await this.smsQueueService.addSendSmsJob(
          deviceId,
          fcmMessages,
          smsBatch._id.toString(),
        )

        return {
          success: true,
          message: 'Bulk SMS added to queue for processing',
          smsBatchId: smsBatch._id,
          recipientCount: messages.map((m) => m.recipients).flat().length,
        }
      } catch (e) {
        // Update batch status to failed
        await this.smsBatchModel.findByIdAndUpdate(smsBatch._id, {
          $set: {
            status: 'failed',
            error: e.message,
            successCount: 0,
            failureCount: fcmMessages.length,
          },
        })

        // Update all SMS in batch to failed
        await this.smsModel.updateMany(
          { smsBatch: smsBatch._id },
          { $set: { status: 'failed', error: e.message } },
        )

        throw new HttpException(
          {
            success: false,
            error: 'Failed to add bulk SMS to queue',
            additionalInfo: e,
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        )
      }
    }

    const fcmMessagesBatches = fcmMessages.map((m) => [m])
    const fcmResponses: BatchResponse[] = []

    for (const batch of fcmMessagesBatches) {
      try {
        const response = await firebaseAdmin.messaging().sendEach(batch)

        console.log(response)
        fcmResponses.push(response)

        this.deviceModel
          .findByIdAndUpdate(deviceId, {
            $inc: {
              sentSMSCount: response.successCount,
            },
            $set: {
              lastMessageSentAt: new Date(),
            },
          })
          .exec()
          .then(async (updatedDevice) => {
            if (updatedDevice) {
              // Check if device needs tier progression based on rolling window usage
              await this.checkTierProgression(updatedDevice._id)
            }
          })
          .catch((e) => {
            console.log('Failed to update device counters')
            console.log(e)
          })

        this.smsBatchModel
          .findByIdAndUpdate(smsBatch._id, {
            $set: { status: 'completed' },
          })
          .exec()
          .catch((e) => {
            console.error('failed to update sms batch status to completed')
          })
      } catch (e) {
        console.log('Failed to send SMS: FCM')
        console.log(e)

        this.smsBatchModel
          .findByIdAndUpdate(smsBatch._id, {
            $set: { status: 'failed', error: e.message },
          })
          .exec()
          .catch((e) => {
            console.error('failed to update sms batch status to failed')
          })
      }
    }

    const successCount = fcmResponses.reduce(
      (acc, m) => acc + m.successCount,
      0,
    )
    const failureCount = fcmResponses.reduce(
      (acc, m) => acc + m.failureCount,
      0,
    )
    const response = {
      success: successCount > 0,
      successCount,
      failureCount,
      fcmResponses,
    }
    return response
  }

  async receiveSMS(deviceId: string, dto: ReceivedSMSDTO): Promise<any> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    if (
      (!dto.receivedAt && !dto.receivedAtInMillis) ||
      !dto.sender ||
      !dto.message
    ) {
      console.log('Invalid received SMS data')
      throw new HttpException(
        {
          success: false,
          error: 'Invalid received SMS data',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    await this.billingService.canPerformAction(
      device.user.toString(),
      'receive_sms',
      1,
    )

    const receivedAt = dto.receivedAtInMillis
      ? new Date(dto.receivedAtInMillis)
      : dto.receivedAt

    const sms = await this.smsModel.create({
      device: device._id,
      message: dto.message,
      type: SMSType.RECEIVED,
      status: 'received',
      sender: dto.sender,
      receivedAt,
    })

    this.deviceModel
      .findByIdAndUpdate(deviceId, {
        $inc: { receivedSMSCount: 1 },
      })
      .exec()
      .catch((e) => {
        console.log('Failed to update receivedSMSCount')
        console.log(e)
      })

    this.webhookService
      .deliverNotification({
        sms,
        user: device.user,
        event: WebhookEvent.MESSAGE_RECEIVED,
      })
      .catch((e) => {
        console.log(e)
      })

    return sms
  }

  async getReceivedSMS(
    deviceId: string,
    page = 1,
    limit = 50,
  ): Promise<{ data: any[]; meta: any }> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit

    // Get total count for pagination metadata
    const total = await this.smsModel.countDocuments({
      device: device._id,
      type: SMSType.RECEIVED,
    })

    // @ts-ignore
    const data = await this.smsModel
      .find(
        {
          device: device._id,
          type: SMSType.RECEIVED,
        },
        null,
        {
          sort: { receivedAt: -1 },
          limit: limit,
          skip: skip,
        },
      )
      .populate({
        path: 'device',
        select: '_id brand model buildId enabled',
      })
      .lean() // Use lean() to return plain JavaScript objects instead of Mongoose documents

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit)

    return {
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
      data,
    }
  }

  async getMessages(
    deviceId: string,
    type = '',
    page = 1,
    limit = 50,
  ): Promise<{ data: any[]; meta: any }> {
    const device = await this.deviceModel.findById(deviceId)

    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device does not exist',
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    // Calculate skip value for pagination
    const skip = (page - 1) * limit

    // Build query based on type filter
    const query: any = { device: device._id }

    if (type === 'sent') {
      query.type = SMSType.SENT
    } else if (type === 'received') {
      query.type = SMSType.RECEIVED
    }

    // Get total count for pagination metadata
    const total = await this.smsModel.countDocuments(query)

    // @ts-ignore
    const data = await this.smsModel
      .find(query, null, {
        // Sort by the most recent timestamp (receivedAt for received, sentAt for sent)
        sort: { createdAt: -1 },
        limit: limit,
        skip: skip,
      })
      .populate({
        path: 'device',
        select: '_id brand model buildId enabled',
      })
      .lean() // Use lean() to return plain JavaScript objects instead of Mongoose documents

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit)

    return {
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
      data,
    }
  }

  async updateSMSStatus(deviceId: string, dto: UpdateSMSStatusDTO): Promise<any> {

    const device = await this.deviceModel.findById(deviceId);
    
    if (!device) {
      throw new HttpException(
        {
          success: false,
          error: 'Device not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    
    const sms = await this.smsModel.findById(dto.smsId);
    
    if (!sms) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }
    
    // Verify the SMS belongs to this device
    if (sms.device.toString() !== deviceId) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS does not belong to this device',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    
    // Normalize status to lowercase for comparison
    const normalizedStatus = dto.status.toLowerCase();
    
    const updateData: any = {
      status: normalizedStatus, // Store normalized status
    };

    // Update timestamps based on status
    if (normalizedStatus === 'sent' && dto.sentAtInMillis) {
      updateData.sentAt = new Date(dto.sentAtInMillis);
    } else if (normalizedStatus === 'delivered' && dto.deliveredAtInMillis) {
      updateData.deliveredAt = new Date(dto.deliveredAtInMillis);
    } else if (normalizedStatus === 'failed' && dto.failedAtInMillis) {
      updateData.failedAt = new Date(dto.failedAtInMillis);
      updateData.errorCode = dto.errorCode;
      updateData.errorMessage = dto.errorMessage || 'Unknown error';
    }

    // Include sender phone number if provided (for tracking dual-SIM)
    if (dto.senderPhoneNumber) {
      updateData.senderPhoneNumber = dto.senderPhoneNumber;
    }

    // Update the SMS
    await this.smsModel.findByIdAndUpdate(dto.smsId, { $set: updateData });
    
    // Check if all SMS in batch have the same status, then update batch status
    if (dto.smsBatchId) {
      const smsBatch = await this.smsBatchModel.findById(dto.smsBatchId);
      if (smsBatch) {
        const allSmsInBatch = await this.smsModel.find({ smsBatch: dto.smsBatchId });
        
        // Check if all SMS in batch have the same status (case insensitive)
        const allHaveSameStatus = allSmsInBatch.every(sms => sms.status.toLowerCase() === normalizedStatus);
        
        if (allHaveSameStatus) {
          const smsBatchStatus = normalizedStatus === 'failed' ? 'failed' : 'completed';
          await this.smsBatchModel.findByIdAndUpdate(dto.smsBatchId, { 
            $set: { status: smsBatchStatus } 
          });
        }
      }
    }
    
    // Trigger webhook event for SMS status update
    try {
      this.webhookService.deliverNotification({
        sms,
        user: device.user,
        event: WebhookEvent.SMS_STATUS_UPDATED,
      });
    } catch (error) {
      console.error('Failed to trigger webhook event:', error);
    }
    
    return {
      success: true,
      message: 'SMS status updated successfully',
    };
  }

  async getStatsForUser(user: User) {
    const devices = await this.deviceModel.find({ user: user._id })
    const apiKeys = await this.authService.getUserApiKeys(user)

    const totalSentSMSCount = devices.reduce((acc, device) => {
      return acc + (device.sentSMSCount || 0)
    }, 0)

    const totalReceivedSMSCount = devices.reduce((acc, device) => {
      return acc + (device.receivedSMSCount || 0)
    }, 0)

    const totalDeviceCount = devices.length
    const totalApiKeyCount = apiKeys.length

    return {
      totalSentSMSCount,
      totalReceivedSMSCount,
      totalDeviceCount,
      totalApiKeyCount,
    }
  }

  private getRecipientsPreview(recipients: string[]): string {
    if (recipients.length === 0) {
      return null
    } else if (recipients.length === 1) {
      return recipients[0]
    } else if (recipients.length === 2) {
      return `${recipients[0]} and ${recipients[1]}`
    } else if (recipients.length === 3) {
      return `${recipients[0]}, ${recipients[1]}, and ${recipients[2]}`
    } else {
      return `${recipients[0]}, ${recipients[1]}, and ${
        recipients.length - 2
      } others`
    }
  }

  async getSMSById(smsId: string): Promise<any> {

    const sms = await this.smsModel.findById(smsId);

    if (!sms) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    return sms;
  }

  async getSmsBatchById(smsBatchId: string): Promise<any> {

    const smsBatch = await this.smsBatchModel.findById(smsBatchId);

    if (!smsBatch) {
      throw new HttpException(
        {
          success: false,
          error: 'SMS batch not found',
        },
        HttpStatus.NOT_FOUND,
      );
    }

    // Find all SMS messages that belong to this batch
    const smsMessages = await this.smsModel.find({ 
      smsBatch: new Types.ObjectId(smsBatchId),
      device: smsBatch.device
    });

    // Return both the batch and its SMS messages
    return {
      batch: smsBatch,
      messages: smsMessages
    };
  }

  /**
   * Check and update tier progression based on rolling window usage
   * Now takes deviceId instead of device document to ensure fresh data
   */
  async checkTierProgression(deviceId: string | Types.ObjectId): Promise<boolean> {
    const device = await this.deviceModel.findById(deviceId).exec()
    if (!device || !device.usagePlan) {
      return false
    }

    // Get current usage stats from rolling window
    const stats = await this.usageCalculator.getDeviceUsageStats(device)

    const usagePlan = await this.getUsagePlanById(device.usagePlan)
    if (!usagePlan) {
      return false
    }

    // Check if current tier limit exceeded
    if (stats.isOverLimit) {
      // Find next tier
      const nextTier = usagePlan.tiers.find(t => t.tier === device.current_tier + 1)

      if (nextTier) {
        // Upgrade to next tier
        device.current_tier = nextTier.tier
        device.last_tier_upgrade = new Date()

        // Update historical limits to track best performance achieved
        // Always update min_avg_wait_seconds (wait time is cycle-independent)
        if (!device.min_avg_wait_seconds || nextTier.avg_wait_seconds < device.min_avg_wait_seconds) {
          device.min_avg_wait_seconds = nextTier.avg_wait_seconds
          console.log(`Device ${device._id} historical min_avg_wait_seconds updated to ${nextTier.avg_wait_seconds}s`)
        }

        // Only update max_messages_per_cycle if using standard 24-hour window (1440 minutes)
        // This prevents debug/test cycles with non-standard windows from corrupting historical data
        const usageWindowMinutes = (usagePlan as any).usageWindowMinutes || 1440
        if (usageWindowMinutes === 1440) {
          if (!device.max_messages_per_cycle || nextTier.messages_per_cycle > device.max_messages_per_cycle) {
            device.max_messages_per_cycle = nextTier.messages_per_cycle
            console.log(`Device ${device._id} historical max_messages_per_cycle updated to ${nextTier.messages_per_cycle}`)
          }
        }

        // Apply tier promotion cooldown
        const cooldownHours = (usagePlan as any).tierPromotionCooldownHours || 24
        const cooldownEndTime = new Date(Date.now() + cooldownHours * 60 * 60 * 1000)

        device.is_on_cooldown = true
        device.cooldown_end_time = cooldownEndTime
        device.cooldown_reason = 'tier_promotion'

        await device.save()
        console.log(`Device ${device._id} upgraded to tier ${nextTier.tier} and placed on cooldown until ${cooldownEndTime}`)

        // Schedule wake-device job for when cooldown ends
        await this.smsQueueService.scheduleWakeDevice(device._id.toString(), cooldownEndTime)

        return true
      } else {
        // No next tier available, put on max tier cooldown
        device.is_on_cooldown = true
        device.cooldown_reason = 'max_tier_limit'

        // Calculate cooldown end time based on rolling window
        if (stats.estimatedCooldownEndTime) {
          device.cooldown_end_time = stats.estimatedCooldownEndTime
          await this.smsQueueService.scheduleWakeDevice(device._id.toString(), stats.estimatedCooldownEndTime)
        }

        await device.save()
        console.log(`Device ${device._id} entered max tier cooldown`)
      }
    }

    return false
  }
}
