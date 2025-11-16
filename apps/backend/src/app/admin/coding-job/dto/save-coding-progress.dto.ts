import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsObject
} from 'class-validator';

/**
 * DTO for saving partial coding progress
 */
export class SaveCodingProgressDto {
  @ApiProperty({
    description: 'Test person identifier (login@code@bookletId)',
    example: 'testuser@123@testbooklet'
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
    description: 'Selected code object',
    example: {
      id: 1, code: 'A1', label: 'Answer 1', score: 1
    }
  })
  @IsObject()
    selectedCode: {
    id: number;
    code?: string;
    label?: string;
    score?: number;
    codingIssueOption?: number | null;
    [key: string]: unknown;
  };

  @ApiProperty({
    description: 'Whether the unit is marked as open',
    example: false,
    required: false
  })
    isOpen?: boolean;

  @ApiProperty({
    description: 'Coder notes for the unit',
    example: 'This unit needs manual coding due to ambiguity.',
    required: false
  })
    notes?: string;
}
