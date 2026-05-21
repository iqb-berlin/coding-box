import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  Max,
  Min
} from 'class-validator';
import { Type } from 'class-transformer';

export class JobDefinitionCoderConfigDto {
  @ApiProperty({
    description: 'Coder ID',
    example: 1
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
    coderId: number;

  @ApiProperty({
    description: 'Capacity percentage for distribution. 100 means normal load.',
    example: 100,
    minimum: 10,
    maximum: 300
  })
  @IsNumber()
  @Min(10)
  @Max(300)
  @Type(() => Number)
    capacityPercent: number;
}
