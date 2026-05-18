import { ApiProperty } from '@nestjs/swagger';
import { AuditJournalEntryDto } from '../../../../../../../api-dto/audit-journal/audit-journal.dto';

export class AuditJournalEntryResponseDto implements AuditJournalEntryDto {
  @ApiProperty({ example: 1 })
    id: number;

  @ApiProperty({ example: '2026-05-18T12:00:00.000Z' })
    timestamp: string;

  @ApiProperty({ example: 1 })
    workspaceId: number;

  @ApiProperty({ example: 'user-1', nullable: true })
    actorId: string | null;

  @ApiProperty({ example: 123, nullable: true })
    actorUserId: number | null;

  @ApiProperty({ example: 'user', enum: ['user', 'system', 'job'] })
    actorType: 'user' | 'system' | 'job';

  @ApiProperty({ example: 'TEST_RESULTS_DELETED' })
    eventType: string;

  @ApiProperty({ example: 'test-results', nullable: true })
    entityType: string | null;

  @ApiProperty({ example: '42', nullable: true })
    entityId: string | null;

  @ApiProperty({ example: 'success', enum: ['started', 'success', 'failure'] })
    result: 'started' | 'success' | 'failure';

  @ApiProperty({ example: 'Test results deleted' })
    summary: string;

  @ApiProperty({ type: Object, nullable: true })
    details: Record<string, unknown> | null;

  @ApiProperty({ example: 'request-1', nullable: true, required: false })
    correlationId?: string | null;

  @ApiProperty({ example: 'job-1', nullable: true, required: false })
    jobId?: string | null;
}
