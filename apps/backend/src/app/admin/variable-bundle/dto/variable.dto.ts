import { ApiProperty } from '@nestjs/swagger';

export class VariableDto {
  @ApiProperty({
    description: 'The unit name of the variable',
    example: 'math101'
  })
    unitName: string;

  @ApiProperty({
    description: 'The variable ID',
    example: 'addition'
  })
    variableId: string;
}
