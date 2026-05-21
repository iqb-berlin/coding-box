import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString
} from 'class-validator';

export class SaveCodingProgressSelectedCodeDto {
  @ApiProperty({
    description: 'Numeric code ID. Regular codes are non-negative; supported coding issue options are -1, -2, -3, -4.',
    example: 1
  })
  @IsNumber()
    id: number;

  @ApiProperty({
    description: 'Display code',
    example: 'A1',
    required: false
  })
  @IsString()
  @IsOptional()
    code?: string;

  @ApiProperty({
    description: 'Display label',
    example: 'Answer 1',
    required: false
  })
  @IsString()
  @IsOptional()
    label?: string;

  @ApiProperty({
    description: 'Score assigned to the selected code',
    example: 1,
    required: false
  })
  @IsNumber()
  @IsOptional()
    score?: number | null;

  @ApiProperty({
    description: 'Optional coding issue marker',
    enum: [-1, -2, -3, -4],
    required: false
  })
  @IsIn([-1, -2, -3, -4])
  @IsOptional()
    codingIssueOption?: number | null;
}
