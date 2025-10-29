import { Module, forwardRef } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BullModule } from '@nestjs/bull'
import { CampaignsController } from './campaigns.controller'
import { CampaignsService } from './campaigns.service'
import {
  MessageTemplateGroup,
  MessageTemplateGroupSchema,
} from './schemas/message-template-group.schema'
import {
  MessageTemplate,
  MessageTemplateSchema,
} from './schemas/message-template.schema'
import {
  Campaign,
  CampaignSchema,
} from './schemas/campaign.schema'
import {
  CampaignMessage,
  CampaignMessageSchema,
} from './schemas/campaign-message.schema'
import { SMS, SMSSchema } from '../gateway/schemas/sms.schema'
import { ContactsModule } from '../contacts/contacts.module'
import { GatewayModule } from '../gateway/gateway.module'
import { CampaignQueueProcessor } from './queue/campaign-queue.processor'
import { CampaignQueueService } from './queue/campaign-queue.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MessageTemplateGroup.name, schema: MessageTemplateGroupSchema },
      { name: MessageTemplate.name, schema: MessageTemplateSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignMessage.name, schema: CampaignMessageSchema },
      { name: SMS.name, schema: SMSSchema },
    ]),
    BullModule.registerQueue({
      name: 'campaign-queue',
    }),
    forwardRef(() => ContactsModule),
    forwardRef(() => GatewayModule),
  ],
  controllers: [CampaignsController],
  providers: [
    CampaignsService,
    CampaignQueueProcessor,
    CampaignQueueService,
  ],
  exports: [CampaignsService, CampaignQueueService],
})
export class CampaignsModule {}