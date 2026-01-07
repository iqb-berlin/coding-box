import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Persons, Unit, ResponseEntity } from '../../common';
import { Booklet } from '../entities/booklet.entity';
import { Session } from '../entities/session.entity';
import { statusNumberToString } from '../utils/response-status-converter';

/**
 * WorkspaceTestResultsOverviewService
 *
 * Handles workspace test results overview and statistics generation.
 * This service is responsible for:
 * - Calculating test person counts
 * - Counting unique booklets, units, and responses
 * - Aggregating response status counts
 * - Collecting session metadata (browser, OS, screen)
 *
 * Extracted from WorkspaceTestResultsService to improve maintainability.
 */
@Injectable()
export class WorkspaceTestResultsOverviewService {
  private readonly logger = new Logger(WorkspaceTestResultsOverviewService.name);

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>
  ) {}

  /**
   * Get comprehensive overview statistics for a workspace
   */
  async getWorkspaceTestResultsOverview(workspaceId: number): Promise<{
    testPersons: number;
    testGroups: number;
    uniqueBooklets: number;
    uniqueUnits: number;
    uniqueResponses: number;
    responseStatusCounts: Record<string, number>;
    sessionBrowserCounts: Record<string, number>;
    sessionOsCounts: Record<string, number>;
    sessionScreenCounts: Record<string, number>;
  }> {
    if (!workspaceId || workspaceId <= 0) {
      throw new Error('Invalid workspaceId provided');
    }

    this.logger.log(`Generating overview statistics for workspace ${workspaceId}`);

    const [
      testPersons,
      testGroups,
      uniqueBooklets,
      uniqueUnits,
      uniqueResponses,
      responseStatusCounts,
      sessionBrowserCounts,
      sessionOsCounts,
      sessionScreenCounts
    ] = await Promise.all([
      this.countTestPersons(workspaceId),
      this.countTestGroups(workspaceId),
      this.countUniqueBooklets(workspaceId),
      this.countUniqueUnits(workspaceId),
      this.countUniqueResponses(workspaceId),
      this.getResponseStatusCounts(workspaceId),
      this.getSessionBrowserCounts(workspaceId),
      this.getSessionOsCounts(workspaceId),
      this.getSessionScreenCounts(workspaceId)
    ]);

    return {
      testPersons,
      testGroups,
      uniqueBooklets,
      uniqueUnits,
      uniqueResponses,
      responseStatusCounts,
      sessionBrowserCounts,
      sessionOsCounts,
      sessionScreenCounts
    };
  }

  /**
   * Count total test persons in workspace
   */
  private async countTestPersons(workspaceId: number): Promise<number> {
    return this.personsRepository.count({
      where: { workspace_id: workspaceId, consider: true }
    });
  }

  /**
   * Count unique test groups in workspace
   */
  private async countTestGroups(workspaceId: number): Promise<number> {
    const groupRows = await this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.group', 'group')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getRawMany();

    return groupRows.length;
  }

  /**
   * Count unique booklets in workspace
   */
  private async countUniqueBooklets(workspaceId: number): Promise<number> {
    const bookletRows = await this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('DISTINCT bookletinfo.name', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getRawMany();

    return bookletRows.length;
  }

  /**
   * Count unique units in workspace
   */
  private async countUniqueUnits(workspaceId: number): Promise<number> {
    const unitRows = await this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('DISTINCT COALESCE(unit.alias, unit.name)', 'unitKey')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getRawMany();

    return unitRows.length;
  }

  /**
   * Count unique responses in workspace
   */
  private async countUniqueResponses(workspaceId: number): Promise<number> {
    return this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .getCount();
  }

  /**
   * Get response status counts aggregated by status
   */
  private async getResponseStatusCounts(
    workspaceId: number
  ): Promise<Record<string, number>> {
    const statusRows = await this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .select('response.status', 'status')
      .addSelect('COUNT(response.id)', 'count')
      .groupBy('response.status')
      .getRawMany<{ status: string | number; count: string | number }>();

    const responseStatusCounts: Record<string, number> = {};
    (statusRows || []).forEach(r => {
      const num = Number(r.status);
      const label = statusNumberToString(num) || String(num);
      responseStatusCounts[label] = Number(r.count) || 0;
    });

    return responseStatusCounts;
  }

  /**
   * Get session browser counts
   */
  private async getSessionBrowserCounts(
    workspaceId: number
  ): Promise<Record<string, number>> {
    const browserRows = await this.sessionRepository
      .createQueryBuilder('session')
      .innerJoin('session.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .select('session.browser', 'value')
      .addSelect('COUNT(session.id)', 'count')
      .groupBy('session.browser')
      .getRawMany<{ value: string | null; count: string | number }>();

    return this.mapSessionCounts(browserRows);
  }

  /**
   * Get session OS counts
   */
  private async getSessionOsCounts(
    workspaceId: number
  ): Promise<Record<string, number>> {
    const osRows = await this.sessionRepository
      .createQueryBuilder('session')
      .innerJoin('session.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .select('session.os', 'value')
      .addSelect('COUNT(session.id)', 'count')
      .groupBy('session.os')
      .getRawMany<{ value: string | null; count: string | number }>();

    return this.mapSessionCounts(osRows);
  }

  /**
   * Get session screen size counts
   */
  private async getSessionScreenCounts(
    workspaceId: number
  ): Promise<Record<string, number>> {
    const screenRows = await this.sessionRepository
      .createQueryBuilder('session')
      .innerJoin('session.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .select('session.screen', 'value')
      .addSelect('COUNT(session.id)', 'count')
      .groupBy('session.screen')
      .getRawMany<{ value: string | null; count: string | number }>();

    return this.mapSessionCounts(screenRows);
  }

  /**
   * Helper method to map session count rows to a record
   */
  private mapSessionCounts(
    rows: Array<{ value: string | null; count: string | number }>
  ): Record<string, number> {
    const out: Record<string, number> = {};
    (rows || []).forEach(r => {
      const key = String((r.value || '').trim() || 'unknown');
      out[key] = Number(r.count) || 0;
    });
    return out;
  }
}
