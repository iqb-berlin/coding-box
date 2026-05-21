// eslint-disable-next-line max-classes-per-file
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum, IsNumber, IsOptional, IsString, Min
} from 'class-validator';
import { Type } from 'class-transformer';

export class JobDefinitionVariableDto {
  @ApiProperty({
    description: 'Unit name',
    example: 'unit1'
  })
  @IsString()
    unitName: string;

  @ApiProperty({
    description: 'Variable ID',
    example: 'variable1'
  })
  @IsString()
    variableId: string;
}

export class JobDefinitionVariableBundleDto {
  @ApiProperty({
    description: 'Bundle ID',
    example: 1
  })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
    id: number;

  @ApiProperty({
    description: 'Bundle name',
    example: 'My Bundle'
  })
  @IsString()
    name: string;

  @ApiProperty({
    description: 'Bundle-specific case ordering mode (overrides global mode)',
    example: 'alternating',
    required: false,
    enum: ['continuous', 'alternating']
  })
  @IsEnum(['continuous', 'alternating'])
  @IsOptional()
    caseOrderingMode?: 'continuous' | 'alternating';
}
