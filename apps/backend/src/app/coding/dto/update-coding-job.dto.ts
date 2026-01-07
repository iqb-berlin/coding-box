import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsNumber,
  IsBoolean,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariableDto } from '../../admin/variable-bundle/dto/variable.dto';
import { SimpleVariableBundleDto } from '../../admin/variable-bundle/dto/simple-variable-bundle.dto';

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
    enum: ['pending', 'active', 'paused', 'completed'],
    required: false
  })
  @IsEnum(['pending', 'active', 'paused', 'completed'])
  @IsOptional()
    status?: string;

  @ApiProperty({
    description: 'IDs of coders assigned to the coding job',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
  @IsArray()
  @IsNumber({}, { each: true })
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
    description: 'IDs of variable bundles assigned to the coding job',
    type: [Number],
    example: [1, 2, 3],
    required: false
  })
  @IsArray()
  @IsNumber({}, { each: true })
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
    description: 'ID of the missings profile to assign to the coding job',
    example: 1,
    required: false
  })
  @IsNumber()
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
    description: 'Duration in seconds for one coding task',
    example: 300,
    required: false
  })
  @IsNumber()
  @IsOptional()
    durationSeconds?: number;

  @ApiProperty({
    description: 'Maximum number of coding cases for this job',
    example: 100,
    required: false
  })
  @IsNumber()
  @IsOptional()
    maxCodingCases?: number;

  @ApiProperty({
    description: 'Absolute number of cases that should be double coded',
    example: 10,
    required: false
  })
  @IsNumber()
  @IsOptional()
    doubleCodingAbsolute?: number;

  @ApiProperty({
    description: 'Percentage (0-100) of cases that should be double coded',
    example: 25.5,
    required: false
  })
  @IsNumber()
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
