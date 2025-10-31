import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
  Request,
  Get,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { AuthGuard } from '../auth/guards/auth.guard'
import {
  ReceivedSMSDTO,
  RegisterDeviceInputDTO,
  RetrieveSMSResponseDTO,
  SendBulkSMSInputDTO,
  SendSMSInputDTO,
  UpdateSMSStatusDTO,
  GetStatsQueryDTO,
} from './gateway.dto'
import {
  CreateUsagePlanDTO,
  UpdateUsagePlanDTO,
  AssignUsagePlanDTO,
} from './usage-plan.dto'
import { GatewayService } from './gateway.service'
import { UsagePlanService } from './usage-plan.service'
import { PlanSwitchingService } from './services/plan-switching.service'
import { DeviceUsageCalculatorService } from './services/device-usage-calculator.service'
import { CanModifyDevice } from './guards/can-modify-device.guard'

@ApiTags('gateway')
@ApiBearerAuth()
@Controller('gateway')
export class GatewayController {
  constructor(
    private readonly gatewayService: GatewayService,
    private readonly usagePlanService: UsagePlanService,
    private readonly planSwitchingService: PlanSwitchingService,
    private readonly deviceUsageCalculator: DeviceUsageCalculatorService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('/stats')
  async getStats(@Request() req, @Query() query: GetStatsQueryDTO) {
    const { startDate, endDate, deviceIds } = query
    const data = await this.gatewayService.getStatsForUser(
      req.user,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
      deviceIds,
    )
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Register device' })
  @Post('/devices')
  async registerDevice(@Body() input: RegisterDeviceInputDTO, @Request() req) {
    const data = await this.gatewayService.registerDevice(input, req.user)
    return { data }
  }

  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'List of registered devices' })
  @Get('/devices')
  async getDevices(@Request() req) {
    const data = await this.gatewayService.getDevicesForUser(req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Update device' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Patch('/devices/:id')
  async updateDevice(
    @Param('id') deviceId: string,
    @Body() input: RegisterDeviceInputDTO,
  ) {
    const data = await this.gatewayService.updateDevice(deviceId, input)
    return { data }
  }

  @ApiOperation({ summary: 'Delete device' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Delete('/devices/:id')
  async deleteDevice(@Param('id') deviceId: string) {
    const data = await this.gatewayService.deleteDevice(deviceId)
    return { data }
  }

  @ApiOperation({ summary: 'Send SMS to a device' })
  @UseGuards(AuthGuard, CanModifyDevice)
  // deprecate sendSMS route in favor of send-sms, but allow both to prevent breaking changes
  @Post(['/devices/:id/sendSMS', '/devices/:id/send-sms'])
  async sendSMS(
    @Param('id') deviceId: string,
    @Body() smsData: SendSMSInputDTO,
  ) {
    const data = await this.gatewayService.sendSMS(deviceId, smsData)
    return { data }
  }

  @ApiOperation({ summary: 'Send Bulk SMS' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post(['/devices/:id/send-bulk-sms'])
  async sendBulkSMS(
    @Param('id') deviceId: string,
    @Body() body: SendBulkSMSInputDTO,
  ) {
    const data = await this.gatewayService.sendBulkSMS(deviceId, body)
    return { data }
  }

  @ApiOperation({ summary: 'Received SMS from a device' })
  @HttpCode(HttpStatus.OK)
  // deprecate receiveSMS route in favor of receive-sms
  @Post(['/devices/:id/receiveSMS', '/devices/:id/receive-sms'])
  @UseGuards(AuthGuard, CanModifyDevice)
  async receiveSMS(@Param('id') deviceId: string, @Body() dto: ReceivedSMSDTO) {
    const data = await this.gatewayService.receiveSMS(deviceId, dto)
    return { data }
  }

  @ApiOperation({ summary: 'Get received SMS from a device' })
  @ApiResponse({ status: 200, type: RetrieveSMSResponseDTO })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page (default: 50, max: 100)',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  // deprecate getReceivedSMS route in favor of get-received-sms
  @Get(['/devices/:id/getReceivedSMS', '/devices/:id/get-received-sms'])
  async getReceivedSMS(
    @Param('id') deviceId: string,
    @Request() req,
  ): Promise<RetrieveSMSResponseDTO> {
    // Extract page and limit from query params, with defaults and max values
    const page = req.query.page ? parseInt(req.query.page, 10) : 1
    const limit = req.query.limit
      ? Math.min(parseInt(req.query.limit, 10), 100)
      : 50

    const result = await this.gatewayService.getReceivedSMS(
      deviceId,
      page,
      limit,
    )
    return result
  }

  @ApiOperation({
    summary: 'Get message history (sent and received) from a device',
  })
  @ApiResponse({ status: 200, type: RetrieveSMSResponseDTO })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of items per page (default: 50, max: 100)',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    type: String,
    description:
      'Filter by message type: all, sent, or received (default: all)',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/messages')
  async getMessages(
    @Param('id') deviceId: string,
    @Request() req,
  ): Promise<RetrieveSMSResponseDTO> {
    // Extract page and limit from query params, with defaults and max values
    const page = req.query.page ? parseInt(req.query.page, 10) : 1
    const limit = req.query.limit
      ? Math.min(parseInt(req.query.limit, 10), 100)
      : 50
    const type = req.query.type || ''

    const result = await this.gatewayService.getMessages(
      deviceId,
      type,
      page,
      limit,
    )
    return result
  }

  @ApiOperation({ summary: 'Update SMS status' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @HttpCode(HttpStatus.OK)
  @Patch('/devices/:id/sms-status')
  async updateSMSStatus(
    @Param('id') deviceId: string,
    @Body() dto: UpdateSMSStatusDTO,
  ) {
    const data = await this.gatewayService.updateSMSStatus(deviceId, dto)
    return { data }
  }

  @ApiOperation({ summary: 'Get a single SMS by ID' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/sms/:smsId')
  async getSMSById(
    @Param('id') deviceId: string,
    @Param('smsId') smsId: string,
  ) {
    const data = await this.gatewayService.getSMSById(smsId)
    return { data }
  }

  @ApiOperation({ summary: 'Get an SMS batch by ID with all its SMS messages' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/sms-batch/:smsBatchId')
  async getSmsBatchById(
    @Param('id') deviceId: string,
    @Param('smsBatchId') smsBatchId: string,
  ) {
    const data = await this.gatewayService.getSmsBatchById(smsBatchId)
    return { data }
  }

  // Usage Plan Management Endpoints

  @ApiOperation({ summary: 'Create a new usage plan' })
  @UseGuards(AuthGuard)
  @Post('/usage-plans')
  async createUsagePlan(
    @Body() createUsagePlanDto: CreateUsagePlanDTO,
    @Request() req,
  ) {
    const data = await this.usagePlanService.createUsagePlan(
      createUsagePlanDto,
      req.user,
    )
    return { data }
  }

  @ApiOperation({ summary: 'Get all usage plans for the user' })
  @UseGuards(AuthGuard)
  @Get('/usage-plans')
  async getUserUsagePlans(@Request() req) {
    const data = await this.usagePlanService.getUserUsagePlans(req.user)
    return { data }
  }

  @ApiOperation({ summary: 'Get a specific usage plan' })
  @UseGuards(AuthGuard)
  @Get('/usage-plans/:id')
  async getUserUsagePlan(@Param('id') planId: string, @Request() req) {
    const data = await this.usagePlanService.getUserUsagePlan(req.user, planId)
    return { data }
  }

  @ApiOperation({ summary: 'Update a usage plan' })
  @UseGuards(AuthGuard)
  @Patch('/usage-plans/:id')
  async updateUsagePlan(
    @Param('id') planId: string,
    @Body() updateUsagePlanDto: UpdateUsagePlanDTO,
    @Request() req,
  ) {
    const data = await this.usagePlanService.updateUsagePlan(
      req.user,
      planId,
      updateUsagePlanDto,
    )
    return { data }
  }

  @ApiOperation({ summary: 'Delete a usage plan' })
  @UseGuards(AuthGuard)
  @Delete('/usage-plans/:id')
  async deleteUsagePlan(@Param('id') planId: string, @Request() req) {
    await this.usagePlanService.deleteUsagePlan(req.user, planId)
    return { success: true }
  }

  @ApiOperation({ summary: 'Assign usage plan to device' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Patch('/devices/:id/assign-plan')
  async assignUsagePlanToDevice(
    @Param('id') deviceId: string,
    @Body() assignUsagePlanDto: AssignUsagePlanDTO,
    @Request() req,
  ) {
    const data = await this.usagePlanService.assignUsagePlanToDevice(
      req.user,
      deviceId,
      assignUsagePlanDto,
    )
    return { data }
  }

  @ApiOperation({ summary: 'Get device usage statistics (rolling window)' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/usage-stats')
  async getDeviceUsageStats(@Param('id') deviceId: string, @Request() req) {
    const device = await this.gatewayService.getDeviceById(deviceId)
    const stats = await this.deviceUsageCalculator.getDeviceUsageStats(device)
    return { data: stats }
  }

  @ApiOperation({ summary: 'Get recommended tier for device on a plan' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Get('/devices/:id/recommended-tier/:planId')
  async getRecommendedTier(
    @Param('id') deviceId: string,
    @Param('planId') planId: string,
  ) {
    const data = await this.planSwitchingService.getRecommendedTier(
      deviceId,
      planId,
    )
    return { data }
  }

  @ApiOperation({
    summary: 'Switch device to new plan with auto-tier placement',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post('/devices/:id/switch-plan')
  async switchDevicePlan(
    @Param('id') deviceId: string,
    @Body() body: { newPlanId: string },
  ) {
    const data = await this.planSwitchingService.switchDevicePlan(
      deviceId,
      body.newPlanId,
    )
    return { data }
  }

  @ApiOperation({ summary: 'Batch switch multiple devices to a new plan' })
  @UseGuards(AuthGuard)
  @Post('/devices/batch-switch-plan')
  async batchSwitchDevices(
    @Body() body: { deviceIds: string[]; newPlanId: string },
  ) {
    const data = await this.planSwitchingService.batchSwitchDevices(
      body.deviceIds,
      body.newPlanId,
    )
    return { data }
  }

  @ApiOperation({
    summary:
      'Advance device to highest eligible tier based on historical limits',
  })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post('/devices/:id/advance-tier')
  async advanceDeviceToHighestTier(@Param('id') deviceId: string) {
    const data =
      await this.planSwitchingService.advanceDeviceToHighestTier(deviceId)
    return { data }
  }

  @ApiOperation({ summary: 'Reset device historical performance data' })
  @UseGuards(AuthGuard, CanModifyDevice)
  @Post('/devices/:id/reset-history')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetDeviceHistory(@Param('id') deviceId: string) {
    await this.planSwitchingService.resetDeviceHistory(deviceId)
    return { message: 'Device history reset successfully' }
  }
}
