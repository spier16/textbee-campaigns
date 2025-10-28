import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator'
// import { Type } from 'class-transformer'

export class UsagePlanTierDTO {
  @ApiProperty()
  @IsNumber()
  @Min(1)
  tier: number

  @ApiProperty({ description: 'Minimum wait time between messages in seconds (with right-skewed randomization)' })
  @IsNumber()
  @Min(0)
  min_wait_seconds: number

  @ApiProperty({ description: 'Maximum messages allowed in the rolling window' })
  @IsNumber()
  @Min(1)
  messages_per_cycle: number
}

export class CreateUsagePlanDTO {
  @ApiProperty()
  @IsString()
  name: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string

  @ApiProperty({ required: false, default: 1440, description: 'Rolling window period in minutes (default: 1440 = 24 hours)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  usageWindowMinutes?: number

  @ApiProperty({ type: [UsagePlanTierDTO] })
  @IsArray()
  @ValidateNested({ each: true })
  // @Type(() => UsagePlanTierDTO)
  tiers: UsagePlanTierDTO[]

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean
}

export class UpdateUsagePlanDTO {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string

  @ApiProperty({ required: false, description: 'Rolling window period in minutes' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  usageWindowMinutes?: number

  @ApiProperty({ type: [UsagePlanTierDTO], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  // @Type(() => UsagePlanTierDTO)
  tiers?: UsagePlanTierDTO[]

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean
}

export class AssignUsagePlanDTO {
  @ApiProperty()
  @IsString()
  usagePlanId: string
}