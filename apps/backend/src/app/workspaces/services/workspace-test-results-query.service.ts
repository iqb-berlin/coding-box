import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Persons, Unit, ResponseEntity } from '../../common';
import { Booklet } from '../entities/booklet.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { Session } from '../entities/session.entity';
import { UnitTagService } from './unit-tag.service';
import { JournalService } from './journal.service';
import { statusNumberToString, statusStringToNumber } from '../utils/response-status-converter';

export interface SearchResponseItem {
  responseId: number;
  variableId: string;
  value: string;
  status: string;
  code?: number;
  score?: number;
  codedStatus?: string;
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

export interface BookletSearchItem {
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  units: {
    unitId: number;
    unitName: string;
    unitAlias: string | null;
  }[];
}

export interface UnitSearchItem {
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  tags: {
    id: number;
    unitId: number;
    tag: string;
    color?: string;
    createdAt: Date;
  }[];
  responses: {
    variableId: string;
    value: string;
    status: string;
    code?: number;
    score?: number;
    codedStatus?: string;
  }[];
}

/**
 * WorkspaceTestResultsQueryService
 *
 * Handles querying and retrieval of test results data.
 * This service is responsible for:
 * - Fetching person-specific test results with booklets, units, and responses
 * - Paginated test results queries
 * - Basic workspace response queries
 * - Aggregating related data (logs, tags, responses)
 *
 * Extracted from WorkspaceTestResultsService to improve maintainability.
 */
@Injectable()
export class WorkspaceTestResultsQueryService {
  private readonly logger = new Logger(WorkspaceTestResultsQueryService.name);

  private readonly MAX_LIMIT = 500;

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private readonly unitTagService: UnitTagService,
    private readonly journalService: JournalService
  ) {}

  /**
   * Find comprehensive test results for a specific person
   * Includes booklets, units, responses, logs, and tags
   */
  async findPersonTestResults(
    personId: number,
    workspaceId: number
  ): Promise<
    {
      id: number;
      name: string;
      logs: {
        id: number;
        bookletid: number;
        ts: string;
        parameter: string;
        key: string;
      }[];
      units: {
        id: number;
        name: string;
        alias: string | null;
        results: {
          id: number;
          unitid: number;
          variableid: string;
          status: string;
          value: string;
          subform: string;
          code?: number;
          score?: number;
          codedstatus?: string;
        }[];
        tags: {
          id: number;
          unitId: number;
          tag: string;
          color?: string;
          createdAt: Date;
        }[];
      }[];
    }[]
    > {
    this.validatePersonQuery(personId, workspaceId);

    this.logger.log(
      `Fetching booklet data for person ${personId} in workspace ${workspaceId}`
    );

    try {
      const booklets = await this.fetchBooklets(personId);

      if (!booklets || booklets.length === 0) {
        this.logger.log(`No booklets found for personId: ${personId}`);
        return [];
      }

      const bookletIds = booklets.map(booklet => booklet.id);

      const [units, bookletLogs] = await Promise.all([
        this.fetchUnitsWithResponses(bookletIds),
        this.fetchBookletLogs(bookletIds)
      ]);

      const unitIds = units.map(unit => unit.id);

      const [unitResultMap, unitTagsMap, bookletLogsMap] = await Promise.all([
        this.buildUnitResultMap(units),
        this.buildUnitTagsMap(unitIds),
        Promise.resolve(this.buildBookletLogsMap(bookletLogs))
      ]);

      const unitsMap = this.buildUnitsMap(units);

      return this.assemblePersonTestResults(
        booklets,
        bookletLogsMap,
        unitsMap,
        unitResultMap,
        unitTagsMap
      );
    } catch (error) {
      this.logger.error(
        `Failed to fetch test results for personId: ${personId} and workspaceId: ${workspaceId}`,
        error.stack
      );
      throw new Error(
        'An error occurred while fetching booklets, their info, units, and test results.'
      );
    }
  }

  /**
   * Find paginated test results (persons) for a workspace
   */
  async findTestResults(
    workspace_id: number,
    options: { page: number; limit: number; searchText?: string }
  ): Promise<[Persons[], number]> {
    const { page, limit, searchText } = options;

    if (!workspace_id || workspace_id <= 0) {
      throw new Error('Invalid workspace_id provided');
    }

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), this.MAX_LIMIT);

    this.logger.log(
      `Fetching test results for workspace ${workspace_id} (page ${validPage}, limit ${validLimit})`
    );

    try {
      const queryBuilder = this.personsRepository
        .createQueryBuilder('person')
        .where('person.workspace_id = :workspace_id', { workspace_id })
        .andWhere('person.consider = :consider', { consider: true })
        .select([
          'person.id',
          'person.group',
          'person.login',
          'person.code',
          'person.uploaded_at'
        ]);

      if (searchText && searchText.trim() !== '') {
        queryBuilder.andWhere(
          '(person.code ILIKE :searchText OR person.group ILIKE :searchText OR person.login ILIKE :searchText)',
          { searchText: `%${searchText.trim()}%` }
        );
      }

      queryBuilder
        .skip((validPage - 1) * validLimit)
        .take(validLimit)
        .orderBy('person.code', 'ASC');

      const [results, total] = await queryBuilder.getManyAndCount();
      return [results, total];
    } catch (error) {
      this.logger.error(
        `Failed to fetch test results for workspace_id ${workspace_id}: ${error.message}`,
        error.stack
      );
      throw new Error('An error occurred while fetching test results');
    }
  }

  /**
   * Find workspace responses with optional pagination
   */
  async findWorkspaceResponses(
    workspace_id: number,
    options?: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    this.logger.log('Returning responses for workspace', workspace_id);

    if (options) {
      const { page, limit } = options;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), this.MAX_LIMIT);

      const [responses, total] = await this.responseRepository.findAndCount({
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { id: 'ASC' }
      });

      this.logger.log(
        `Found ${responses.length} responses (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ${workspace_id}`
      );
      return [responses, total];
    }

    const responses = await this.responseRepository.find({
      order: { id: 'ASC' }
    });

    this.logger.log(
      `Found ${responses.length} responses for workspace ${workspace_id}`
    );
    return [responses, responses.length];
  }

  /**
   * Find a specific unit response for a person and booklet
   */
  async findUnitResponse(
    workspaceId: number,
    connector: string,
    unitId: string
  ): Promise<{
      responses: {
        id: string;
        content: { id: string; value: string; status: string }[];
      }[];
    }> {
    const [login, code, bookletName] = connector.split('@');

    const person = await this.personsRepository.findOne({
      where: { workspace_id: workspaceId, login, code }
    });

    if (!person) {
      this.logger.warn(`Person not found: workspaceId=${workspaceId}, login=${login}, code=${code}`);
      return { responses: [] };
    }

    const booklet = await this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('booklet.personid = :personId', { personId: person.id })
      .andWhere('bookletinfo.name = :bookletName', { bookletName })
      .getOne();

    if (!booklet) {
      this.logger.warn(`Booklet not found: personId=${person.id}, bookletName=${bookletName}`);
      return { responses: [] };
    }

    const unit = await this.unitRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.responses', 'response')
      .where('unit.bookletid = :bookletId', { bookletId: booklet.id })
      .andWhere('(unit.name = :unitId OR unit.alias = :unitId)', { unitId })
      .getOne();

    if (!unit || !unit.responses) {
      return { responses: [] };
    }

    const responses = unit.responses.map(r => ({
      id: r.variableid,
      value: r.value || '',
      status: statusNumberToString(r.status) || 'UNSET'
    }));

    return {
      responses: [
        {
          id: unit.alias || unit.name,
          content: responses
        }
      ]
    };
  }

  /**
   * Find unit logs for a specific unit
   */
  async findUnitLogs(
    workspaceId: number,
    unitId: number
  ): Promise<{ id: number; unitid: number; ts: string; key: string; parameter: string }[]> {
    const logs = await this.unitLogRepository.find({
      where: { unitid: unitId },
      order: { ts: 'ASC' }
    });

    return logs.map(log => ({
      ...log,
      ts: log.ts?.toString() || ''
    }));
  }

  /**
   * Find booklet logs, sessions, and unit logs for a booklet containing the given unit
   */
  async findBookletLogsByUnitId(
    workspaceId: number,
    unitId: number
  ): Promise<{
      bookletId: number;
      logs: { id: number; bookletid: number; ts: string; key: string; parameter: string }[];
      sessions: { id: number; browser: string; os: string; screen: string; ts: string }[];
      units: {
        id: number;
        bookletid: number;
        name: string;
        alias: string | null;
        logs: { id: number; unitid: number; ts: string; key: string; parameter: string }[];
      }[];
    }> {
    const unit = await this.unitRepository.findOne({
      where: { id: unitId },
      relations: ['booklet']
    });

    if (!unit) {
      throw new Error(`Unit with ID ${unitId} not found`);
    }

    const bookletId = unit.bookletid;

    const [bookletLogs, sessions, units] = await Promise.all([
      this.bookletLogRepository.find({
        where: { bookletid: bookletId },
        order: { ts: 'ASC' }
      }),
      this.sessionRepository.find({
        where: { booklet: { id: bookletId } },
        order: { ts: 'ASC' }
      }),
      this.unitRepository.find({
        where: { bookletid: bookletId },
        relations: ['unitLogs'],
        order: { id: 'ASC' }
      })
    ]);

    return {
      bookletId,
      logs: bookletLogs.map(log => ({
        ...log,
        ts: log.ts?.toString() || ''
      })),
      sessions: sessions.map(s => ({
        id: s.id,
        browser: s.browser || '',
        os: s.os || '',
        screen: s.screen || '',
        ts: s.ts?.toString() || ''
      })),
      units: units.map(u => ({
        id: u.id,
        bookletid: u.bookletid,
        name: u.name,
        alias: u.alias || null,
        logs: (u.unitLogs || []).map(l => ({
          ...l,
          ts: l.ts?.toString() || ''
        }))
      }))
    };
  }

  /**
   * Get responses by status with pagination
   */
  async getResponsesByStatus(
    workspaceId: number,
    status: string,
    options: { page: number; limit: number }
  ): Promise<[ResponseEntity[], number]> {
    const { page, limit } = options;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), this.MAX_LIMIT);

    const statusNumber = statusStringToNumber(status);
    if (statusNumber === null) {
      return [[], 0];
    }

    return this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('response.status = :statusNumber', { statusNumber })
      .orderBy('response.id', 'ASC')
      .skip((validPage - 1) * validLimit)
      .take(validLimit)
      .getManyAndCount();
  }

  /**
   * Search responses by value, unit, or variable
   */
  async searchResponses(
    workspaceId: number,
    criteria: {
      value?: string;
      variableId?: string;
      unitName?: string;
      bookletName?: string;
      status?: string;
      codedStatus?: string;
      group?: string;
      code?: string;
      version?: 'v1' | 'v2' | 'v3';
    },
    pagination: { page?: number; limit?: number }
  ): Promise<{ data: SearchResponseItem[]; total: number; page: number; limit: number }> {
    const {
      value, variableId, unitName, bookletName, status, codedStatus, group, code, version = 'v1'
    } = criteria;
    const { page = 1, limit = 20 } = pagination;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), this.MAX_LIMIT);

    const queryBuilder = this.responseRepository
      .createQueryBuilder('response')
      .innerJoinAndSelect('response.unit', 'unit')
      .innerJoinAndSelect('unit.booklet', 'booklet')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .innerJoinAndSelect('booklet.person', 'person')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (value) {
      queryBuilder.andWhere('response.value ILIKE :value', { value: `%${value}%` });
    }
    if (variableId) {
      queryBuilder.andWhere('response.variableid ILIKE :variableId', { variableId: `%${variableId}%` });
    }
    if (unitName) {
      queryBuilder.andWhere('(unit.name ILIKE :unitName OR unit.alias ILIKE :unitName)', { unitName: `%${unitName}%` });
    }
    if (bookletName) {
      queryBuilder.andWhere('bookletinfo.name ILIKE :bookletName', { bookletName: `%${bookletName}%` });
    }
    if (status) {
      const statusNum = statusStringToNumber(status);
      if (statusNum !== null) {
        queryBuilder.andWhere(`response.status_${version} = :statusNum`, { statusNum });
      }
    }
    if (codedStatus) {
      const codedStatusNum = statusStringToNumber(codedStatus);
      if (codedStatusNum !== null) {
        queryBuilder.andWhere(`response.status_${version} = :codedStatusNum`, { codedStatusNum });
      }
    }
    if (group) {
      queryBuilder.andWhere('person.group ILIKE :group', { group: `%${group}%` });
    }
    if (code) {
      queryBuilder.andWhere('person.code ILIKE :code', { code: `%${code}%` });
    }

    const [responses, total] = await queryBuilder
      .orderBy('response.id', 'ASC')
      .skip((validPage - 1) * validLimit)
      .take(validLimit)
      .getManyAndCount();

    const data: SearchResponseItem[] = responses.map(r => ({
      responseId: r.id,
      variableId: r.variableid,
      value: r.value || '',
      status: statusNumberToString(r.status) || 'UNSET',
      code: r[`code_${version}` as keyof ResponseEntity] as number | undefined,
      score: r[`score_${version}` as keyof ResponseEntity] as number | undefined,
      codedStatus: statusNumberToString(r[`status_${version}` as keyof ResponseEntity] as number) || 'UNSET',
      unitId: r.unit?.id,
      unitName: r.unit?.name || 'Unknown',
      unitAlias: r.unit?.alias || null,
      bookletId: r.unit?.booklet?.id,
      bookletName: r.unit?.booklet?.bookletinfo?.name || 'Unknown',
      personId: r.unit?.booklet?.person?.id,
      personLogin: r.unit?.booklet?.person?.login || 'Unknown',
      personCode: r.unit?.booklet?.person?.code || '',
      personGroup: r.unit?.booklet?.person?.group || ''
    }));

    return {
      data, total, page: validPage, limit: validLimit
    };
  }

  /**
   * Find booklets by name with pagination
   */
  async findBookletsByName(
    workspaceId: number,
    bookletName: string,
    options: { page?: number; limit?: number }
  ): Promise<{ data: BookletSearchItem[]; total: number; page: number; limit: number }> {
    const { page = 1, limit = 20 } = options;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), this.MAX_LIMIT);

    const [booklets, total] = await this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .innerJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('booklet.units', 'unit')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('bookletinfo.name ILIKE :bookletName', { bookletName: `%${bookletName}%` })
      .orderBy('booklet.id', 'ASC')
      .skip((validPage - 1) * validLimit)
      .take(validLimit)
      .getManyAndCount();

    const data: BookletSearchItem[] = booklets.map(b => ({
      bookletId: b.id,
      bookletName: b.bookletinfo?.name || 'Unknown',
      personId: b.person?.id,
      personLogin: b.person?.login || 'Unknown',
      personCode: b.person?.code || '',
      personGroup: b.person?.group || '',
      units: (b.units || []).map(u => ({
        unitId: u.id,
        unitName: u.name,
        unitAlias: u.alias || null
      }))
    }));

    return {
      data, total, page: validPage, limit: validLimit
    };
  }

  /**
   * Find units by name with pagination
   */
  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number }
  ): Promise<{ data: UnitSearchItem[]; total: number; page: number; limit: number }> {
    const { page = 1, limit = 20 } = options;
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), this.MAX_LIMIT);

    const [units, total] = await this.unitRepository
      .createQueryBuilder('unit')
      .innerJoinAndSelect('unit.booklet', 'booklet')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .innerJoinAndSelect('booklet.person', 'person')
      .leftJoinAndSelect('unit.tags', 'tag')
      .leftJoinAndSelect('unit.responses', 'response')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('(unit.name ILIKE :unitName OR unit.alias ILIKE :unitName)', { unitName: `%${unitName}%` })
      .orderBy('unit.id', 'ASC')
      .skip((validPage - 1) * validLimit)
      .take(validLimit)
      .getManyAndCount();

    const data: UnitSearchItem[] = units.map(u => ({
      unitId: u.id,
      unitName: u.name,
      unitAlias: u.alias || null,
      bookletId: u.booklet?.id,
      bookletName: u.booklet?.bookletinfo?.name || 'Unknown',
      personId: u.booklet?.person?.id,
      personLogin: u.booklet?.person?.login || 'Unknown',
      personCode: u.booklet?.person?.code || '',
      personGroup: u.booklet?.person?.group || '',
      tags: (u.tags || []).map(t => ({
        id: t.id,
        unitId: t.unitId,
        tag: t.tag,
        color: t.color,
        createdAt: t.createdAt
      })),
      responses: (u.responses || []).map(r => ({
        variableId: r.variableid,
        value: r.value || '',
        status: statusNumberToString(r.status) || 'UNSET',
        code: r.code_v1,
        score: r.score_v1,
        codedStatus: statusNumberToString(r.status_v1) || 'UNSET'
      }))
    }));

    return {
      data, total, page: validPage, limit: validLimit
    };
  }

  /**
   * Delete a single response
   */
  async deleteResponse(
    workspaceId: number,
    responseId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedResponse: number | null; warnings: string[] } }> {
    const response = await this.responseRepository.findOne({
      where: { id: responseId },
      relations: ['unit', 'unit.booklet', 'unit.booklet.person']
    });

    if (!response || response.unit?.booklet?.person?.workspace_id !== workspaceId) {
      return { success: false, report: { deletedResponse: null, warnings: ['Response not found or access denied'] } };
    }

    await this.responseRepository.delete(responseId);
    await this.journalService.createEntry(userId, workspaceId, 'DELETE', 'RESPONSE', responseId);

    return { success: true, report: { deletedResponse: responseId, warnings: [] } };
  }

  /**
   * Delete a booklet and all its associated units and responses
   */
  async deleteBooklet(
    workspaceId: number,
    bookletId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedBooklet: number | null; warnings: string[] } }> {
    const booklet = await this.bookletRepository.findOne({
      where: { id: bookletId },
      relations: ['person']
    });

    if (!booklet || booklet.person?.workspace_id !== workspaceId) {
      return { success: false, report: { deletedBooklet: null, warnings: ['Booklet not found or access denied'] } };
    }

    await this.bookletRepository.delete(bookletId);
    await this.journalService.createEntry(userId, workspaceId, 'DELETE', 'BOOKLET', bookletId);

    return { success: true, report: { deletedBooklet: bookletId, warnings: [] } };
  }

  /**
   * Delete multiple test persons
   */
  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
  ): Promise<{ success: boolean; report: { deletedPersons: string[]; warnings: string[] } }> {
    const ids = testPersonIds
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !Number.isNaN(id));

    if (ids.length === 0) {
      return { success: false, report: { deletedPersons: [], warnings: ['No valid person IDs provided'] } };
    }

    const persons = await this.personsRepository.find({
      where: { id: In(ids), workspace_id: workspaceId }
    });

    if (persons.length === 0) {
      return { success: false, report: { deletedPersons: [], warnings: ['No persons found or access denied'] } };
    }

    const actualIds = persons.map(p => p.id);
    await this.personsRepository.delete({ id: In(actualIds) });

    const deletedIdsStrings = actualIds.map(id => id.toString());
    await this.journalService.createEntry(userId, workspaceId, 'DELETE_MULTIPLE', 'PERSON', 0, { personIds: deletedIdsStrings });

    return { success: true, report: { deletedPersons: deletedIdsStrings, warnings: [] } };
  }

  /**
   * Delete a single unit
   */
  async deleteUnit(
    workspaceId: number,
    unitId: number,
    userId: string
  ): Promise<{ success: boolean; report: { deletedUnit: number | null; warnings: string[] } }> {
    const unit = await this.unitRepository.findOne({
      where: { id: unitId },
      relations: ['booklet', 'booklet.person']
    });

    if (!unit || unit.booklet?.person?.workspace_id !== workspaceId) {
      return { success: false, report: { deletedUnit: null, warnings: ['Unit not found or access denied'] } };
    }

    await this.unitRepository.delete(unitId);
    await this.journalService.createEntry(userId, workspaceId, 'DELETE', 'UNIT', unitId);

    return { success: true, report: { deletedUnit: unitId, warnings: [] } };
  }

  // Private helper methods

  private validatePersonQuery(personId: number, workspaceId: number): void {
    if (!personId || !workspaceId) {
      throw new Error('Both personId and workspaceId are required.');
    }
  }

  private async fetchBooklets(personId: number) {
    return this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('booklet.personid = :personId', { personId })
      .select(['booklet.id', 'bookletinfo.name'])
      .getMany();
  }

  private async fetchUnitsWithResponses(bookletIds: number[]) {
    return this.unitRepository
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.responses', 'response')
      .where('unit.bookletid IN (:...bookletIds)', { bookletIds })
      .select([
        'unit.id',
        'unit.name',
        'unit.alias',
        'unit.bookletid',
        'response.id',
        'response.unitid',
        'response.variableid',
        'response.status',
        'response.value',
        'response.subform',
        'response.code_v1',
        'response.score_v1',
        'response.status_v1'
      ])
      .getMany();
  }

  private async fetchBookletLogs(bookletIds: number[]) {
    return this.bookletLogRepository
      .createQueryBuilder('bookletLog')
      .where('bookletLog.bookletid IN (:...bookletIds)', { bookletIds })
      .select([
        'bookletLog.id',
        'bookletLog.bookletid',
        'bookletLog.ts',
        'bookletLog.parameter',
        'bookletLog.key'
      ])
      .getMany();
  }

  private async buildUnitResultMap(units: Unit[]) {
    const unitResultMap = new Map<
    number,
    {
      id: number;
      unitid: number;
      variableid: string;
      status: string;
      value: string;
      subform: string;
      code?: number;
      score?: number;
      codedstatus?: string;
    }[]
    >();

    units.forEach(unit => {
      if (unit.responses) {
        const uniqueResponses = Array.from(
          new Map(
            unit.responses.map(response => [response.id, response])
          ).values()
        ).map(response => ({
          id: response.id,
          unitid: response.unitid,
          variableid: response.variableid,
          status: statusNumberToString(response.status) || 'UNSET',
          value: response.value || '',
          subform: response.subform || '',
          code: response.code_v1,
          score: response.score_v1,
          codedstatus: statusNumberToString(response.status_v1) || 'UNSET'
        }));
        unitResultMap.set(unit.id, uniqueResponses);
      }
    });

    return unitResultMap;
  }

  private async buildUnitTagsMap(unitIds: number[]) {
    const unitTagsMap = new Map<
    number,
    {
      id: number;
      unitId: number;
      tag: string;
      color?: string;
      createdAt: Date;
    }[]
    >();

    if (unitIds.length > 0) {
      const allTags = await this.unitTagService.findAllByUnitIds(unitIds);

      allTags.forEach(tag => {
        if (!unitTagsMap.has(tag.unitId)) {
          unitTagsMap.set(tag.unitId, []);
        }
        unitTagsMap.get(tag.unitId)?.push(tag);
      });
    }

    return unitTagsMap;
  }

  private buildBookletLogsMap(bookletLogs: BookletLog[]) {
    const bookletLogsMap = new Map<
    number,
    {
      id: number;
      bookletid: number;
      ts: string;
      key: string;
      parameter: string;
    }[]
    >();

    bookletLogs.forEach(log => {
      if (!bookletLogsMap.has(log.bookletid)) {
        bookletLogsMap.set(log.bookletid, []);
      }
      bookletLogsMap.get(log.bookletid)?.push({
        id: log.id,
        bookletid: log.bookletid,
        ts: log.ts.toString(),
        key: log.key,
        parameter: log.parameter
      });
    });

    return bookletLogsMap;
  }

  private buildUnitsMap(units: Unit[]) {
    const unitsMap = new Map<number, Unit[]>();
    units.forEach(unit => {
      if (!unitsMap.has(unit.bookletid)) {
        unitsMap.set(unit.bookletid, []);
      }
      unitsMap.get(unit.bookletid)?.push(unit);
    });
    return unitsMap;
  }

  private assemblePersonTestResults(
    booklets: Booklet[],
    bookletLogsMap: Map<number, { id: number; bookletid: number; ts: string; key: string; parameter: string }[]>,
    unitsMap: Map<number, Unit[]>,
    unitResultMap: Map<number, {
      id: number;
      unitid: number;
      variableid: string;
      status: string;
      value: string;
      subform: string;
      code?: number;
      score?: number;
      codedstatus?: string;
    }[]>,
    unitTagsMap: Map<number, {
      id: number;
      unitId: number;
      tag: string;
      color?: string;
      createdAt: Date;
    }[]>
  ) {
    return booklets.map(booklet => ({
      id: booklet.id,
      name: booklet.bookletinfo.name,
      logs: bookletLogsMap.get(booklet.id) || [],
      units: (unitsMap.get(booklet.id) || []).map(unit => ({
        id: unit.id,
        name: unit.name,
        alias: unit.alias,
        results: unitResultMap.get(unit.id) || [],
        tags: unitTagsMap.get(unit.id) || []
      }))
    }));
  }
}
