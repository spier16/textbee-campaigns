import { Test, TestingModule } from '@nestjs/testing'
import { SmsQueueProcessor } from './sms-queue.processor'
import { getModelToken } from '@nestjs/mongoose'
import { Device } from '../schemas/device.schema'
import { SMS } from '../schemas/sms.schema'
import { SMSBatch } from '../schemas/sms-batch.schema'
import { CampaignMessage, MessageStatus } from '../../campaigns/schemas/campaign-message.schema'
import { WebhookService } from '../../webhook/webhook.service'
import { UsagePlanService } from '../usage-plan.service'
import { Job } from 'bull'
import * as firebaseAdmin from 'firebase-admin'

// Mock firebase-admin
jest.mock('firebase-admin', () => ({
  messaging: jest.fn().mockReturnValue({
    send: jest.fn(),
    sendEach: jest.fn(),
  }),
}))

describe('SmsQueueProcessor', () => {
  let processor: SmsQueueProcessor
  let deviceModel: any
  let smsModel: any
  let smsBatchModel: any
  let campaignMessageModel: any
  let webhookService: WebhookService
  let usagePlanService: UsagePlanService

  const mockDeviceModel = {
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  }

  const mockSmsModel = {
    create: jest.fn(),
    updateMany: jest.fn(),
  }

  const mockSmsBatchModel = {
    create: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  }

  const mockCampaignMessageModel = {
    findById: jest.fn(),
    save: jest.fn(),
  }

  const mockWebhookService = {
    deliverNotification: jest.fn(),
  }

  const mockUsagePlanService = {
    getCurrentTierForDevice: jest.fn(),
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsQueueProcessor,
        {
          provide: getModelToken(Device.name),
          useValue: mockDeviceModel,
        },
        {
          provide: getModelToken(SMS.name),
          useValue: mockSmsModel,
        },
        {
          provide: getModelToken(SMSBatch.name),
          useValue: mockSmsBatchModel,
        },
        {
          provide: getModelToken(CampaignMessage.name),
          useValue: mockCampaignMessageModel,
        },
        {
          provide: WebhookService,
          useValue: mockWebhookService,
        },
        {
          provide: UsagePlanService,
          useValue: mockUsagePlanService,
        },
      ],
    }).compile()

    processor = module.get<SmsQueueProcessor>(SmsQueueProcessor)
    deviceModel = module.get(getModelToken(Device.name))
    smsModel = module.get(getModelToken(SMS.name))
    smsBatchModel = module.get(getModelToken(SMSBatch.name))
    campaignMessageModel = module.get(getModelToken(CampaignMessage.name))
    webhookService = module.get<WebhookService>(WebhookService)
    usagePlanService = module.get<UsagePlanService>(UsagePlanService)

    // Reset all mocks
    jest.clearAllMocks()
  })

  describe('handleSendCampaignMessage', () => {
    const mockJob = {
      id: 'job123',
      data: {
        deviceId: 'device123',
        campaignMessageId: 'message123',
        fcmMessage: {
          data: {
            type: 'SEND_SMS',
            recipients: '+1234567890',
            message: 'Test message',
            messageId: 'message123',
          },
          token: 'fcm-token',
        },
        smsBatchId: 'batch123',
      },
    } as Job

    const mockDevice = {
      _id: 'device123',
      enabled: true,
      fcmToken: 'fcm-token',
      messages_sent_today: 5,
      messages_sent_this_hour: 2,
      is_on_cooldown: false,
    }

    const mockCampaignMessage = {
      _id: 'message123',
      status: MessageStatus.QUEUED,
      content: 'Test message',
      recipient: '+1234567890',
      save: jest.fn(),
    }

    const mockUsageTier = {
      dailyLimit: 100,
      timeDelayBetweenMessages: 60, // 60 seconds
    }

    beforeEach(() => {
      mockCampaignMessageModel.findById.mockResolvedValue(mockCampaignMessage)
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
      mockUsagePlanService.getCurrentTierForDevice.mockResolvedValue(mockUsageTier)
      mockSmsBatchModel.findByIdAndUpdate.mockResolvedValue({})
      mockDeviceModel.findByIdAndUpdate.mockResolvedValue({})
      jest.spyOn(firebaseAdmin.messaging(), 'send').mockResolvedValue('fcm-message-id')
    })

    it('should send campaign message successfully', async () => {
      const result = await processor.handleSendCampaignMessage(mockJob)

      expect(mockCampaignMessageModel.findById).toHaveBeenCalledWith('message123')
      expect(mockDeviceModel.findById).toHaveBeenCalledWith('device123')
      expect(mockUsagePlanService.getCurrentTierForDevice).toHaveBeenCalledWith(mockDevice)
      expect(firebaseAdmin.messaging().send).toHaveBeenCalledWith(mockJob.data.fcmMessage)
      expect(mockCampaignMessage.save).toHaveBeenCalled()
      expect(mockCampaignMessage.status).toBe(MessageStatus.SENT)
      expect(result).toBe('fcm-message-id')
    })

    it('should skip if campaign message not found', async () => {
      mockCampaignMessageModel.findById.mockResolvedValue(null)

      const result = await processor.handleSendCampaignMessage(mockJob)

      expect(result).toBeUndefined()
      expect(firebaseAdmin.messaging().send).not.toHaveBeenCalled()
    })

    it('should skip if message status is not QUEUED', async () => {
      mockCampaignMessage.status = MessageStatus.SENT
      mockCampaignMessageModel.findById.mockResolvedValue(mockCampaignMessage)

      const result = await processor.handleSendCampaignMessage(mockJob)

      expect(result).toBeUndefined()
      expect(firebaseAdmin.messaging().send).not.toHaveBeenCalled()
    })

    it('should reschedule if device cannot send now (daily limit reached)', async () => {
      // Mock device that has reached daily limit
      const limitedDevice = {
        ...mockDevice,
        messages_sent_today: 100, // Reached daily limit
      }
      mockDeviceModel.findById
        .mockResolvedValueOnce(mockDevice) // First call in main function
        .mockResolvedValueOnce(limitedDevice) // Second call in canDeviceSendNow

      await processor.handleSendCampaignMessage(mockJob)

      expect(firebaseAdmin.messaging().send).not.toHaveBeenCalled()
      expect(mockCampaignMessage.save).toHaveBeenCalled()
      expect(mockCampaignMessage.status).toBe(MessageStatus.SCHEDULED)
      expect(mockCampaignMessage.lastError).toBe('Device not available, rescheduled')
    })

    it('should update device counters after successful send', async () => {
      const today = new Date().toISOString().split('T')[0]
      const currentHour = new Date().getHours()

      await processor.handleSendCampaignMessage(mockJob)

      expect(mockDeviceModel.findByIdAndUpdate).toHaveBeenCalledWith(
        'device123',
        {
          $inc: {
            sentSMSCount: 1,
            messages_sent_today: 1,
            messages_sent_this_hour: 1,
          },
          $set: {
            messages_sent_today_date: today,
            messages_sent_this_hour_timestamp: currentHour,
            lastMessageSentAt: expect.any(Date),
          },
        }
      )
    })

    it('should handle send errors and update status', async () => {
      jest.spyOn(firebaseAdmin.messaging(), 'send').mockRejectedValue(new Error('FCM Error'))

      await expect(processor.handleSendCampaignMessage(mockJob)).rejects.toThrow('FCM Error')

      expect(mockCampaignMessage.save).toHaveBeenCalled()
      expect(mockCampaignMessage.status).toBe(MessageStatus.FAILED)
      expect(mockCampaignMessage.lastError).toBe('FCM Error')
      expect(mockCampaignMessage.retryCount).toBe(1)
    })

    it('should schedule retry for failed messages within retry limit', async () => {
      mockCampaignMessage.retryCount = 1
      mockCampaignMessage.maxRetries = 3
      jest.spyOn(firebaseAdmin.messaging(), 'send').mockRejectedValue(new Error('FCM Error'))

      await expect(processor.handleSendCampaignMessage(mockJob)).rejects.toThrow('FCM Error')

      expect(mockCampaignMessage.status).toBe(MessageStatus.SCHEDULED)
      expect(mockCampaignMessage.nextRetryAt).toBeInstanceOf(Date)
    })
  })

  describe('canDeviceSendNow', () => {
    const mockDevice = {
      _id: 'device123',
      is_on_cooldown: false,
      messages_sent_today: 10,
      messages_sent_this_hour: 5,
    }

    const mockUsageTier = {
      dailyLimit: 100,
      timeDelayBetweenMessages: 60, // 60 seconds = 60 messages per hour max
    }

    beforeEach(() => {
      mockUsagePlanService.getCurrentTierForDevice.mockResolvedValue(mockUsageTier)
      mockDeviceModel.findById.mockResolvedValue(mockDevice)
    })

    it('should return true when device can send', async () => {
      // Use reflection to access private method for testing
      const canSend = await (processor as any).canDeviceSendNow(mockDevice)
      expect(canSend).toBe(true)
    })

    it('should return false when device is on cooldown', async () => {
      const cooldownDevice = {
        ...mockDevice,
        is_on_cooldown: true,
        cooldown_until: new Date(Date.now() + 60000), // 1 minute from now
      }

      const canSend = await (processor as any).canDeviceSendNow(cooldownDevice)
      expect(canSend).toBe(false)
    })

    it('should return false when daily limit is reached', async () => {
      const limitedDevice = {
        ...mockDevice,
        messages_sent_today: 100,
      }
      mockDeviceModel.findById.mockResolvedValue(limitedDevice)

      const canSend = await (processor as any).canDeviceSendNow(mockDevice)
      expect(canSend).toBe(false)
    })

    it('should return false when hourly rate limit is reached', async () => {
      const rateLimitedDevice = {
        ...mockDevice,
        messages_sent_this_hour: 60, // Reached hourly limit
      }
      mockDeviceModel.findById.mockResolvedValue(rateLimitedDevice)

      const canSend = await (processor as any).canDeviceSendNow(mockDevice)
      expect(canSend).toBe(false)
    })
  })
})