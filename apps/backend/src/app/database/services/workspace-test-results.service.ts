import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Connection, In, Repository } from 'typeorm';
import Persons from '../entities/persons.entity';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { Session } from '../entities/session.entity';
import { UnitTagService } from './unit-tag.service';
import { JournalService } from './journal.service';

@Injectable()
export class WorkspaceTestResultsService {
  private readonly logger = new Logger(WorkspaceTestResultsService.name);

  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(BookletInfo)
    private bookletInfoRepository: Repository<BookletInfo>,
    @InjectRepository(BookletLog)
    private bookletLogRepository: Repository<BookletLog>,
    @InjectRepository(UnitLog)
    private unitLogRepository: Repository<UnitLog>,
    @InjectRepository(Session)
    private sessionRepository: Repository<Session>,
    private readonly connection: Connection,
    private readonly unitTagService: UnitTagService,
    private readonly journalService: JournalService
  ) {}

  async findPersonTestResults(personId: number, workspaceId: number): Promise<{
    id: number;
    personid: number;
    name: string;
    size: number;
    logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
    sessions: { id: number; browser: string; os: string; screen: string; ts: string }[];
    units: {
      id: number;
      bookletid: number;
      name: string;
      alias: string | null;
      results: { id: number; unitid: number }[];
      logs: { id: number; unitid: number; ts: string; key: string; parameter: string }[];
      tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
    }[];
  }[]> {
    if (!personId || !workspaceId) {
      throw new Error('Both personId and workspaceId are required.');
    }

    try {
      this.logger.log(
        `Fetching booklets, bookletInfo data, units, and test results for personId: ${personId} and workspaceId: ${workspaceId}`
      );

      // Get booklets with bookletInfo in a single query using join
      const booklets = await this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('booklet.personid = :personId', { personId })
        .select([
          'booklet.id',
          'booklet.personid',
          'bookletinfo.id',
          'bookletinfo.name',
          'bookletinfo.size'
        ])
        .getMany();

      if (!booklets || booklets.length === 0) {
        this.logger.log(`No booklets found for personId: ${personId}`);
        return [];
      }

      const bookletIds = booklets.map(booklet => booklet.id);

      // Get units with responses in a single query using join
      const units = await this.unitRepository
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
          'response.code',
          'response.score',
          'response.codedstatus'
        ])
        .getMany();

      const unitIds = units.map(unit => unit.id);

      // Create a map of unit ID to responses
      const unitResultMap = new Map<number, { id: number; unitid: number }[]>();
      units.forEach(unit => {
        if (unit.responses) {
          // Remove duplicate responses
          const uniqueResponses = Array.from(
            new Map(unit.responses.map(response => [response.id, response])).values()
          );
          unitResultMap.set(unit.id, uniqueResponses);
        }
      });

      // Get booklet logs in a single query
      const bookletLogs = await this.bookletLogRepository
        .createQueryBuilder('bookletLog')
        .where('bookletLog.bookletid IN (:...bookletIds)', { bookletIds })
        .select(['bookletLog.id', 'bookletLog.bookletid', 'bookletLog.ts', 'bookletLog.parameter', 'bookletLog.key'])
        .getMany();

      // Get sessions in a single query
      const sessions = await this.sessionRepository
        .createQueryBuilder('session')
        .innerJoin('session.booklet', 'booklet')
        .where('booklet.id IN (:...bookletIds)', { bookletIds })
        .select(['session.id', 'session.browser', 'session.os', 'session.screen', 'session.ts', 'booklet.id'])
        .getMany();

      // Get unit logs in a single query
      const unitLogs = await this.unitLogRepository
        .createQueryBuilder('unitLog')
        .where('unitLog.unitid IN (:...unitIds)', { unitIds })
        .select(['unitLog.id', 'unitLog.unitid', 'unitLog.ts', 'unitLog.key', 'unitLog.parameter'])
        .getMany();

      // Group logs by unit ID for faster lookup
      const unitLogsMap = new Map<number, { id: number; unitid: number; ts: string; key: string; parameter: string }[]>();
      unitLogs.forEach(log => {
        if (!unitLogsMap.has(log.unitid)) {
          unitLogsMap.set(log.unitid, []);
        }
        unitLogsMap.get(log.unitid)?.push({
          id: log.id,
          unitid: log.unitid,
          ts: log.ts.toString(),
          key: log.key,
          parameter: log.parameter
        });
      });

      // Get unit tags in a single batch query instead of multiple individual queries
      const unitTagsMap = new Map<number, { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[]>();

      // Only fetch tags if there are units
      if (unitIds.length > 0) {
        const allTags = await this.unitTagService.findAllByUnitIds(unitIds);

        // Group tags by unit ID
        allTags.forEach(tag => {
          if (!unitTagsMap.has(tag.unitId)) {
            unitTagsMap.set(tag.unitId, []);
          }
          unitTagsMap.get(tag.unitId)?.push(tag);
        });
      }

      // Group sessions by booklet ID for faster lookup
      const sessionsMap = new Map<number, { id: number; browser: string; os: string; screen: string; ts: string }[]>();
      sessions.forEach(session => {
        const bookletId = session.booklet?.id;
        if (bookletId && !sessionsMap.has(bookletId)) {
          sessionsMap.set(bookletId, []);
        }
        if (bookletId) {
          sessionsMap.get(bookletId)?.push({
            id: session.id,
            browser: session.browser,
            os: session.os,
            screen: session.screen,
            ts: session.ts?.toString()
          });
        }
      });

      // Group booklet logs by booklet ID for faster lookup
      const bookletLogsMap = new Map<number, { id: number; bookletid: number; ts: string; key: string; parameter: string }[]>();
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

      // Group units by booklet ID for faster lookup
      const unitsMap = new Map<number, Unit[]>();
      units.forEach(unit => {
        if (!unitsMap.has(unit.bookletid)) {
          unitsMap.set(unit.bookletid, []);
        }
        unitsMap.get(unit.bookletid)?.push(unit);
      });

      return booklets.map(booklet => ({
        id: booklet.id,
        personid: booklet.personid,
        name: booklet.bookletinfo.name,
        size: booklet.bookletinfo.size,
        logs: bookletLogsMap.get(booklet.id) || [],
        sessions: sessionsMap.get(booklet.id) || [],
        units: (unitsMap.get(booklet.id) || []).map(unit => ({
          id: unit.id,
          bookletid: unit.bookletid,
          name: unit.name,
          alias: unit.alias,
          results: unitResultMap.get(unit.id) || [],
          logs: unitLogsMap.get(unit.id) || [],
          tags: unitTagsMap.get(unit.id) || []
        }))
      }));
    } catch (error) {
      this.logger.error(
        `Failed to fetch booklets, bookletInfo, units, and results for personId: ${personId} and workspaceId: ${workspaceId}`,
        error.stack
      );
      throw new Error('An error occurred while fetching booklets, their info, units, and test results.');
    }
  }

  async findTestResults(workspace_id: number, options: { page: number; limit: number; searchText?: string }): Promise<[Persons[], number]> {
    const { page, limit, searchText } = options;

    if (!workspace_id || workspace_id <= 0) {
      throw new Error('Invalid workspace_id provided');
    }

    const MAX_LIMIT = 500;
    const validPage = Math.max(1, page); // minimum 1
    const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

    try {
      const queryBuilder = this.personsRepository.createQueryBuilder('person')
        .where('person.workspace_id = :workspace_id', { workspace_id })
        .select([
          'person.id',
          'person.group',
          'person.login',
          'person.code',
          'person.uploaded_at'
        ]);

      // Add search condition if searchText is provided
      if (searchText && searchText.trim() !== '') {
        queryBuilder.andWhere(
          '(person.code ILIKE :searchText OR person.group ILIKE :searchText OR person.login ILIKE :searchText)',
          { searchText: `%${searchText.trim()}%` }
        );
      }

      // Add pagination
      queryBuilder
        .skip((validPage - 1) * validLimit)
        .take(validLimit)
        .orderBy('person.code', 'ASC');

      // Execute query
      const [results, total] = await queryBuilder.getManyAndCount();

      return [results, total];
    } catch (error) {
      this.logger.error(`Failed to fetch test results for workspace_id ${workspace_id}: ${error.message}`, error.stack);
      throw new Error('An error occurred while fetching test results');
    }
  }

  async findWorkspaceResponses(workspace_id: number, options?: { page: number; limit: number }): Promise<[ResponseEntity[], number]> {
    this.logger.log('Returning responses for workspace', workspace_id);

    if (options) {
      const { page, limit } = options;
      const MAX_LIMIT = 500;
      const validPage = Math.max(1, page);
      const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

      const [responses, total] = await this.responseRepository.findAndCount({
        skip: (validPage - 1) * validLimit,
        take: validLimit,
        order: { id: 'ASC' }
      });

      this.logger.log(`Found ${responses.length} responses (page ${validPage}, limit ${validLimit}, total ${total}) for workspace ${workspace_id}`);
      return [responses, total];
    }

    const responses = await this.responseRepository.find({
      order: { id: 'ASC' }
    });

    this.logger.log(`Found ${responses.length} responses for workspace ${workspace_id}`);
    return [responses, responses.length];
  }

  async findUnitResponse(workspaceId: number, connector: string, unitId: string): Promise<{ responses: { id: string, content: { id: string; value: string; status: string }[] }[] }> {
    const [login, code, bookletId] = connector.split('@');
    const person = await this.personsRepository.findOne({
      where: {
        code, login, workspace_id: workspaceId
      }
    });
    if (!person) {
      throw new Error(`Person mit ID ${person.id} wurde nicht gefunden.`);
    }

    const bookletInfo = await this.bookletInfoRepository.findOne({
      where: { name: bookletId }
    });

    if (!bookletInfo) {
      throw new Error(`Kein Booklet mit der ID ${bookletId} gefunden.`);
    }

    const booklet = await this.bookletRepository.findOne({
      where: {
        personid: person.id,
        infoid: bookletInfo.id
      }
    });

    if (!booklet) {
      throw new Error(`Kein Booklet für die Person mit ID ${person.id} und Booklet ID ${bookletId} gefunden.`);
    }

    const booklets = [booklet];
    const unit = await this.unitRepository.findOne({
      where: {
        bookletid: In(booklets.map(b => b.id)),
        alias: unitId
      },
      relations: ['responses']
    });

    const responsesBySubform = {};

    unit.responses.forEach(response => {
      let value = response.value;
      if (typeof value === 'string') {
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            value = JSON.parse(value);
          } catch (e) {
            // If parsing fails, keep the original value
            this.logger.warn(`Failed to parse JSON array: ${value}`);
          }
        } else if (value.startsWith('{') && value.endsWith('}')) {
          try {
            const jsonArrayString = value.replace(/^\{/, '[').replace(/\}$/, ']');
            value = JSON.parse(jsonArrayString);
          } catch (e) {
            // If parsing fails, keep the original value
            this.logger.warn(`Failed to parse curly brace array: ${value}`);
          }
        }
      }

      const mappedResponse = {
        id: response.variableid,
        value: value,
        status: response.status
      };

      const subformKey = response.subform || 'elementCodes';

      if (!responsesBySubform[subformKey]) {
        responsesBySubform[subformKey] = [];
      }

      responsesBySubform[subformKey].push(mappedResponse);
    });

    // Create responses array with unique responses for each subform
    const responsesArray = Object.keys(responsesBySubform).map(subform => {
      const uniqueResponses = responsesBySubform[subform].filter(
        (response, index, self) => index === self.findIndex(r => r.id === response.id)
      );

      return {
        id: subform === 'default' ? 'elementCodes' : subform,
        content: uniqueResponses
      };
    });

    return {
      responses: responsesArray
    };
  }

  private responsesByStatusCache: Map<string, { data: [ResponseEntity[], number]; timestamp: number }> = new Map();
  private readonly RESPONSES_CACHE_TTL_MS = 1 * 60 * 1000; // 1 minute cache TTL

  async getResponsesByStatus(workspace_id: number, status: string, options?: { page: number; limit: number }): Promise<[ResponseEntity[], number]> {
    this.logger.log(`Getting responses with status ${status} for workspace ${workspace_id}`);

    const cacheKey = `${workspace_id}-${status}-${options?.page || 0}-${options?.limit || 0}`;

    const cachedResult = this.responsesByStatusCache.get(cacheKey);
    if (cachedResult && (Date.now() - cachedResult.timestamp) < this.RESPONSES_CACHE_TTL_MS) {
      this.logger.log(`Returning cached responses for status ${status} (workspace ${workspace_id})`);
      return cachedResult.data;
    }

    try {
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status = :constStatus', { constStatus: 'VALUE_CHANGED' })
        .andWhere('person.workspace_id = :workspace_id_param', { workspace_id_param: workspace_id })
        .orderBy('response.id', 'ASC');

      if (status === 'null') {
        queryBuilder.andWhere('response.codedStatus IS NULL');
      } else {
        queryBuilder.andWhere('response.codedStatus = :statusParam', { statusParam: status });
      }

      let result: [ResponseEntity[], number];

      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page); // minimum 1
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT); // Between 1 and MAX_LIMIT

        queryBuilder
          .skip((validPage - 1) * validLimit)
          .take(validLimit);

        result = await queryBuilder.getManyAndCount();
        this.logger.log(`Found ${result[0].length} responses with status ${status} (page ${validPage}, limit ${validLimit}, total ${result[1]}) for workspace ${workspace_id}`);
      } else {
        // For non-paginated queries, still use getManyAndCount to avoid multiple queries
        result = await queryBuilder.getManyAndCount();
        this.logger.log(`Found ${result[0].length} responses with status ${status} for workspace ${workspace_id}`);
      }

      this.responsesByStatusCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error) {
      this.logger.error(`Error getting responses by status: ${error.message}`);
      return [[], 0];
    }
  }

  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string
  ): Promise<{
      success: boolean;
      report: {
        deletedPersons: string[];
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const ids = testPersonIds.split(',').map(id => id.trim());
      const report = {
        deletedPersons: [],
        warnings: []
      };

      const existingPersons = await manager
        .createQueryBuilder(Persons, 'persons')
        .select([
          'persons.id',
          'persons.login',
          'persons.code',
          'persons.group',
          'persons.workspace_id',
          'persons.uploaded_at',
          'persons.source'
        ])
        .where('persons.id IN (:...ids)', { ids })
        .getMany();

      if (!existingPersons.length) {
        const warningMessage = `Keine Personen gefunden für die angegebenen IDs: ${testPersonIds}`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      const existingIds = existingPersons.map(person => person.id);

      await manager
        .createQueryBuilder()
        .delete()
        .from(Persons)
        .where('id IN (:...ids)', { ids: existingIds })
        .execute();

      report.deletedPersons = existingIds;

      for (const person of existingPersons) {
        try {
          await this.journalService.createEntry(
            'system', // userId
            workspaceId,
            'delete',
            'test-person',
            person.id,
            {
              personId: person.id,
              personLogin: person.login,
              personCode: person.code,
              personGroup: person.group,
              personSource: person.source,
              personUploadedAt: person.uploaded_at,
              message: 'Test person deleted'
            }
          );
        } catch (error) {
          this.logger.error(`Failed to create journal entry for deleting test person ${person.id}: ${error.message}`);
        }
      }

      return { success: true, report };
    });
  }

  async deleteUnit(
    workspaceId: number,
    unitId: number
  ): Promise<{
      success: boolean;
      report: {
        deletedUnit: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedUnit: null,
        warnings: []
      };

      const unit = await manager
        .createQueryBuilder(Unit, 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('unit.id = :unitId', { unitId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!unit) {
        const warningMessage = `Keine Unit mit ID ${unitId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(Unit)
        .where('id = :unitId', { unitId })
        .execute();

      report.deletedUnit = unitId;

      try {
        await this.journalService.createEntry(
          'system', // userId
          workspaceId,
          'delete',
          'unit',
          unitId,
          {
            unitId,
            unitName: unit.name,
            unitAlias: unit.alias,
            bookletId: unit.booklet?.id,
            personId: unit.booklet?.person?.id,
            personLogin: unit.booklet?.person?.login,
            personCode: unit.booklet?.person?.code,
            personGroup: unit.booklet?.person?.group,
            personSource: unit.booklet?.person?.source,
            personUploadedAt: unit.booklet?.person?.uploaded_at,
            message: 'Unit deleted'
          }
        );
      } catch (error) {
        this.logger.error(`Failed to create journal entry for deleting unit ${unitId}: ${error.message}`);
      }

      return { success: true, report };
    });
  }

  async deleteResponse(
    workspaceId: number,
    responseId: number
  ): Promise<{
      success: boolean;
      report: {
        deletedResponse: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedResponse: null,
        warnings: []
      };

      const response = await manager
        .createQueryBuilder(ResponseEntity, 'response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('response.id = :responseId', { responseId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!response) {
        const warningMessage = `Keine Antwort mit ID ${responseId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(ResponseEntity)
        .where('id = :responseId', { responseId })
        .execute();

      report.deletedResponse = responseId;

      try {
        await this.journalService.createEntry(
          'system', // userId
          workspaceId,
          'delete',
          'response',
          responseId,
          {
            responseId,
            unitId: response.unit.id,
            unitName: response.unit.name,
            variableId: response.variableid,
            value: response.value,
            bookletId: response.unit.booklet?.id,
            personId: response.unit.booklet?.person?.id,
            personLogin: response.unit.booklet?.person?.login,
            personCode: response.unit.booklet?.person?.code,
            personGroup: response.unit.booklet?.person?.group,
            personSource: response.unit.booklet?.person?.source,
            personUploadedAt: response.unit.booklet?.person?.uploaded_at,
            message: 'Response deleted'
          }
        );
      } catch (error) {
        this.logger.error(`Failed to create journal entry for deleting response ${responseId}: ${error.message}`);
      }

      return { success: true, report };
    });
  }

  async deleteBooklet(
    workspaceId: number,
    bookletId: number
  ): Promise<{
      success: boolean;
      report: {
        deletedBooklet: number | null;
        warnings: string[];
      };
    }> {
    return this.connection.transaction(async manager => {
      const report = {
        deletedBooklet: null,
        warnings: []
      };

      const booklet = await manager
        .createQueryBuilder(Booklet, 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .where('booklet.id = :bookletId', { bookletId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!booklet) {
        const warningMessage = `Kein Booklet mit ID ${bookletId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      // Delete the booklet (cascade will delete associated units and responses)
      await manager
        .createQueryBuilder()
        .delete()
        .from(Booklet)
        .where('id = :bookletId', { bookletId })
        .execute();

      report.deletedBooklet = bookletId;

      try {
        await this.journalService.createEntry(
          'system', // userId
          workspaceId,
          'delete',
          'booklet',
          bookletId,
          {
            bookletId,
            personId: booklet.personid,
            personLogin: booklet.person?.login || 'Unknown',
            personCode: booklet.person?.code,
            personGroup: booklet.person?.group,
            personSource: booklet.person?.source,
            personUploadedAt: booklet.person?.uploaded_at,
            message: 'Booklet deleted'
          }
        );
      } catch (error) {
        this.logger.error(`Failed to create journal entry for deleting booklet ${bookletId}: ${error.message}`);
      }

      return { success: true, report };
    });
  }

  async searchResponses(
    workspaceId: number,
    searchParams: { value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string },
    options: { page?: number; limit?: number } = {}
  ): Promise<{
      data: {
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
      }[];
      total: number;
    }> {
    if (!workspaceId) {
      throw new Error('workspaceId is required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    try {
      this.logger.log(
        `Searching for responses in workspace: ${workspaceId} with params: ${JSON.stringify(searchParams)} (page: ${page}, limit: ${limit})`
      );

      const query = this.responseRepository.createQueryBuilder('response')
        .innerJoinAndSelect('response.unit', 'unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('person.workspace_id = :workspaceId', { workspaceId });

      if (searchParams.value) {
        query.andWhere('response.value ILIKE :value', { value: `%${searchParams.value}%` });
      }

      if (searchParams.variableId) {
        query.andWhere('response.variableid ILIKE :variableId', { variableId: `%${searchParams.variableId}%` });
      }

      if (searchParams.unitName) {
        query.andWhere('unit.name ILIKE :unitName', { unitName: `%${searchParams.unitName}%` });
      }

      if (searchParams.status) {
        query.andWhere('response.status = :status', { status: searchParams.status });
      }

      if (searchParams.codedStatus) {
        query.andWhere('response.codedstatus = :codedStatus', { codedStatus: searchParams.codedStatus });
      }

      if (searchParams.group) {
        query.andWhere('person.group = :group', { group: searchParams.group });
      }

      if (searchParams.code) {
        query.andWhere('person.code = :code', { code: searchParams.code });
      }

      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(`No responses found matching the criteria in workspace: ${workspaceId}`);
        return { data: [], total: 0 };
      }

      query.skip(skip).take(limit);

      const responses = await query.getMany();

      this.logger.log(`Found ${total} responses matching the criteria in workspace: ${workspaceId}, returning ${responses.length} for page ${page}`);

      const data = responses.map(response => ({
        responseId: response.id,
        variableId: response.variableid,
        value: response.value || '',
        status: response.status,
        code: response.code,
        score: response.score,
        codedStatus: response.codedstatus,
        unitId: response.unit.id,
        unitName: response.unit.name,
        unitAlias: response.unit.alias,
        bookletId: response.unit.booklet.id,
        bookletName: response.unit.booklet.bookletinfo.name,
        personId: response.unit.booklet.person.id,
        personLogin: response.unit.booklet.person.login,
        personCode: response.unit.booklet.person.code,
        personGroup: response.unit.booklet.person.group
      }));

      return { data, total };
    } catch (error) {
      this.logger.error(
        `Failed to search for responses in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(`An error occurred while searching for responses: ${error.message}`);
    }
  }

  async findUnitsByName(
    workspaceId: number,
    unitName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
      data: {
        unitId: number;
        unitName: string;
        unitAlias: string | null;
        bookletId: number;
        bookletName: string;
        personId: number;
        personLogin: string;
        personCode: string;
        personGroup: string;
        tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
        responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
      }[];
      total: number;
    }> {
    if (!workspaceId || !unitName) {
      throw new Error('Both workspaceId and unitName are required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    try {
      this.logger.log(
        `Searching for units with name: ${unitName} in workspace: ${workspaceId} (page: ${page}, limit: ${limit})`
      );

      // Create a query to find all units with the given name
      const query = this.unitRepository.createQueryBuilder('unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('unit.responses', 'response')
        .where('unit.name = :unitName', { unitName })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId });

      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(`No units found with name: ${unitName} in workspace: ${workspaceId}`);
        return { data: [], total: 0 };
      }

      query.skip(skip).take(limit);

      const units = await query.getMany();

      this.logger.log(`Found ${total} units with name: ${unitName} in workspace: ${workspaceId}, returning ${units.length} for page ${page}`);

      const unitIds = units.map(unit => unit.id);
      const allUnitTags = await Promise.all(
        unitIds.map(unitId => this.unitTagService.findAllByUnitId(unitId))
      );

      const unitTagsMap = new Map<number, { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[]>();
      unitIds.forEach((unitId, index) => {
        unitTagsMap.set(unitId, allUnitTags[index]);
      });

      let data = units.map(unit => ({
        unitId: unit.id,
        unitName: unit.name,
        unitAlias: unit.alias,
        bookletId: unit.booklet.id,
        bookletName: unit.booklet.bookletinfo.name,
        personId: unit.booklet.person.id,
        personLogin: unit.booklet.person.login,
        personCode: unit.booklet.person.code,
        personGroup: unit.booklet.person.group,
        tags: unitTagsMap.get(unit.id) || [],
        responses: unit.responses ? unit.responses.map(response => ({
          variableId: response.variableid,
          value: response.value || '',
          status: response.status,
          code: response.code,
          score: response.score,
          codedStatus: response.codedstatus
        })) : []
      }));

      const uniqueMap = new Map<string, typeof data[0]>();
      data.forEach(item => {
        const uniqueKey = `${item.personGroup}|${item.personCode}|${item.personLogin}|${item.bookletName}|${item.unitName}`;
        if (!uniqueMap.has(uniqueKey)) {
          uniqueMap.set(uniqueKey, item);
        }
      });

      data = Array.from(uniqueMap.values());
      return { data, total: data.length };
    } catch (error) {
      this.logger.error(
        `Failed to search for units with name: ${unitName} in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(`An error occurred while searching for units with name: ${unitName}: ${error.message}`);
    }
  }
}
