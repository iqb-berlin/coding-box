import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsInt,
  Min,
  IsString
} from 'class-validator';

export class SaveCodingNotesDto {
  @ApiProperty({
    description: 'Test person identifier (login@code@bookletId or login@code@group@bookletId)',
    example: 'testuser@123@g1@testbooklet'
  })
  @IsString()
  testPerson: string;

  @ApiProperty({ description: 'Response ID for cases sharing the same person, booklet, unit and variable', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  responseId?: number;

  @ApiProperty({
    description: 'Unit name',
    example: 'UNIT1'
  })
  @IsString()
  unitId: string;

  @ApiProperty({
    description: 'Variable ID',
    example: 'var001'
  })
  @IsString()
  variableId: string;

  @ApiProperty({
    description: 'Coder notes for the unit',
    example: 'This unit needs manual coding due to ambiguity.',
    required: false
  })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Save this note as part of a coding issue review by the current user.',
    example: false,
    required: false
  })
  @IsBoolean()
  @IsOptional()
  issueReview?: boolean;
}
