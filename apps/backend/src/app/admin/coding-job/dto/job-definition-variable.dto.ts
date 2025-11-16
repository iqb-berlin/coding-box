// eslint-disable-next-line max-classes-per-file
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';

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
    id: number;

  @ApiProperty({
    description: 'Bundle name',
    example: 'My Bundle'
  })
  @IsString()
    name: string;
}
