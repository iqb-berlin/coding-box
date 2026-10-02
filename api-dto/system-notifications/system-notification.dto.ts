import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength
} from 'class-validator';
import {
  SystemNotificationSeverity,
  SystemNotificationType
} from './system-notification.types';

export { SystemNotificationSeverity, SystemNotificationType } from './system-notification.types';

export class SystemNotificationDto {
  @ApiProperty()
    id!: number;

  @ApiProperty({ enum: SystemNotificationType })
    type!: SystemNotificationType;

  @ApiProperty({ enum: SystemNotificationSeverity })
    severity!: SystemNotificationSeverity;

  @ApiProperty({ maxLength: 160 })
    title!: string;

  @ApiProperty({ maxLength: 2000 })
    message!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
    startsAt!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
    endsAt!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
    visibleFrom!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
    visibleUntil!: string | null;

  @ApiProperty()
    enabled!: boolean;

  @ApiProperty()
    dismissible!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
    createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
    updatedAt!: string;
}

export class CreateSystemNotificationDto {
  @ApiProperty({ enum: SystemNotificationType })
  @IsEnum(SystemNotificationType)
    type!: SystemNotificationType;

  @ApiProperty({ enum: SystemNotificationSeverity })
  @IsEnum(SystemNotificationSeverity)
    severity!: SystemNotificationSeverity;

  @ApiProperty({ maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
    title!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
    message!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
    startsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
    endsAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
    visibleFrom?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  @IsOptional()
  @IsISO8601()
    visibleUntil?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
    enabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
    dismissible?: boolean;
}

export class UpdateSystemNotificationDto extends CreateSystemNotificationDto {}
