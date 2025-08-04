import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { VariableDto } from './variable.dto';

export class UpdateVariableBundleDto {
  @ApiProperty({
    description: 'The name of the variable bundle',
    example: 'Mathematical Skills',
    required: false
  })
  @IsOptional()
  @IsString()
    name?: string;

  @ApiProperty({
    description: 'The description of the variable bundle',
    example: 'Variables for assessing mathematical skills',
    required: false
  })
  @IsOptional()
  @IsString()
    description?: string;

  @ApiProperty({
    description: 'The variables in the bundle',
    type: [VariableDto],
    required: false
  })
  @IsOptional()
  @IsArray()
    variables?: VariableDto[];
}
