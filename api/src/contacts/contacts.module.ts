import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './contacts.service'
import {
  ContactSpreadsheet,
  ContactSpreadsheetSchema,
} from './schemas/contact-spreadsheet.schema'
import { Contact, ContactSchema } from './schemas/contact.schema'
import {
  ContactTemplate,
  ContactTemplateSchema,
} from './schemas/contact-template.schema'
import {
  ContactGroupMembership,
  ContactGroupMembershipSchema,
} from './schemas/contact-group-membership.schema'
import { SMS, SMSSchema } from '../gateway/schemas/sms.schema'
import { Device, DeviceSchema } from '../gateway/schemas/device.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ContactSpreadsheet.name, schema: ContactSpreadsheetSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: ContactTemplate.name, schema: ContactTemplateSchema },
      {
        name: ContactGroupMembership.name,
        schema: ContactGroupMembershipSchema,
      },
      { name: SMS.name, schema: SMSSchema },
      { name: Device.name, schema: DeviceSchema },
    ]),
  ],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
