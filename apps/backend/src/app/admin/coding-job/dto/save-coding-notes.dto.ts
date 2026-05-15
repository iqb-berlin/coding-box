import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString
} from 'class-validator';

export class SaveCodingNotesDto {
  @ApiProperty({
    description: 'Test person identifier (login@code@bookletId or login@code@group@bookletId)',
    example: 'testuser@123@g1@testbooklet'
  })
  @IsString()
    testPerson: string;

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
}
