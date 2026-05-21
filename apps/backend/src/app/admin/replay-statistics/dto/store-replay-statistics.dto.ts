import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';

export class StoreReplayStatisticsDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
    unitId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
    bookletId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
    testPersonLogin?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
    testPersonCode?: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(2147483647)
    durationMilliseconds: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
    replayUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
    success?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
    errorMessage?: string;

  @ApiPropertyOptional({
    description: 'Small, whitelisted replay timing map recorded in the browser.'
  })
  @IsOptional()
  @IsObject()
    clientTimings?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Small, whitelisted replay timing map reported by replay API endpoints.'
  })
  @IsOptional()
  @IsObject()
    serverTimings?: Record<string, unknown>;
}
