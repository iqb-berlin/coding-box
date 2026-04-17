import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class TransferCodingCasesDto {
  @ApiProperty({
    description: 'Source coder user ID',
    example: 12
  })
  @IsInt()
  @Min(1)
    sourceCoderId: number;

  @ApiProperty({
    description: 'Target coder user ID',
    example: 34
  })
  @IsInt()
  @Min(1)
    targetCoderId: number;
}
