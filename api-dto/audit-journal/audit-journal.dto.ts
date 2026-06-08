export const auditActorTypes = ['user', 'system', 'job'] as const;
export type AuditActorType = typeof auditActorTypes[number];

export const auditEventResults = ['started', 'success', 'failure'] as const;
export type AuditEventResult = typeof auditEventResults[number];

export const auditEventTypes = [
  'TEST_RESULTS_IMPORTED',
  'TEST_RESULTS_EXPORT_STARTED',
  'TEST_RESULTS_DELETED',
  'TEST_RESULT_RESPONSES_DELETED',
  'TEST_LOGS_EXPORT_STARTED',
  'TEST_LOGS_DELETED',
  'TEST_PERSON_DELETED',
  'BOOKLET_DELETED',
  'UNIT_DELETED',
  'RESPONSE_DELETED',
  'DUPLICATE_RESPONSES_RESOLVED',
  'CODING_VERSION_RESET',
  'CODING_RESULTS_APPLIED',
  'CODING_JOB_CREATED',
  'CODING_JOB_UPDATED',
  'CODING_JOB_DELETED',
  'JOB_DEFINITION_CREATED',
  'JOB_DEFINITION_APPROVED',
  'JOB_DEFINITION_DELETED',
  'WORKSPACE_SETTINGS_CHANGED',
  'ACCESS_LEVEL_CHANGED',
  'ACCESS_TOKEN_CREATED',
  'DATABASE_EXPORT_STARTED',
  'DATABASE_EXPORT_COMPLETED',
  'DATABASE_EXPORT_FAILED'
] as const;
export type AuditEventType = typeof auditEventTypes[number];

export interface AuditJournalEntryDto {
  id: number;
  timestamp: string;
  workspaceId: number;
  actorId: string | null;
  actorUserId: number | null;
  actorType: AuditActorType;
  eventType: AuditEventType | string;
  entityType: string | null;
  entityId: string | null;
  result: AuditEventResult;
  summary: string;
  details: Record<string, unknown> | null;
  correlationId?: string | null;
  jobId?: string | null;
}

export interface PaginatedAuditJournalEntriesDto {
  data: AuditJournalEntryDto[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditJournalQueryDto {
  page?: number;
  limit?: number;
  userId?: string;
  actorUserId?: number;
  actorType?: AuditActorType;
  eventType?: AuditEventType | string;
  actionType?: string;
  entityType?: string;
  entityId?: string;
  result?: AuditEventResult;
  fromDate?: string;
  toDate?: string;
}
