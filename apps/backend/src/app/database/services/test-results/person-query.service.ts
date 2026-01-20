import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import Persons from '../../entities/persons.entity';
import { Booklet } from '../../entities/booklet.entity';
import { Unit } from '../../entities/unit.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { TestResultsUploadStatsDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

@Injectable()
export class PersonQueryService {
  private readonly logger = new Logger(PersonQueryService.name);

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>
  ) {}

  async getWorkspaceGroups(workspaceId: number): Promise<string[]> {
    try {
      const result = await this.personsRepository
        .createQueryBuilder('person')
        .select('DISTINCT person.group', 'group')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getRawMany();

      return result.map(item => item.group);
    } catch (error) {
      this.logger.error(`Error fetching groups for workspace ${workspaceId}: ${error.message}`);
      return [];
    }
  }

  async getWorkspaceUploadStats(workspaceId: number): Promise<TestResultsUploadStatsDto> {
    try {
      const testPersons = await this.personsRepository.count({
        where: { workspace_id: workspaceId, consider: true }
      });

      const groupRows = await this.personsRepository
        .createQueryBuilder('person')
        .select('DISTINCT person.group', 'group')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getRawMany();
      const testGroups = groupRows.length;

      const bookletRows = await this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select('DISTINCT bookletinfo.name', 'name')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getRawMany();
      const uniqueBooklets = bookletRows.length;

      const unitRows = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .select('DISTINCT COALESCE(unit.alias, unit.name)', 'unitKey')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getRawMany();
      const uniqueUnits = unitRows.length;

      const uniqueResponses = await this.responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getCount();

      return {
        testPersons,
        testGroups,
        uniqueBooklets,
        uniqueUnits,
        uniqueResponses
      };
    } catch (error) {
      this.logger.error(`Error fetching workspace upload stats: ${error.message}`);
      return {
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0
      };
    }
  }

  async getWorkspaceGroupCodingStats(
    workspaceId: number
  ): Promise<{ groupName: string; testPersonCount: number; responsesToCode: number }[]> {
    try {
      const derivePending = statusStringToNumber('DERIVE_PENDING') as number | null;

      const rawResults = await this.responseRepository
        .createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere(new Brackets(qb => {
          qb.where('response.status IN (:...statuses)', { statuses: [1, 2, 3] });
          if (derivePending !== null && !Number.isNaN(derivePending)) {
            qb.orWhere('response.status_v1 = :derivePending', { derivePending });
          }
        }))
        .select('person.group', 'groupName')
        .addSelect('COUNT(DISTINCT person.id)', 'testPersonCount')
        .addSelect('COUNT(response.id)', 'responsesToCode')
        .groupBy('person.group')
        .getRawMany();

      return rawResults.map(item => ({
        groupName: item.groupName,
        testPersonCount: Number(item.testPersonCount) || 0,
        responsesToCode: Number(item.responsesToCode) || 0
      }));
    } catch (error) {
      this.logger.error(`Error fetching workspace group coding stats: ${error.message}`);
      return [];
    }
  }

  async hasBookletLogsForGroup(workspaceId: number, groupName: string): Promise<boolean> {
    try {
      const count = await this.bookletLogRepository
        .createQueryBuilder('bookletlog')
        .innerJoin('bookletlog.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.group = :groupName', { groupName })
        .andWhere('person.consider = :consider', { consider: true })
        .getCount();

      return count > 0;
    } catch (error) {
      this.logger.error(`Error checking booklet logs for group ${groupName}: ${error.message}`);
      return false;
    }
  }

  async getGroupsWithBookletLogs(workspaceId: number): Promise<Map<string, boolean>> {
    try {
      const groups = await this.getWorkspaceGroups(workspaceId);
      const groupsWithLogs = new Map<string, boolean>();
      for (const group of groups) {
        const hasLogs = await this.hasBookletLogsForGroup(workspaceId, group);
        groupsWithLogs.set(group, hasLogs);
      }

      return groupsWithLogs;
    } catch (error) {
      this.logger.error(`Error getting groups with booklet logs: ${error.message}`);
      return new Map<string, boolean>();
    }
  }

  async getImportStatistics(workspaceId: number): Promise<{
    persons: number;
    booklets: number;
    units: number;
  }> {
    try {
      const personsCount = await this.personsRepository.count({
        where: { workspace_id: workspaceId, consider: true }
      });

      const bookletsCount = await this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getCount();

      const unitsCount = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .getCount();

      return {
        persons: personsCount,
        booklets: bookletsCount,
        units: unitsCount
      };
    } catch (error) {
      this.logger.error(`Error fetching import statistics: ${error.message}`);
      return {
        persons: 0,
        booklets: 0,
        units: 0
      };
    }
  }

  async getLogCoverageStats(workspaceId: number): Promise<{
    bookletsWithLogs: number;
    totalBooklets: number;
    unitsWithLogs: number;
    totalUnits: number;
    bookletDetails?: { name: string; hasLog: boolean }[];
    unitDetails?: { bookletName: string; unitKey: string; hasLog: boolean }[];
  }> {
    try {
      // Get detailed booklet stats
      const start = Date.now();
      const bookletRows = await this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.bookletLogs', 'bookletlog')
        .select('bookletinfo.name', 'name')
        .addSelect('COUNT(bookletlog.id)', 'logCount')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .groupBy('bookletinfo.name')
        .getRawMany();

      const bookletDetails = bookletRows.map(row => ({
        name: row.name,
        hasLog: Number(row.logCount) > 0
      }));

      const totalBooklets = bookletDetails.length;
      const bookletsWithLogs = bookletDetails.filter(b => b.hasLog).length;

      // Get detailed unit stats
      const unitRows = await this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .leftJoin('unit.unitLogs', 'unitlog')
        .select('bookletinfo.name', 'bookletName')
        .addSelect('COALESCE(unit.alias, unit.name)', 'unitKey')
        .addSelect('COUNT(unitlog.id)', 'logCount')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .groupBy('bookletinfo.name')
        .addGroupBy('unit.alias')
        .addGroupBy('unit.name')
        .getRawMany();

      const unitDetails = unitRows.map(row => ({
        bookletName: row.bookletName,
        unitKey: row.unitKey,
        hasLog: Number(row.logCount) > 0
      }));

      const totalUnits = unitDetails.length;
      const unitsWithLogs = unitDetails.filter(u => u.hasLog).length;

      this.logger.log(`Calculated log coverage stats in ${Date.now() - start}ms`);

      return {
        bookletsWithLogs,
        totalBooklets,
        unitsWithLogs,
        totalUnits,
        bookletDetails,
        unitDetails
      };
    } catch (error) {
      this.logger.error(`Error fetching log coverage statistics: ${error.message}`);
      return {
        bookletsWithLogs: 0,
        totalBooklets: 0,
        unitsWithLogs: 0,
        totalUnits: 0,
        bookletDetails: [],
        unitDetails: []
      };
    }
  }
}
