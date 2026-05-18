import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { JournalEntry } from '../../entities/journal-entry.entity';
import {
  AuditActorType,
  AuditEventResult,
  AuditEventType,
  AuditJournalEntryDto,
  PaginatedAuditJournalEntriesDto,
  auditActorTypes,
  auditEventResults
} from '../../../../../../../api-dto/audit-journal/audit-journal.dto';

export interface AuditJournalSearchFilters {
  workspaceId?: number;
  actorUserId?: number;
  legacyUserId?: string;
  actorType?: AuditActorType;
  eventType?: AuditEventType | string;
  actionType?: string;
  entityType?: string;
  entityId?: string;
  result?: AuditEventResult;
  fromDate?: Date;
  toDate?: Date;
}

export interface RecordAuditJournalEventInput {
  workspaceId: number;
  actorUserId?: number | string | null;
  actorType?: AuditActorType;
  eventType: AuditEventType | string;
  legacyActionType?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
  result?: AuditEventResult;
  summary?: string;
  details?: Record<string, unknown> | null;
  correlationId?: string | null;
  jobId?: string | number | null;
}

/**
 * Service for managing journal entries
 */
@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);
  private readonly sensitiveDetailKeys = new Set([
    'auth',
    'authorization',
    'authtoken',
    'code',
    'group',
    'groups',
    'login',
    'parameter',
    'password',
    'personcode',
    'persongroup',
    'personid',
    'personlogin',
    'requestbody',
    'responsevalue',
    'responsevalues',
    'token',
    'value'
  ]);

  constructor(
    @InjectRepository(JournalEntry)
    private journalRepository: Repository<JournalEntry>
  ) {}

  /**
   * Create a new journal entry
   * @param userId ID of the user who performed the action
   * @param workspaceId ID of the workspace where the action was performed
   * @param actionType Type of action performed (e.g., CREATE, UPDATE, DELETE)
   * @param entityType Type of entity that was affected (e.g., UNIT, RESPONSE, PERSON, TAG)
   * @param entityId ID of the entity that was affected
   * @param details Additional details about the action
   * @returns The created journal entry
   */
  async createEntry(
    userId: string,
    workspaceId: number,
    actionType: string,
    entityType: string,
    entityId: string | number | null,
    details?: Record<string, unknown>,
    manager?: EntityManager
  ): Promise<JournalEntry> {
    return this.recordEvent({
      workspaceId,
      actorUserId: userId,
      actorType: 'user',
      eventType: this.toLegacyEventType(actionType, entityType),
      legacyActionType: actionType,
      entityType,
      entityId,
      result: 'success',
      summary: this.createSummary(actionType, entityType, entityId),
      details
    }, manager);
  }

  async recordEvent(
    event: RecordAuditJournalEventInput,
    manager?: EntityManager
  ): Promise<JournalEntry> {
    try {
      const repository = manager ?
        manager.getRepository(JournalEntry) :
        this.journalRepository;
      const actorUserId = this.normalizeActorUserId(event.actorUserId);
      const rawActorUserId = this.normalizeRawActorUserId(event.actorUserId);
      const actorType = this.normalizeActorType(event.actorType);
      const eventType = String(event.eventType || '').trim();
      if (!eventType) {
        throw new Error('eventType is required');
      }
      const actionType = this.normalizeLegacyActionType(event.legacyActionType, eventType);

      const entityType = event.entityType ? String(event.entityType) : null;
      const entityId = event.entityId === undefined || event.entityId === null ?
        null :
        String(event.entityId);
      const result = this.normalizeResult(event.result);
      const summary = this.createAuditSummary(eventType, entityType, entityId, event.summary);
      const entry = repository.create({
        userId: rawActorUserId || actorType,
        actorUserId,
        actorType,
        workspaceId: event.workspaceId,
        actionType,
        eventType,
        entityType: entityType || 'workspace',
        entityId,
        result,
        summary,
        correlationId: event.correlationId || null,
        jobId: event.jobId === undefined || event.jobId === null ? null : String(event.jobId),
        details: this.sanitizeDetails(event.details || null)
      });

      return await repository.save(entry);
    } catch (error) {
      this.logger.error(
        `Failed to record audit journal event: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to record audit journal event: ${error.message}`);
    }
  }

  mapLegacyEventType(actionType: string, entityType: string): string {
    return this.toLegacyEventType(actionType, entityType);
  }

  toAuditDto(entry: JournalEntry): AuditJournalEntryDto {
    return this.toDto(entry);
  }

  /**
   * Find journal entries by workspace ID
   * @param workspaceId ID of the workspace
   * @param options Pagination options
   * @returns Journal entries for the workspace
   */
  async findByWorkspace(
    workspaceId: number,
    options: { page?: number; limit?: number } = {}
  ): Promise<PaginatedAuditJournalEntriesDto> {
    return this.search({ workspaceId }, options);
  }

  /**
   * Find journal entries by user ID
   * @param userId ID of the user
   * @param options Pagination options
   * @returns Journal entries for the user
   */
  async findByUser(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<PaginatedAuditJournalEntriesDto> {
    try {
      const actorUserId = this.normalizeActorUserId(userId);
      if (actorUserId !== null) {
        return await this.search({ actorUserId }, options);
      }
      return await this.searchLegacyUserId(userId, options);
    } catch (error) {
      this.logger.error(
        `Failed to find journal entries for user ${userId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to find journal entries: ${error.message}`);
    }
  }

  /**
   * Find journal entries by entity type and ID
   * @param entityType Type of entity
   * @param entityId ID of the entity
   * @param options Pagination options
   * @returns Journal entries for the entity
   */
  async findByEntity(
    entityType: string,
    entityId: string | number,
    options: { page?: number; limit?: number } = {}
  ): Promise<PaginatedAuditJournalEntriesDto> {
    return this.search({ entityType, entityId: String(entityId) }, options);
  }

  /**
   * Search journal entries with filters
   * @param filters Search filters
   * @param options Pagination options
   * @returns Journal entries matching the filters
   */
  /**
   * Generate CSV data for journal entries
   * @param workspaceId ID of the workspace
   * @returns CSV data as a string
   */
  async generateCsv(workspaceId: number): Promise<string> {
    try {
      // Get all journal entries for the workspace without pagination
      const entries = await this.journalRepository.find({
        where: { workspaceId },
        order: { timestamp: 'DESC' }
      });

      if (entries.length === 0) {
        return this.toCsv([this.getCsvHeader()]);
      }

      return this.toCsv([
        this.getCsvHeader(),
        ...entries.map(entry => this.toCsvRow(this.toDto(entry)))
      ]);
    } catch (error) {
      this.logger.error(
        `Failed to generate CSV for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to generate CSV: ${error.message}`);
    }
  }

  async search(
    filters: AuditJournalSearchFilters,
    options: { page?: number; limit?: number } = {}
  ): Promise<PaginatedAuditJournalEntriesDto> {
    try {
      const page = this.normalizePage(options.page);
      const limit = this.normalizeLimit(options.limit);
      const skip = (page - 1) * limit;

      const queryBuilder = this.journalRepository.createQueryBuilder('journal');

      if (filters.workspaceId !== undefined) {
        queryBuilder.andWhere('journal.workspaceId = :workspaceId', { workspaceId: filters.workspaceId });
      }

      if (filters.actorUserId !== undefined) {
        queryBuilder.andWhere('journal.actorUserId = :actorUserId', { actorUserId: filters.actorUserId });
      }

      if (filters.legacyUserId) {
        queryBuilder.andWhere('journal.userId = :legacyUserId', { legacyUserId: filters.legacyUserId });
      }

      if (filters.actorType) {
        queryBuilder.andWhere('journal.actorType = :actorType', { actorType: filters.actorType });
      }

      if (filters.eventType) {
        queryBuilder.andWhere('journal.eventType = :eventType', { eventType: filters.eventType });
      }

      if (filters.actionType) {
        queryBuilder.andWhere('journal.actionType = :actionType', { actionType: filters.actionType });
      }

      if (filters.entityType) {
        queryBuilder.andWhere('journal.entityType = :entityType', { entityType: filters.entityType });
      }

      if (filters.entityId !== undefined) {
        queryBuilder.andWhere('journal.entityId = :entityId', { entityId: filters.entityId });
      }

      if (filters.result) {
        queryBuilder.andWhere('journal.result = :result', { result: filters.result });
      }

      if (filters.fromDate) {
        queryBuilder.andWhere('journal.timestamp >= :fromDate', { fromDate: filters.fromDate });
      }

      if (filters.toDate) {
        queryBuilder.andWhere('journal.timestamp <= :toDate', { toDate: filters.toDate });
      }

      queryBuilder.orderBy('journal.timestamp', 'DESC');
      queryBuilder.skip(skip);
      queryBuilder.take(limit);

      const [entries, total] = await queryBuilder.getManyAndCount();

      return {
        data: entries.map(entry => this.toDto(entry)),
        total,
        page,
        limit
      };
    } catch (error) {
      this.logger.error(
        `Failed to search journal entries: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to search journal entries: ${error.message}`);
    }
  }

  private async searchLegacyUserId(
    userId: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<PaginatedAuditJournalEntriesDto> {
    const page = this.normalizePage(options.page);
    const limit = this.normalizeLimit(options.limit);
    const skip = (page - 1) * limit;
    const [entries, total] = await this.journalRepository.findAndCount({
      where: { userId },
      order: { timestamp: 'DESC' },
      skip,
      take: limit
    });

    return {
      data: entries.map(entry => this.toDto(entry)),
      total,
      page,
      limit
    };
  }

  private normalizePage(page?: number): number {
    const parsed = Number(page || 1);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  private normalizeLimit(limit?: number): number {
    const parsed = Number(limit || 20);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return 20;
    }
    return Math.min(parsed, 100);
  }

  private normalizeActorUserId(actorUserId?: number | string | null): number | null {
    if (actorUserId === undefined || actorUserId === null || actorUserId === '') {
      return null;
    }
    const parsed = Number(actorUserId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  private normalizeRawActorUserId(actorUserId?: number | string | null): string | null {
    if (actorUserId === undefined || actorUserId === null) {
      return null;
    }
    const normalized = String(actorUserId).trim();
    return normalized || null;
  }

  private normalizeActorType(actorType?: AuditActorType): AuditActorType {
    if (actorType && auditActorTypes.includes(actorType)) {
      return actorType;
    }
    return 'user';
  }

  private normalizeResult(result?: AuditEventResult): AuditEventResult {
    if (result && auditEventResults.includes(result)) {
      return result;
    }
    return 'success';
  }

  private normalizeLegacyActionType(legacyActionType: string | null | undefined, eventType: string): string {
    const explicitLegacyActionType = legacyActionType?.trim();
    if (explicitLegacyActionType) {
      return explicitLegacyActionType;
    }
    return this.toLegacyActionType(eventType);
  }

  private toLegacyActionType(eventType: string): string {
    const normalizedEventType = eventType.trim().toUpperCase();
    if (normalizedEventType === 'CODING_VERSION_RESET') {
      return 'RESET_VERSION';
    }
    if (normalizedEventType === 'DUPLICATE_RESPONSES_RESOLVED') {
      return 'resolve_duplicates';
    }
    if (normalizedEventType.endsWith('_DELETED')) {
      return 'delete';
    }
    if (normalizedEventType.endsWith('_CREATED')) {
      return 'create';
    }
    if (normalizedEventType.endsWith('_UPDATED')) {
      return 'update';
    }
    if (normalizedEventType.endsWith('_APPROVED')) {
      return 'approve';
    }
    if (normalizedEventType.endsWith('_APPLIED')) {
      return 'apply';
    }
    if (normalizedEventType.endsWith('_IMPORTED')) {
      return 'import';
    }
    if (normalizedEventType.endsWith('_EXPORT_STARTED')) {
      return 'export';
    }
    if (normalizedEventType.endsWith('_STARTED')) {
      return 'start';
    }
    if (normalizedEventType.endsWith('_COMPLETED')) {
      return 'complete';
    }
    if (normalizedEventType.endsWith('_FAILED')) {
      return 'fail';
    }
    return eventType;
  }

  private toLegacyEventType(actionType: string, entityType: string): string {
    const normalizedAction = String(actionType || 'event').trim().replace(/[-\s]+/g, '_').toUpperCase();
    const normalizedEntity = String(entityType || 'workspace').trim().replace(/[-\s]+/g, '_').toUpperCase();
    if (normalizedAction === 'DELETE') {
      switch (normalizedEntity) {
        case 'TEST_PERSON':
          return 'TEST_PERSON_DELETED';
        case 'TEST_RESULTS':
          return 'TEST_RESULTS_DELETED';
        case 'TEST_LOGS':
          return 'TEST_LOGS_DELETED';
        case 'BOOKLET':
          return 'BOOKLET_DELETED';
        case 'UNIT':
          return 'UNIT_DELETED';
        case 'RESPONSE':
          return 'RESPONSE_DELETED';
        default:
          return `${normalizedEntity}_DELETED`;
      }
    }
    if (normalizedAction === 'RESET_VERSION') {
      return 'CODING_VERSION_RESET';
    }
    return `${normalizedEntity}_${normalizedAction}`;
  }

  private createSummary(actionType: string, entityType: string, entityId: string | number | null): string {
    const suffix = entityId === null || entityId === undefined ? '' : ` ${entityId}`;
    return `${actionType} ${entityType}${suffix}`.trim();
  }

  private createAuditSummary(
    eventType: string,
    entityType: string | null,
    entityId: string | null,
    summary?: string
  ): string {
    if (summary && summary.trim()) {
      return summary.trim();
    }
    const entity = entityType ? ` (${entityType}${entityId ? ` ${entityId}` : ''})` : '';
    return `${eventType}${entity}`;
  }

  private sanitizeDetails(details: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!details || typeof details !== 'object') {
      return null;
    }

    const sanitized: Record<string, unknown> = {};
    Object.entries(details).forEach(([key, value]) => {
      if (this.sensitiveDetailKeys.has(this.normalizeDetailKey(key))) {
        return;
      }
      if (key === 'preview' && this.isRecord(value)) {
        sanitized[key] = this.sanitizePreview(value);
        return;
      }
      sanitized[key] = this.sanitizeDetailValue(value);
    });

    return Object.keys(sanitized).length > 0 ? sanitized : null;
  }

  private sanitizeDetailValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      if (value.length > 50) {
        return {
          itemCount: value.length
        };
      }
      return value.map(item => this.sanitizeDetailValue(item));
    }
    if (this.isRecord(value)) {
      return this.sanitizeDetails(value);
    }
    return value instanceof Date ? value.toISOString() : value;
  }

  private sanitizePreview(preview: Record<string, unknown>): Record<string, unknown> {
    const allowedKeys = [
      'scope',
      'persons',
      'booklets',
      'units',
      'responses',
      'bookletLogs',
      'unitLogs',
      'sessions',
      'warnings'
    ];
    return allowedKeys.reduce((accumulator, key) => {
      if (preview[key] !== undefined) {
        accumulator[key] = this.sanitizeDetailValue(preview[key]);
      }
      return accumulator;
    }, {} as Record<string, unknown>);
  }

  private normalizeDetailKey(key: string): string {
    return key.replace(/[-_\s]/g, '').toLowerCase();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  private toDto(entry: JournalEntry): AuditJournalEntryDto {
    const actorUserId = entry.actorUserId ?? this.normalizeActorUserId(entry.userId);
    const actorType = this.normalizeActorType(entry.actorType as AuditActorType);
    const actorId = this.normalizeActorId(entry.userId, actorUserId, actorType);
    const eventType = entry.eventType || this.toLegacyEventType(entry.actionType, entry.entityType);
    const result = this.normalizeResult(entry.result as AuditEventResult);
    const entityId = entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId);

    return {
      id: entry.id,
      timestamp: entry.timestamp instanceof Date ? entry.timestamp.toISOString() : String(entry.timestamp),
      workspaceId: entry.workspaceId,
      actorId,
      actorUserId,
      actorType,
      eventType,
      entityType: entry.entityType || null,
      entityId,
      result,
      summary: entry.summary || this.createAuditSummary(eventType, entry.entityType, entityId),
      details: this.sanitizeDetails(entry.details || null),
      correlationId: entry.correlationId || null,
      jobId: entry.jobId || null
    };
  }

  private getCsvHeader(): string[] {
    return [
      'id',
      'timestamp',
      'workspaceId',
      'actorId',
      'actorUserId',
      'actorType',
      'eventType',
      'entityType',
      'entityId',
      'result',
      'summary',
      'correlationId',
      'jobId',
      'details'
    ];
  }

  private toCsvRow(entry: AuditJournalEntryDto): string[] {
    return [
      String(entry.id),
      entry.timestamp,
      String(entry.workspaceId),
      entry.actorId || '',
      entry.actorUserId === null ? '' : String(entry.actorUserId),
      entry.actorType,
      entry.eventType,
      entry.entityType || '',
      entry.entityId || '',
      entry.result,
      entry.summary,
      entry.correlationId || '',
      entry.jobId || '',
      entry.details ? JSON.stringify(entry.details) : ''
    ];
  }

  private toCsv(rows: string[][]): string {
    return rows.map(row => row.map(value => this.escapeCsvValue(value)).join(',')).join('\n');
  }

  private escapeCsvValue(value: string): string {
    const normalized = value.replace(/\r?\n/g, ' ');
    if (!/[",\n\r]/.test(normalized)) {
      return normalized;
    }
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  private normalizeActorId(
    userId: string | null | undefined,
    actorUserId: number | null,
    actorType: AuditActorType
  ): string | null {
    const normalized = this.normalizeRawActorUserId(userId);
    if (!normalized) {
      return null;
    }
    if (normalized === actorType || normalized === String(actorUserId)) {
      return null;
    }
    return normalized;
  }
}
