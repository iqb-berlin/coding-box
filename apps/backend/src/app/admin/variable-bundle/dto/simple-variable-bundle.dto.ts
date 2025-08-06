import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariableDto } from './variable.dto';

/**
 * A simplified DTO for variable bundles
 * Used for receiving variable bundles in requests
 */
export class SimpleVariableBundleDto {
  @ApiProperty({
    description: 'The ID of the variable bundle',
    example: 1,
    required: false
  })
  @IsNumber()
  @IsOptional()
    id?: number;

  @ApiProperty({
    description: 'The name of the variable bundle',
    example: 'Mathematical Skills',
    required: false
  })
  @IsString()
  @IsOptional()
    name?: string;

  @ApiProperty({
    description: 'The description of the variable bundle',
    example: 'Variables for assessing mathematical skills',
    required: false
  })
  @IsString()
  @IsOptional()
    description?: string;

  @ApiProperty({
    description: 'The variables in the bundle',
    type: [VariableDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariableDto)
    variables: VariableDto[];
}
