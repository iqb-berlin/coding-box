import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VariableDto {
  @ApiProperty({
    description: 'The unit name of the variable',
    example: 'math101'
  })
  @IsString()
    unitName: string;

  @ApiProperty({
    description: 'The variable ID',
    example: 'addition'
  })
  @IsString()
    variableId: string;
}
