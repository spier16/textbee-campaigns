import { ApiProperty } from '@nestjs/swagger'
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator'
// import { Type } from 'class-transformer'

export class UsagePlanTierDTO {
  @ApiProperty()
  @IsNumber()
  @Min(1)
  tier: number

  @ApiProperty({ description: 'Time delay between messages in seconds' })
  @IsNumber()
  @Min(0)
  timeDelayBetweenMessages: number

  @ApiProperty({ description: 'Maximum daily message limit for this tier' })
  @IsNumber()
  @Min(1)
  dailyLimit: number
}

export class CreateUsagePlanDTO {
  @ApiProperty()
  @IsString()
  name: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string

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