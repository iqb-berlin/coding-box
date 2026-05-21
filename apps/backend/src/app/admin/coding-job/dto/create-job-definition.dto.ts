import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsArray,
  IsBoolean,
  IsNumber,
  Max,
  Min,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { JobDefinitionStatus, CaseOrderingMode } from '../../../database/entities/job-definition.entity';
import {
  JobDefinitionVariableDto,
  JobDefinitionVariableBundleDto
} from './job-definition-variable.dto';
import { JobDefinitionCoderConfigDto } from './job-definition-coder-config.dto';

/**
 * DTO for creating a job definition
 */
export class CreateJobDefinitionDto {
  @ApiProperty({
    description: 'Status of the job definition',
    enum: ['draft', 'pending_review', 'approved'],
    default: 'draft'
  })
  @IsEnum(['draft', 'pending_review', 'approved'])
  @IsOptional()
    status?: JobDefinitionStatus;

  @ApiProperty({
    description: 'Assigned variables',
    type: [JobDefinitionVariableDto],
    required: false
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobDefinitionVariableDto)
  @IsOptional()
    assignedVariables?: JobDefinitionVariableDto[];

  @ApiProperty({
    description: 'Assigned variable bundles',
    type: [JobDefinitionVariableBundleDto],
    required: false
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobDefinitionVariableBundleDto)
  @IsOptional()
    assignedVariableBundles?: JobDefinitionVariableBundleDto[];

  @ApiProperty({
    description: 'Assigned coder IDs',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(1, { each: true })
  @Type(() => Number)
  @IsOptional()
    assignedCoders?: number[];

  @ApiProperty({
    description: 'Assigned coders with optional capacity percentages. If present, this is the source for assigned coder IDs.',
    type: [JobDefinitionCoderConfigDto],
    required: false
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobDefinitionCoderConfigDto)
  @IsOptional()
    assignedCoderConfigs?: JobDefinitionCoderConfigDto[];

  @ApiProperty({
    description: 'Duration in seconds for one coding task',
    example: 300,
    required: false
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
    durationSeconds?: number;

  @ApiProperty({
    description: 'Maximum number of coding cases',
    example: 100,
    required: false
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
    maxCodingCases?: number;

  @ApiProperty({
    description: 'Absolute number of cases that should be double coded',
    example: 10,
    required: false
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
    doubleCodingAbsolute?: number;

  @ApiProperty({
    description: 'Percentage (0-100) of cases that should be double coded',
    example: 25.5,
    required: false
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
    doubleCodingPercentage?: number;

  @ApiProperty({
    description: 'Case ordering mode for distribution: continuous (sort by variable first) or alternating (sort by case first)',
    enum: ['continuous', 'alternating'],
    default: 'continuous',
    required: false
  })
  @IsEnum(['continuous', 'alternating'])
  @IsOptional()
    caseOrderingMode?: CaseOrderingMode;

  @ApiProperty({
    description: 'Whether to show scores in generated coding jobs',
    example: false,
    default: false,
    required: false
  })
  @IsBoolean()
  @IsOptional()
    showScore?: boolean;

  @ApiProperty({
    description: 'Whether to allow comments in generated coding jobs',
    example: true,
    default: true,
    required: false
  })
  @IsBoolean()
  @IsOptional()
    allowComments?: boolean;

  @ApiProperty({
    description: 'Whether to suppress general instructions in generated coding jobs',
    example: false,
    default: false,
    required: false
  })
  @IsBoolean()
  @IsOptional()
    suppressGeneralInstructions?: boolean;
}
