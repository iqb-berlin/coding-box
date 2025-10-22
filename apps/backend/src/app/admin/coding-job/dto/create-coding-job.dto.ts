import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsNumber,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariableDto } from '../../variable-bundle/dto/variable.dto';
import { SimpleVariableBundleDto } from '../../variable-bundle/dto/simple-variable-bundle.dto';

/**
 * DTO for creating a coding job
 */
export class CreateCodingJobDto {
  @ApiProperty({
    description: 'Name of the coding job',
    example: 'Coding Job 1'
  })
  @IsString()
    name: string;

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
    default: 'pending'
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
    missings_profile_id?: number;
}
