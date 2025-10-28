import { forwardRef, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Device, DeviceSchema } from './schemas/device.schema'
import { UsagePlan, UsagePlanSchema } from './schemas/usage-plan.schema'
import { GatewayController } from './gateway.controller'
import { GatewayService } from './gateway.service'
import { AuthModule } from '../auth/auth.module'
import { UsersModule } from '../users/users.module'
import { SMS, SMSSchema } from './schemas/sms.schema'
import { SMSBatch, SMSBatchSchema } from './schemas/sms-batch.schema'
import { WebhookModule } from 'src/webhook/webhook.module'
import { BillingModule } from 'src/billing/billing.module'
import { BullModule } from '@nestjs/bull'
import { ConfigModule } from '@nestjs/config'
import { SmsQueueService } from './queue/sms-queue.service'
import { SmsQueueProcessor } from './queue/sms-queue.processor'
import { SmsStatusUpdateTask } from './tasks/sms-status-update.task'
import { UsagePlanService } from './usage-plan.service'
import { CampaignMessage, CampaignMessageSchema } from '../campaigns/schemas/campaign-message.schema'
import { Campaign, CampaignSchema } from '../campaigns/schemas/campaign.schema'
import { DeviceUsageCalculatorService } from './services/device-usage-calculator.service'
import { DeviceUsageSchedulerService } from './services/device-usage-scheduler.service'
import { RandomizedDelayService } from './services/randomized-delay.service'
import { PlanSwitchingService } from './services/plan-switching.service'
import { DeviceWorkerService } from './queue/device-worker.service'
import { MessageSweeperService } from './queue/message-sweeper.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Device.name,
        schema: DeviceSchema,
      },
      {
        name: SMS.name,
        schema: SMSSchema,
      },
      {
        name: SMSBatch.name,
        schema: SMSBatchSchema,
      },
      {
        name: UsagePlan.name,
        schema: UsagePlanSchema,
      },
      {
        name: CampaignMessage.name,
        schema: CampaignMessageSchema,
      },
      {
        name: Campaign.name,
        schema: CampaignSchema,
      },
    ]),
    BullModule.registerQueue({
      name: 'sms',
      defaultJobOptions: {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      },
    }),
    AuthModule,
    UsersModule,
    WebhookModule,
    forwardRef(() => BillingModule),
    ConfigModule,
  ],
  controllers: [GatewayController],
  providers: [
    GatewayService,
    UsagePlanService,
    DeviceUsageCalculatorService,
    DeviceUsageSchedulerService,
    RandomizedDelayService,
    PlanSwitchingService,
    SmsQueueService,
    SmsQueueProcessor,
    SmsStatusUpdateTask,
    DeviceWorkerService,
    MessageSweeperService
  ],
  exports: [
    MongooseModule,
    GatewayService,
    SmsQueueService,
    UsagePlanService,
    DeviceUsageCalculatorService,
    RandomizedDelayService,
    PlanSwitchingService
  ],
})
export class GatewayModule {}
