import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JournalEntry } from '../../entities/journal-entry.entity';

/**
 * Service for managing journal entries
 */
@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);

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
    entityId: number,
    details?: Record<string, unknown>
  ): Promise<JournalEntry> {
    try {
      this.logger.log(
        `Creating journal entry: user=${userId}, workspace=${workspaceId}, action=${actionType}, entity=${entityType}, entityId=${entityId}`
      );

      const entry = this.journalRepository.create({
        userId,
        workspaceId,
        actionType,
        entityType,
        entityId,
        details
      });

      return await this.journalRepository.save(entry);
    } catch (error) {
      this.logger.error(
        `Failed to create journal entry: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to create journal entry: ${error.message}`);
    }
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
  ): Promise<{ data: JournalEntry[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const skip = (page - 1) * limit;

      const [entries, total] = await this.journalRepository.findAndCount({
        where: { workspaceId },
        order: { timestamp: 'DESC' },
        skip,
        take: limit
      });

      return { data: entries, total };
    } catch (error) {
      this.logger.error(
        `Failed to find journal entries for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to find journal entries: ${error.message}`);
    }
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
  ): Promise<{ data: JournalEntry[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const skip = (page - 1) * limit;

      const [entries, total] = await this.journalRepository.findAndCount({
        where: { userId },
        order: { timestamp: 'DESC' },
        skip,
        take: limit
      });

      return { data: entries, total };
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
    entityId: number,
    options: { page?: number; limit?: number } = {}
  ): Promise<{ data: JournalEntry[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const skip = (page - 1) * limit;

      const [entries, total] = await this.journalRepository.findAndCount({
        where: { entityType, entityId },
        order: { timestamp: 'DESC' },
        skip,
        take: limit
      });

      return { data: entries, total };
    } catch (error) {
      this.logger.error(
        `Failed to find journal entries for entity ${entityType}:${entityId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to find journal entries: ${error.message}`);
    }
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
        return 'No journal entries found';
      }

      // CSV header
      const header = [
        'ID',
        'Timestamp',
        'User ID',
        'Action Type',
        'Entity Type',
        'Entity ID',
        'Details'
      ].join(',');

      // CSV rows
      const rows = entries.map(entry => {
        const details = entry.details ? JSON.stringify(entry.details).replace(/"/g, '""') : '';
        return [
          entry.id,
          entry.timestamp.toISOString(),
          entry.userId,
          entry.actionType,
          entry.entityType,
          entry.entityId,
          `"${details}"`
        ].join(',');
      });

      return [header, ...rows].join('\n');
    } catch (error) {
      this.logger.error(
        `Failed to generate CSV for workspace ${workspaceId}: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to generate CSV: ${error.message}`);
    }
  }

  async search(
    filters: {
      workspaceId?: number;
      userId?: string;
      actionType?: string;
      entityType?: string;
      entityId?: number;
      fromDate?: Date;
      toDate?: Date;
    },
    options: { page?: number; limit?: number } = {}
  ): Promise<{ data: JournalEntry[]; total: number }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const skip = (page - 1) * limit;

      const queryBuilder = this.journalRepository.createQueryBuilder('journal');

      if (filters.workspaceId) {
        queryBuilder.andWhere('journal.workspaceId = :workspaceId', { workspaceId: filters.workspaceId });
      }

      if (filters.userId) {
        queryBuilder.andWhere('journal.userId = :userId', { userId: filters.userId });
      }

      if (filters.actionType) {
        queryBuilder.andWhere('journal.actionType = :actionType', { actionType: filters.actionType });
      }

      if (filters.entityType) {
        queryBuilder.andWhere('journal.entityType = :entityType', { entityType: filters.entityType });
      }

      if (filters.entityId) {
        queryBuilder.andWhere('journal.entityId = :entityId', { entityId: filters.entityId });
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

      return { data: entries, total };
    } catch (error) {
      this.logger.error(
        `Failed to search journal entries: ${error.message}`,
        error.stack
      );
      throw new Error(`Failed to search journal entries: ${error.message}`);
    }
  }
}
