import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsIn,
  IsOptional
} from 'class-validator';
import {
  AuditActorType,
  AuditEventResult,
  auditActorTypes,
  auditEventResults
} from '../../../../../../../api-dto/audit-journal/audit-journal.dto';

/**
 * DTO for creating a journal entry
 */
export class CreateJournalEntryDto {
  @ApiProperty({
    description: 'Type of action performed (e.g., create, update, delete)',
    example: 'create',
    required: false
  })
  @IsOptional()
  @IsString()
    action_type?: string;

  @ApiProperty({
    description: 'Manual note event type; trusted backend event types are not accepted',
    example: 'MANUAL_NOTE_CREATED',
    required: false
  })
  @IsOptional()
  @IsString()
    eventType?: string;

  @ApiProperty({
    description: 'Type of entity that was affected (e.g., unit, response, file)',
    example: 'unit',
    required: false
  })
  @IsOptional()
  @IsString()
    entity_type?: string;

  @ApiProperty({
    description: 'Type of entity that was affected',
    example: 'workspace',
    required: false
  })
  @IsOptional()
  @IsString()
    entityType?: string;

  @ApiProperty({
    description: 'ID of the entity that was affected',
    example: '123',
    required: false
  })
  @IsOptional()
  @IsString()
    entity_id?: string;

  @ApiProperty({
    description: 'ID of the entity that was affected',
    example: '123',
    required: false
  })
  @IsOptional()
  @IsString()
    entityId?: string;

  @ApiProperty({
    description: 'Actor category',
    enum: auditActorTypes,
    example: 'user',
    required: false
  })
  @IsOptional()
  @IsIn(auditActorTypes)
    actorType?: AuditActorType;

  @ApiProperty({
    description: 'Result state of the audited event',
    enum: auditEventResults,
    example: 'success',
    required: false
  })
  @IsOptional()
  @IsIn(auditEventResults)
    result?: AuditEventResult;

  @ApiProperty({
    description: 'Privacy-conscious human-readable summary',
    example: 'Manual workspace note',
    required: false
  })
  @IsOptional()
  @IsString()
    summary?: string;

  @ApiProperty({
    description: 'Additional details about the action in JSON format',
    example: '{"note":"Import checked"}',
    required: false
  })
  @IsOptional()
    details?: string | Record<string, unknown>;

  @ApiProperty({
    description: 'Reserved for backend events; must be omitted for manual notes',
    example: 'f9ec1a0b-03bc-4d73-a92c-713cc2e1eb63',
    required: false
  })
  @IsOptional()
  @IsString()
    correlationId?: string;

  @ApiProperty({
    description: 'Reserved for backend events; must be omitted for manual notes',
    example: '42',
    required: false
  })
  @IsOptional()
  @IsString()
    jobId?: string;
}
