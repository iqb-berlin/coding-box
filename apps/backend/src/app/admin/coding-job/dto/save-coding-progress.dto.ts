import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsObject,
  IsOptional,
  IsBoolean,
  ValidateIf,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';
import { SaveCodingProgressSelectedCodeDto } from './save-coding-progress-selected-code.dto';

/**
 * DTO for saving partial coding progress
 */
export class SaveCodingProgressDto {
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
    description: 'Selected code object. Send null to clear the saved coding for this unit-variable combination.',
    example: {
      id: 1, code: 'A1', label: 'Answer 1', score: 1
    }
  })
  @ValidateIf(o => o.selectedCode !== null && o.selectedCode !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => SaveCodingProgressSelectedCodeDto)
    selectedCode?: SaveCodingProgressSelectedCodeDto | null;

  @ApiProperty({
    description: 'Whether the unit is marked as open',
    example: false,
    required: false
  })
  @IsBoolean()
  @IsOptional()
    isOpen?: boolean;

  @ApiProperty({
    description: 'Coder notes for the unit',
    example: 'This unit needs manual coding due to ambiguity.',
    required: false
  })
  @IsString()
  @IsOptional()
    notes?: string;

  @ApiProperty({
    description: 'Save this entry as a coding issue review by the current user.',
    example: false,
    required: false
  })
  @IsBoolean()
  @IsOptional()
    issueReview?: boolean;
}
