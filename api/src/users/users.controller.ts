import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Patch,
  Query,
} from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('conversations/mark-read')
  async markConversationAsRead(
    @Request() req,
    @Body() body: { normalizedPhoneNumber: string; lastSeenAt?: string },
  ) {
    const lastSeenAt = body.lastSeenAt ? new Date(body.lastSeenAt) : new Date()

    return await this.usersService.markConversationAsRead(
      req.user._id,
      body.normalizedPhoneNumber,
      lastSeenAt,
    )
  }

  @Get('conversations/read-statuses')
  async getConversationReadStatuses(@Request() req) {
    return await this.usersService.getConversationReadStatuses(req.user._id)
  }

  @Get('conversations/metadata')
  async getConversationMetadata(@Request() req) {
    return await this.usersService.getConversationMetadata(req.user._id)
  }

  @Post('conversations/archive')
  async archiveConversations(
    @Request() req,
    @Body() body: { phoneNumbers: string[] },
  ) {
    return await this.usersService.archiveConversations(
      req.user._id,
      body.phoneNumbers,
    )
  }

  @Post('conversations/unarchive')
  async unarchiveConversations(
    @Request() req,
    @Body() body: { phoneNumbers: string[] },
  ) {
    return await this.usersService.unarchiveConversations(
      req.user._id,
      body.phoneNumbers,
    )
  }

  @Post('conversations/block')
  async blockContacts(
    @Request() req,
    @Body() body: { phoneNumbers: string[] },
  ) {
    return await this.usersService.blockContacts(
      req.user._id,
      body.phoneNumbers,
    )
  }

  @Post('conversations/unblock')
  async unblockContacts(
    @Request() req,
    @Body() body: { phoneNumbers: string[] },
  ) {
    return await this.usersService.unblockContacts(
      req.user._id,
      body.phoneNumbers,
    )
  }

  @Patch('conversations/star')
  async toggleConversationStar(
    @Request() req,
    @Body() body: { phoneNumber: string; isStarred: boolean },
  ) {
    return await this.usersService.toggleConversationStar(
      req.user._id,
      body.phoneNumber,
      body.isStarred,
    )
  }

  @Patch('conversations/device')
  async updateConversationDevice(
    @Request() req,
    @Body() body: { phoneNumber: string; deviceId: string },
  ) {
    return await this.usersService.updateConversationDevice(
      req.user._id,
      body.phoneNumber,
      body.deviceId,
    )
  }

  @Get('conversations')
  async getConversations(
    @Request() req,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '9',
    @Query('sortBy') sortBy: string = 'newest',
    @Query('filter') filter: string = 'all',
    @Query('campaignId') campaignId?: string,
    @Query('campaignIds') campaignIds?: string,
  ) {
    const pageNum = parseInt(page, 10) || 1
    const limitNum = Math.min(parseInt(limit, 10) || 9, 100) // Max 100 per page

    // Handle both single campaignId (backward compatibility) and multiple campaignIds
    let campaignIdArray: string[] | undefined
    if (campaignIds) {
      campaignIdArray = campaignIds.split(',').filter((id) => id.trim())
    } else if (campaignId) {
      campaignIdArray = [campaignId]
    }

    return await this.usersService.getConversations(
      req.user._id,
      pageNum,
      limitNum,
      sortBy,
      filter,
      campaignIdArray,
    )
  }

  @Get('conversations/counts')
  async getConversationCounts(@Request() req) {
    return await this.usersService.getConversationCounts(req.user._id)
  }
}
