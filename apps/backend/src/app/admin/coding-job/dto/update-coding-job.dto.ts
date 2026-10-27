import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  ArrayUnique,
  IsIn,
  IsNumber,
  IsInt,
  Min,
  Max,
  IsBoolean,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariableDto } from '../../variable-bundle/dto/variable.dto';
import { SimpleVariableBundleDto } from '../../variable-bundle/dto/simple-variable-bundle.dto';
import { CODING_JOB_UPDATABLE_STATUSES } from '../../../database/services/coding/coding-job-status-policy';

/**
 * DTO for updating a coding job
 */
export class UpdateCodingJobDto {
  @ApiProperty({
    description: 'Name of the coding job',
    example: 'Coding Job 1',
    required: false
  })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({
    description: 'Description of the coding job',
    example: 'This is a coding job for testing',
    required: false
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'Status of the coding job',
    example: 'pending',
    enum: [...CODING_JOB_UPDATABLE_STATUSES],
    required: false
  })
  @IsIn(CODING_JOB_UPDATABLE_STATUSES)
  @IsOptional()
  status?: string;

  @ApiProperty({
    items: { type: 'integer', minimum: 1, maximum: 2147483647 },
    description: 'IDs of coders assigned to the coding job',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  @IsOptional()
  assignedCoders?: number[];

  @ApiProperty({
    description: 'Variables assigned to the coding job',
    type: [VariableDto],
    required: false
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
  @IsOptional()
  variables?: VariableDto[];

  @ApiProperty({
    items: { type: 'integer', minimum: 1, maximum: 2147483647 },
    description: 'IDs of variable bundles assigned to the coding job',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
  @IsArray()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(2147483647, { each: true })
  @IsOptional()
  variableBundleIds?: number[];

  @ApiProperty({
    description: 'Variable bundles assigned to the coding job',
    type: [SimpleVariableBundleDto],
    required: false
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimpleVariableBundleDto)
  @IsOptional()
  variableBundles?: SimpleVariableBundleDto[];

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
    description: 'ID of the missings profile; 0 selects the default profile',
    example: 1,
    required: false
  })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @IsOptional()
  missingsProfileId?: number;

  @ApiProperty({
    description: 'Comment for the coding job',
    example: 'This coding job requires special attention',
    required: false
  })
  @IsString()
  @IsOptional()
  comment?: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
    description: 'Duration in seconds for one coding task',
    example: 300,
    required: false
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsOptional()
  durationSeconds?: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 2147483647,
    description: 'Maximum number of coding cases for this job',
    example: 100,
    required: false
  })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  @IsOptional()
  maxCodingCases?: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: 2147483647,
    description: 'Absolute number of cases that should be double coded',
    example: 10,
    required: false
  })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  @IsOptional()
  doubleCodingAbsolute?: number;

  @ApiProperty({
    minimum: 0,
    maximum: 100,
    description: 'Percentage (0-100) of cases that should be double coded',
    example: 25.5,
    required: false
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  doubleCodingPercentage?: number;

  @ApiProperty({
    description: 'Whether to show scores in the code selector',
    example: true,
    required: false
  })
  @IsBoolean()
  @IsOptional()
  showScore?: boolean;

  @ApiProperty({
    description: 'Whether to allow comments in the code selector',
    example: true,
    required: false
  })
  @IsBoolean()
  @IsOptional()
  allowComments?: boolean;

  @ApiProperty({
    description: 'Whether to suppress general instructions in the code selector',
    example: false,
    required: false
  })
  @IsBoolean()
  @IsOptional()
  suppressGeneralInstructions?: boolean;
}
