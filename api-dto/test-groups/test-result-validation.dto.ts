import { ApiProperty } from '@nestjs/swagger';

export class TestResultValidationDto {
  @ApiProperty()
    testResultId!: number;

  @ApiProperty()
    personId!: number;

  @ApiProperty()
    unitName!: string;

  @ApiProperty()
    variableId!: string;

  @ApiProperty()
    value!: string;

  @ApiProperty()
    error!: string;
}
