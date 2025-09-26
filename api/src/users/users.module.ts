import { forwardRef, Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { User, UserSchema } from './schemas/user.schema'
import { ConversationReadStatus, ConversationReadStatusSchema } from './schemas/conversation-read-status.schema'
import { ConversationMetadata, ConversationMetadataSchema } from './schemas/conversation-metadata.schema'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'
import { BillingModule } from 'src/billing/billing.module'
import { Device, DeviceSchema } from 'src/gateway/schemas/device.schema'
import { SMS, SMSSchema } from 'src/gateway/schemas/sms.schema'
import { Contact, ContactSchema } from 'src/contacts/schemas/contact.schema'
import { MailModule } from 'src/mail/mail.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: User.name,
        schema: UserSchema,
      },
      {
        name: ConversationReadStatus.name,
        schema: ConversationReadStatusSchema,
      },
      {
        name: ConversationMetadata.name,
        schema: ConversationMetadataSchema,
      },
      {
        name: Device.name,
        schema: DeviceSchema,
      },
      {
        name: SMS.name,
        schema: SMSSchema,
      },
      {
        name: Contact.name,
        schema: ContactSchema,
      },
    ]),
    forwardRef(() => BillingModule),
    MailModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [MongooseModule, UsersService],
})
export class UsersModule {}
