import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional
} from 'class-validator';

/**
 * DTO for creating a journal entry
 */
export class CreateJournalEntryDto {
  @ApiProperty({
    description: 'Type of action performed (e.g., create, update, delete)',
    example: 'create'
  })
  @IsNotEmpty()
  @IsString()
    action_type: string;

  @ApiProperty({
    description: 'Type of entity that was affected (e.g., unit, response, file)',
    example: 'unit'
  })
  @IsNotEmpty()
  @IsString()
    entity_type: string;

  @ApiProperty({
    description: 'ID of the entity that was affected',
    example: '123'
  })
  @IsNotEmpty()
  @IsString()
    entity_id: string;

  @ApiProperty({
    description: 'Additional details about the action in JSON format',
    example: '{"method":"POST","url":"/api/units","requestBody":{"name":"Test Unit"}}'
  })
  @IsOptional()
  @IsString()
    details?: string;
}
