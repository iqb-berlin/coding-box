import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
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
    example: 'create'
  })
  @IsNotEmpty()
  @IsString()
    action_type: string;

  @ApiProperty({
    description: 'Canonical audit event type',
    example: 'WORKSPACE_SETTINGS_CHANGED',
    required: false
  })
  @IsOptional()
  @IsString()
    eventType?: string;

  @ApiProperty({
    description: 'Type of entity that was affected (e.g., unit, response, file)',
    example: 'unit'
  })
  @IsNotEmpty()
  @IsString()
    entity_type: string;

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
    example: '123'
  })
  @IsNotEmpty()
  @IsString()
    entity_id: string;

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
    example: 'Workspace settings changed',
    required: false
  })
  @IsOptional()
  @IsString()
    summary?: string;

  @ApiProperty({
    description: 'Additional details about the action in JSON format',
    example: '{"method":"POST","url":"/api/units","requestBody":{"name":"Test Unit"}}'
  })
  @IsOptional()
    details?: string | Record<string, unknown>;

  @ApiProperty({
    description: 'Optional request or job correlation ID',
    example: 'f9ec1a0b-03bc-4d73-a92c-713cc2e1eb63',
    required: false
  })
  @IsOptional()
  @IsString()
    correlationId?: string;

  @ApiProperty({
    description: 'Optional background job ID',
    example: '42',
    required: false
  })
  @IsOptional()
  @IsString()
    jobId?: string;
}
