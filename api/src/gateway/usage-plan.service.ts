import { HttpException, HttpStatus, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { UsagePlan, UsagePlanDocument } from './schemas/usage-plan.schema'
import { Device, DeviceDocument } from './schemas/device.schema'
import { User } from '../users/schemas/user.schema'
import { CreateUsagePlanDTO, UpdateUsagePlanDTO, AssignUsagePlanDTO } from './usage-plan.dto'

// Pre-defined plan templates
const PREDEFINED_PLANS = [
  {
    _id: 'template_verizon_business',
    name: 'Verizon Business SIM',
    description: 'Best for high-volume sending',
    tiers: [
      { tier: 1, timeDelayBetweenMessages: 300, dailyLimit: 70 },  // 10%
      { tier: 2, timeDelayBetweenMessages: 240, dailyLimit: 140 }, // 20%
      { tier: 3, timeDelayBetweenMessages: 180, dailyLimit: 280 }, // 40%
      { tier: 4, timeDelayBetweenMessages: 120, dailyLimit: 420 }, // 60%
      { tier: 5, timeDelayBetweenMessages: 90, dailyLimit: 560 },  // 80%
      { tier: 6, timeDelayBetweenMessages: 60, dailyLimit: 700 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_verizon_prepaid',
    name: 'Verizon Prepaid SIM',
    description: 'Reliable mid-volume option',
    tiers: [
      { tier: 1, timeDelayBetweenMessages: 300, dailyLimit: 20 },  // 10%
      { tier: 2, timeDelayBetweenMessages: 240, dailyLimit: 40 },  // 20%
      { tier: 3, timeDelayBetweenMessages: 180, dailyLimit: 80 },  // 40%
      { tier: 4, timeDelayBetweenMessages: 120, dailyLimit: 120 }, // 60%
      { tier: 5, timeDelayBetweenMessages: 90, dailyLimit: 160 },  // 80%
      { tier: 6, timeDelayBetweenMessages: 60, dailyLimit: 200 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_total_wireless',
    name: 'Total Wireless SIM',
    description: "Reliable mid-volume option on Verizon's network",
    tiers: [
      { tier: 1, timeDelayBetweenMessages: 300, dailyLimit: 15 },  // 10%
      { tier: 2, timeDelayBetweenMessages: 240, dailyLimit: 30 },  // 20%
      { tier: 3, timeDelayBetweenMessages: 180, dailyLimit: 60 },  // 40%
      { tier: 4, timeDelayBetweenMessages: 120, dailyLimit: 90 },  // 60%
      { tier: 5, timeDelayBetweenMessages: 90, dailyLimit: 120 },  // 80%
      { tier: 6, timeDelayBetweenMessages: 60, dailyLimit: 150 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
  {
    _id: 'template_tracfone',
    name: 'Tracfone SIM',
    description: 'Tracfone uses both T-Mobile & Verizon network, depending on your area code. Only use Tracfone if they provide Verizon SIM cards',
    tiers: [
      { tier: 1, timeDelayBetweenMessages: 300, dailyLimit: 15 },  // 10%
      { tier: 2, timeDelayBetweenMessages: 240, dailyLimit: 30 },  // 20%
      { tier: 3, timeDelayBetweenMessages: 180, dailyLimit: 60 },  // 40%
      { tier: 4, timeDelayBetweenMessages: 120, dailyLimit: 90 },  // 60%
      { tier: 5, timeDelayBetweenMessages: 90, dailyLimit: 120 },  // 80%
      { tier: 6, timeDelayBetweenMessages: 60, dailyLimit: 150 },  // 100%
    ],
    isDefault: false,
    isActive: true,
    isTemplate: true,
    createdAt: new Date().toISOString(),
  },
]

@Injectable()
export class UsagePlanService {
  constructor(
    @InjectModel(UsagePlan.name) private usagePlanModel: Model<UsagePlanDocument>,
    @InjectModel(Device.name) private deviceModel: Model<DeviceDocument>,
  ) {}

  async createUsagePlan(createUsagePlanDto: CreateUsagePlanDTO, user: User): Promise<UsagePlan> {
    // Validate tiers are sequential starting from 1
    const sortedTiers = [...createUsagePlanDto.tiers].sort((a, b) => a.tier - b.tier)

    for (let i = 0; i < sortedTiers.length; i++) {
      if (sortedTiers[i].tier !== i + 1) {
        throw new HttpException(
          'Tiers must be sequential starting from 1',
          HttpStatus.BAD_REQUEST,
        )
      }
    }

    // Check for unique plan name (excluding templates and checking predefined names)
    const existingPlan = await this.usagePlanModel.findOne({
      user: user._id,
      name: { $regex: new RegExp(`^${createUsagePlanDto.name.trim()}$`, 'i') },
      isActive: true,
    })

    // Also check against predefined template names
    const templateNameExists = PREDEFINED_PLANS.some(
      template => template.name.toLowerCase() === createUsagePlanDto.name.trim().toLowerCase()
    )

    if (existingPlan || templateNameExists) {
      throw new HttpException(
        'A plan with this name already exists',
        HttpStatus.CONFLICT,
      )
    }

    // If this is being set as default, unset any existing default
    if (createUsagePlanDto.isDefault) {
      await this.usagePlanModel.updateMany(
        { user: user._id, isDefault: true },
        { $set: { isDefault: false } }
      )
    }

    const usagePlan = new this.usagePlanModel({
      ...createUsagePlanDto,
      user: user._id,
    })

    return await usagePlan.save()
  }

  async getUserUsagePlans(user: User): Promise<UsagePlan[]> {
    // Get user-created plans
    const userPlans = await this.usagePlanModel
      .find({ user: user._id, isActive: true })
      .sort({ isDefault: -1, createdAt: -1 })
      .exec()

    // Combine with predefined template plans
    const allPlans = [
      ...userPlans.map(plan => plan.toObject()),
      ...PREDEFINED_PLANS
    ]

    // Sort by default status first, then by creation date (templates last)
    return allPlans.sort((a, b) => {
      if (a.isDefault !== b.isDefault) {
        return b.isDefault ? 1 : -1
      }
      // User plans come before templates
      if (a.isTemplate !== b.isTemplate) {
        return a.isTemplate ? 1 : -1
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }) as UsagePlan[]
  }

  async getUserUsagePlan(user: User, planId: string): Promise<UsagePlan> {
    // Check if this is a template plan first
    if (planId.startsWith('template_')) {
      const templatePlan = PREDEFINED_PLANS.find(template => template._id === planId)
      if (templatePlan) {
        return templatePlan as unknown as UsagePlan
      }
      // If template not found, throw error immediately
      throw new HttpException('Usage plan not found', HttpStatus.NOT_FOUND)
    }

    // Validate that planId is a valid ObjectId for user-created plans
    if (!Types.ObjectId.isValid(planId)) {
      throw new HttpException('Invalid usage plan ID', HttpStatus.BAD_REQUEST)
    }

    // Otherwise, look for user-created plan
    const plan = await this.usagePlanModel.findOne({
      _id: planId,
      user: user._id,
      isActive: true,
    })

    if (!plan) {
      throw new HttpException('Usage plan not found', HttpStatus.NOT_FOUND)
    }

    return plan
  }

  async updateUsagePlan(user: User, planId: string, updateUsagePlanDto: UpdateUsagePlanDTO): Promise<UsagePlan> {
    // Template plans cannot be updated
    if (planId.startsWith('template_')) {
      throw new HttpException('Template plans cannot be updated', HttpStatus.BAD_REQUEST)
    }

    const plan = await this.getUserUsagePlan(user, planId)

    // Validate tiers if provided
    if (updateUsagePlanDto.tiers) {
      const sortedTiers = [...updateUsagePlanDto.tiers].sort((a, b) => a.tier - b.tier)

      for (let i = 0; i < sortedTiers.length; i++) {
        if (sortedTiers[i].tier !== i + 1) {
          throw new HttpException(
            'Tiers must be sequential starting from 1',
            HttpStatus.BAD_REQUEST,
          )
        }
      }
    }

    // Check for unique plan name if name is being updated
    if (updateUsagePlanDto.name) {
      const existingPlan = await this.usagePlanModel.findOne({
        user: user._id,
        name: { $regex: new RegExp(`^${updateUsagePlanDto.name.trim()}$`, 'i') },
        isActive: true,
        _id: { $ne: planId }, // Exclude current plan
      })

      // Also check against predefined template names
      const templateNameExists = PREDEFINED_PLANS.some(
        template => template.name.toLowerCase() === updateUsagePlanDto.name.trim().toLowerCase()
      )

      if (existingPlan || templateNameExists) {
        throw new HttpException(
          'A plan with this name already exists',
          HttpStatus.CONFLICT,
        )
      }
    }

    // If setting as default, unset any existing default
    if (updateUsagePlanDto.isDefault) {
      await this.usagePlanModel.updateMany(
        { user: user._id, isDefault: true, _id: { $ne: planId } },
        { $set: { isDefault: false } }
      )
    }

    const updatedPlan = await this.usagePlanModel.findByIdAndUpdate(
      planId,
      { $set: updateUsagePlanDto },
      { new: true }
    )

    return updatedPlan
  }

  async deleteUsagePlan(user: User, planId: string): Promise<void> {
    // Template plans cannot be deleted
    if (planId.startsWith('template_')) {
      throw new HttpException('Template plans cannot be deleted', HttpStatus.BAD_REQUEST)
    }

    const plan = await this.getUserUsagePlan(user, planId)

    // Check if any devices are using this plan
    const devicesUsingPlan = await this.deviceModel.countDocuments({
      usagePlan: planId,
      user: user._id,
    })

    if (devicesUsingPlan > 0) {
      throw new HttpException(
        `Cannot delete usage plan. ${devicesUsingPlan} device(s) are currently using this plan.`,
        HttpStatus.CONFLICT,
      )
    }

    // Soft delete
    await this.usagePlanModel.findByIdAndUpdate(planId, {
      $set: { isActive: false }
    })
  }

  async assignUsagePlanToDevice(user: User, deviceId: string, assignUsagePlanDto: AssignUsagePlanDTO): Promise<Device> {
    // Verify the usage plan belongs to the user
    await this.getUserUsagePlan(user, assignUsagePlanDto.usagePlanId)

    // Find the device
    const device = await this.deviceModel.findOne({
      _id: deviceId,
      user: user._id,
    })

    if (!device) {
      throw new HttpException('Device not found', HttpStatus.NOT_FOUND)
    }

    // Assign the plan and reset tier to 1
    device.usagePlan = assignUsagePlanDto.usagePlanId as any
    device.current_tier = 1
    device.is_on_cooldown = false
    device.cooldown_until = undefined

    return await device.save()
  }

  async getUsagePlanById(planId: string | Types.ObjectId): Promise<UsagePlan | null> {
    if (typeof planId === 'string' && planId.startsWith('template_')) {
      const templatePlan = PREDEFINED_PLANS.find(template => template._id === planId)
      return templatePlan ? templatePlan as unknown as UsagePlan : null
    }

    if (Types.ObjectId.isValid(planId as string)) {
      return await this.usagePlanModel.findById(planId).exec()
    }

    return null
  }

  async getDefaultUsagePlan(user: User): Promise<UsagePlan | null> {
    const defaultPlan = await this.usagePlanModel.findOne({
      user: user._id,
      isDefault: true,
      isActive: true,
    })

    if (defaultPlan) {
      return defaultPlan
    }

    // If no default plan exists, create one
    const defaultPlanData: CreateUsagePlanDTO = {
      name: 'Default Plan',
      description: 'Automatically created default usage plan',
      tiers: [
        { tier: 1, timeDelayBetweenMessages: 2, dailyLimit: 50 },
        { tier: 2, timeDelayBetweenMessages: 1, dailyLimit: 100 },
        { tier: 3, timeDelayBetweenMessages: 0, dailyLimit: 200 },
      ],
      isDefault: true,
    }

    return await this.createUsagePlan(defaultPlanData, user)
  }

  async getCurrentTierForDevice(device: DeviceDocument): Promise<{ tier: number; timeDelayBetweenMessages: number; dailyLimit: number } | null> {
    if (!device.usagePlan) {
      return null
    }

    const usagePlan = await this.getUsagePlanById(device.usagePlan)
    if (!usagePlan) {
      return null
    }

    const currentTier = usagePlan.tiers.find(t => t.tier === device.current_tier)
    return currentTier || null
  }

  async checkAndProgressTier(device: DeviceDocument): Promise<boolean> {
    if (!device.usagePlan) {
      return false
    }

    const usagePlan = await this.getUsagePlanById(device.usagePlan)
    if (!usagePlan) {
      return false
    }

    const currentTier = usagePlan.tiers.find(t => t.tier === device.current_tier)
    if (!currentTier) {
      return false
    }

    // Check if daily limit exceeded
    if (device.messages_sent_today >= currentTier.dailyLimit) {
      // Find next tier
      const nextTier = usagePlan.tiers.find(t => t.tier === device.current_tier + 1)

      if (nextTier) {
        // Upgrade tier
        device.current_tier = nextTier.tier
        device.last_tier_upgrade = new Date()
        await device.save()
        return true
      } else {
        // No next tier available, put on cooldown
        device.is_on_cooldown = true
        device.cooldown_until = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        await device.save()
      }
    }

    return false
  }

  async checkAndResetCooldown(device: DeviceDocument): Promise<boolean> {
    if (!device.is_on_cooldown || !device.cooldown_until) {
      return false
    }

    const now = new Date()

    // Check if cooldown period has passed
    if (now >= device.cooldown_until) {
      // Reset cooldown and check if we can move to next tier
      device.is_on_cooldown = false
      device.cooldown_until = undefined

      // If messages sent in last 24 hours is now 0, we can progress
      if (device.messages_sent_today === 0) {
        await this.checkAndProgressTier(device)
      }

      await device.save()
      return true
    }

    return false
  }
}