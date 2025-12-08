import {
  Injectable, Logger, Inject, forwardRef
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Response } from 'express';
import * as csv from 'fast-csv';
import * as fs from 'fs';
import { Writable } from 'stream';
import { ResponseValueType } from '@iqbspecs/response/response.interface';
import Persons from '../entities/persons.entity';
import { statusNumberToString, statusStringToNumber } from '../utils/response-status-converter';
import { Unit } from '../entities/unit.entity';
import { Booklet } from '../entities/booklet.entity';
import { ResponseEntity } from '../entities/response.entity';
import { BookletInfo } from '../entities/bookletInfo.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { ChunkEntity } from '../entities/chunk.entity';
import { UnitTagService } from './unit-tag.service';
import { JournalService } from './journal.service';
import { CacheService } from '../../cache/cache.service';
import { CodingListService } from './coding-list.service';
import { Chunk, TcMergeResponse } from './shared-types';

interface PersonWhere {
  code: string;
  login: string;
  workspace_id: number;
  consider: boolean;
  group?: string;
}

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
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    private readonly connection: DataSource,
    private readonly unitTagService: UnitTagService,
    private readonly journalService: JournalService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => CodingListService))
    private readonly codingListService: CodingListService
  ) {}

  async findPersonTestResults(personId: number, workspaceId: number): Promise<{
    id: number;
    name: string;
    logs: { id: number; bookletid: number; ts: string; parameter: string, key: string }[];
    units: {
      id: number;
      name: string;
      alias: string | null;
      results: { id: number; unitid: number; variableid: string; status: string; value: string; subform: string; code?: number; score?: number; codedstatus?: string }[];
      tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
    }[];
  }[]> {
    if (!personId || !workspaceId) {
      throw new Error('Both personId and workspaceId are required.');
    }

    this.logger.log(`Fetching booklet data for person ${personId} in workspace ${workspaceId}`);

    try {
      this.logger.log(
        `Fetching booklets, bookletInfo data, units, and test results for personId: ${personId} and workspaceId: ${workspaceId}`
      );

      const booklets = await this.bookletRepository
        .createQueryBuilder('booklet')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('booklet.personid = :personId', { personId })
        .select([
          'booklet.id',
          'bookletinfo.name'
        ])
        .getMany();

      if (!booklets || booklets.length === 0) {
        this.logger.log(`No booklets found for personId: ${personId}`);
        return [];
      }

      const bookletIds = booklets.map(booklet => booklet.id);

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
          'response.code_v1',
          'response.score_v1',
          'response.status_v1'
        ])
        .getMany();

      const unitIds = units.map(unit => unit.id);

      const unitResultMap = new Map<number, { id: number; unitid: number; variableid: string; status: string; value: string; subform: string; code?: number; score?: number; codedstatus?: string }[]>();
      units.forEach(unit => {
        if (unit.responses) {
          const uniqueResponses = Array.from(
            new Map(unit.responses.map(response => [response.id, response])).values()
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

      const bookletLogs = await this.bookletLogRepository
        .createQueryBuilder('bookletLog')
        .where('bookletLog.bookletid IN (:...bookletIds)', { bookletIds })
        .select(['bookletLog.id', 'bookletLog.bookletid', 'bookletLog.ts', 'bookletLog.parameter', 'bookletLog.key'])
        .getMany();

      const unitTagsMap = new Map<number, { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[]>();

      if (unitIds.length > 0) {
        const allTags = await this.unitTagService.findAllByUnitIds(unitIds);

        allTags.forEach(tag => {
          if (!unitTagsMap.has(tag.unitId)) {
            unitTagsMap.set(tag.unitId, []);
          }
          unitTagsMap.get(tag.unitId)?.push(tag);
        });
      }

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

      const unitsMap = new Map<number, Unit[]>();
      units.forEach(unit => {
        if (!unitsMap.has(unit.bookletid)) {
          unitsMap.set(unit.bookletid, []);
        }
        unitsMap.get(unit.bookletid)?.push(unit);
      });

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

    this.logger.log(`Fetching test results for workspace ${workspace_id} (page ${validPage}, limit ${validLimit})`);

    try {
      const queryBuilder = this.personsRepository.createQueryBuilder('person')
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
      this.logger.error(`Failed to fetch test results for workspace_id ${workspace_id}: ${error.message}`, error.stack);
      throw new Error('An error occurred while fetching test results');
    }
  }

  async findWorkspaceResponses(workspace_id: number, options?: { page: number; limit: number }): Promise<[ResponseEntity[], number]> {
    this.logger.log('Returning responses for workspace', workspace_id);

    let result: [ResponseEntity[], number];

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
      result = [responses, total];
    } else {
      const responses = await this.responseRepository.find({
        order: { id: 'ASC' }
      });

      this.logger.log(`Found ${responses.length} responses for workspace ${workspace_id}`);
      result = [responses, responses.length];
    }

    return result;
  }

  async findUnitResponse(workspaceId: number, connector: string, unitId: string): Promise<{ responses: { id: string, content: { id: string; value: string; status: string }[] }[] }> {
    const cacheKey = this.cacheService.generateUnitResponseCacheKey(workspaceId, connector, unitId);
    const cachedResponse = await this.cacheService.get<{ responses: { id: string, content: { id: string; value: string; status: string }[] }[] }>(cacheKey);

    if (cachedResponse) {
      this.logger.log(`Cache hit for responses: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);
      return cachedResponse;
    }

    this.logger.log(`Cache miss for responses: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);

    const parts = connector.split('@');
    const login = parts[0];
    const code = parts[1];
    const group = parts.length >= 4 ? parts[2] : undefined;
    const bookletId = parts[parts.length - 1];
    const queryBuilder = this.unitRepository.createQueryBuilder('unit')
      .innerJoinAndSelect('unit.responses', 'response')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.login = :login', { login })
      .andWhere('person.code = :code', { code });

    if (group) {
      queryBuilder.andWhere('person.group = :group', { group });
    }

    queryBuilder
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('bookletinfo.name = :bookletId', { bookletId })
      .andWhere('unit.alias = :unitId', { unitId });

    const unit = await queryBuilder.getOne();

    if (!unit) {
      const personWhere: PersonWhere = {
        code, login, workspace_id: workspaceId, consider: true
      };
      if (group) {
        personWhere.group = group;
      }

      const person = await this.personsRepository.findOne({
        where: personWhere
      });

      if (!person) {
        const searchDescription = group ?
          `Person mit Login ${login}, Code ${code} und Gruppe ${group}` :
          `Person mit Login ${login} und Code ${code}`;
        throw new Error(`${searchDescription} wurde nicht gefunden.`);
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

      throw new Error(`Keine Unit mit der ID ${unitId} für das Booklet ${bookletId} gefunden.`);
    }

    const chunks = await this.chunkRepository.find({
      where: { unitid: unit.id }
    });

    if (chunks.length > 0) {
      this.logger.log(`Found ${chunks.length} chunks for unit ${unit.id}`);
      chunks.forEach(chunk => {
        this.logger.log(`Chunk: key=${chunk.key}, type=${chunk.type}, variables=${chunk.variables}, ts=${chunk.ts}`);
      });
    } else {
      this.logger.log(`No chunks found for unit ${unit.id}`);
    }

    const chunkKeyMap = new Map<string, string>();
    chunks.forEach(chunk => {
      if (chunk.variables) {
        const variables = chunk.variables.split(',').map(v => v.trim());
        variables.forEach(variable => {
          chunkKeyMap.set(variable, chunk.key);
        });
      }
    });

    const responsesByChunk = {};

    unit.responses.forEach(response => {
      let value = response.value;
      if (typeof value === 'string') {
        if (value.startsWith('[') && value.endsWith(']')) {
          try {
            value = JSON.parse(value);
          } catch (e) {
            this.logger.warn(`Failed to parse JSON array: ${value}`);
          }
        } else if (value.startsWith('{') && value.endsWith('}')) {
          try {
            const jsonArrayString = value.replace(/^\{/, '[').replace(/}$/, ']');
            value = JSON.parse(jsonArrayString);
          } catch (e) {
            this.logger.warn(`Failed to parse curly brace array: ${value}`);
          }
        }
      }

      const mappedResponse = {
        id: response.variableid,
        value: value,
        status: response.status
      };

      const chunkKey = chunkKeyMap.get(response.variableid) || response.subform || '';

      if (!responsesByChunk[chunkKey]) {
        responsesByChunk[chunkKey] = [];
      }

      responsesByChunk[chunkKey].push(mappedResponse);
    });

    const responsesArray = Object.keys(responsesByChunk).map(chunkKey => {
      const uniqueResponses = responsesByChunk[chunkKey].filter(
        (response: { id: string }, index: number, self: { id: string }[]) => index === self.findIndex((r: { id: string }) => r.id === response.id)
      );

      return {
        id: chunkKey,
        content: uniqueResponses
      };
    });

    const result = {
      responses: responsesArray
    };

    await this.cacheService.set(cacheKey, result);
    this.logger.log(`Cached responses for: workspace=${workspaceId}, testPerson=${connector}, unitId=${unitId}`);

    return result;
  }

  async getResponsesByStatus(workspace_id: number, status: string, options?: { page: number; limit: number }): Promise<[ResponseEntity[], number]> {
    this.logger.log(`Getting responses with status ${status} for workspace ${workspace_id}`);

    try {
      const queryBuilder = this.responseRepository.createQueryBuilder('response')
        .leftJoinAndSelect('response.unit', 'unit')
        .leftJoinAndSelect('unit.booklet', 'booklet')
        .leftJoinAndSelect('booklet.person', 'person')
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('response.status = :constStatus', { constStatus: statusStringToNumber('VALUE_CHANGED') })
        .andWhere('person.workspace_id = :workspace_id_param', { workspace_id_param: workspace_id })
        .orderBy('response.id', 'ASC');

      if (status === 'null') {
        queryBuilder.andWhere('response.status_v1 IS NULL');
      } else {
        queryBuilder.andWhere('response.status_v1 = :statusParam', { statusParam: status });
      }

      let result: [ResponseEntity[], number];

      if (options) {
        const { page, limit } = options;
        const MAX_LIMIT = 500;
        const validPage = Math.max(1, page);
        const validLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

        queryBuilder
          .skip((validPage - 1) * validLimit)
          .take(validLimit);

        result = await queryBuilder.getManyAndCount();
        this.logger.log(`Found ${result[0].length} responses with status ${status} (page ${validPage}, limit ${validLimit}, total ${result[1]}) for workspace ${workspace_id}`);
      } else {
        result = await queryBuilder.getManyAndCount();
        this.logger.log(`Found ${result[0].length} responses with status ${status} for workspace ${workspace_id}`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Error getting responses by status: ${error.message}`);
      return [[], 0];
    }
  }

  async deleteTestPersons(
    workspaceId: number,
    testPersonIds: string,
    userId: string
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
            userId,
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
    unitId: number,
    userId: string
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
          userId,
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
    responseId: number,
    userId: string
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
          userId,
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
    bookletId: number,
    userId: string
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
        .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .where('booklet.id = :bookletId', { bookletId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .getOne();

      if (!booklet) {
        const warningMessage = `Kein Booklet mit ID ${bookletId} im Workspace ${workspaceId} gefunden`;
        this.logger.warn(warningMessage);
        report.warnings.push(warningMessage);
        return { success: false, report };
      }

      await manager
        .createQueryBuilder()
        .delete()
        .from(Booklet)
        .where('id = :bookletId', { bookletId })
        .execute();

      report.deletedBooklet = bookletId;

      try {
        await this.journalService.createEntry(
          userId,
          workspaceId,
          'delete',
          'booklet',
          bookletId,
          {
            bookletId,
            bookletName: booklet.bookletinfo?.name || 'Unknown',
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
    searchParams: {
      value?: string;
      variableId?: string;
      unitName?: string;
      bookletName?: string;
      status?: string;
      codedStatus?: string;
      group?: string;
      code?: string;
      version?: 'v1' | 'v2' | 'v3'
    },
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
        variablePage?: string;
      }[];
      total: number;
    }> {
    if (!workspaceId) {
      throw new Error('workspaceId is required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    this.logger.log(`Searching for responses in workspace ${workspaceId}`);

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

      if (searchParams.bookletName) {
        query.andWhere('bookletinfo.name ILIKE :bookletName', { bookletName: `%${searchParams.bookletName}%` });
      }

      if (searchParams.status) {
        query.andWhere('response.status = :status', { status: searchParams.status });
      }

      if (searchParams.codedStatus) {
        const statusColumn = searchParams.version ? `status_${searchParams.version}` : 'status_v1';
        query.andWhere(`response.${statusColumn} = :codedStatus`, { codedStatus: searchParams.codedStatus });
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

      // Pre-load variable page maps for all unique units
      const uniqueUnitNames = [...new Set(responses.map(r => r.unit.name))];
      const variablePageMaps = new Map<string, Map<string, string>>();
      for (const unitName of uniqueUnitNames) {
        const pageMap = await this.codingListService.getVariablePageMap(unitName, workspaceId);
        variablePageMaps.set(unitName, pageMap);
      }

      const version = searchParams.version || 'v1';
      const data = responses.map(response => {
        const code = response[`code_${version}` as keyof ResponseEntity] as number;
        const score = response[`score_${version}` as keyof ResponseEntity] as number;
        const codedStatus = response[`status_${version}` as keyof ResponseEntity] as number;
        const variablePage = variablePageMaps.get(response.unit.name)?.get(response.variableid) || '0';

        return {
          responseId: response.id,
          variableId: response.variableid,
          value: response.value || '',
          status: statusNumberToString(response.status) || 'UNSET',
          code,
          score,
          codedStatus: statusNumberToString(codedStatus) || 'UNSET',
          unitId: response.unit.id,
          unitName: response.unit.name,
          unitAlias: response.unit.alias,
          bookletId: response.unit.booklet.id,
          bookletName: response.unit.booklet.bookletinfo.name,
          personId: response.unit.booklet.person.id,
          personLogin: response.unit.booklet.person.login,
          personCode: response.unit.booklet.person.code,
          personGroup: response.unit.booklet.person.group,
          variablePage
        };
      });

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

    this.logger.log(`Finding units by name for workspace ${workspaceId}, unitName: ${unitName}`);

    try {
      this.logger.log(
        `Searching for units with name: ${unitName} in workspace: ${workspaceId} (page: ${page}, limit: ${limit})`
      );

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
          status: statusNumberToString(response.status) || 'UNSET',
          code: response.code_v1,
          score: response.score_v1,
          codedStatus: statusNumberToString(response.status_v1) || 'UNSET'
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

  async findBookletsByName(
    workspaceId: number,
    bookletName: string,
    options: { page?: number; limit?: number } = {}
  ): Promise<{
      data: {
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
      }[];
      total: number;
    }> {
    if (!workspaceId || !bookletName) {
      throw new Error('Both workspaceId and bookletName are required.');
    }

    const page = options.page || 1;
    const limit = options.limit || 10;
    const skip = (page - 1) * limit;

    this.logger.log(`Finding booklets by name for workspace ${workspaceId}, bookletName: ${bookletName}`);

    try {
      this.logger.log(
        `Searching for booklets with name: ${bookletName} in workspace: ${workspaceId} (page: ${page}, limit: ${limit})`
      );

      const query = this.bookletRepository.createQueryBuilder('booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('booklet.units', 'unit')
        .where('bookletinfo.name ILIKE :bookletName', { bookletName: `%${bookletName}%` })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId });

      const total = await query.getCount();

      if (total === 0) {
        this.logger.log(`No booklets found with name: ${bookletName} in workspace: ${workspaceId}`);
        return { data: [], total: 0 };
      }

      query.skip(skip).take(limit);

      const booklets = await query.getMany();

      this.logger.log(`Found ${total} booklets with name: ${bookletName} in workspace: ${workspaceId}, returning ${booklets.length} for page ${page}`);

      const data = booklets.map(booklet => ({
        bookletId: booklet.id,
        bookletName: booklet.bookletinfo.name,
        personId: booklet.person.id,
        personLogin: booklet.person.login,
        personCode: booklet.person.code,
        personGroup: booklet.person.group,
        units: booklet.units ? booklet.units.map(unit => ({
          unitId: unit.id,
          unitName: unit.name,
          unitAlias: unit.alias
        })) : []
      }));

      return { data, total };
    } catch (error) {
      this.logger.error(
        `Failed to search for booklets with name: ${bookletName} in workspace: ${workspaceId}`,
        error.stack
      );
      throw new Error(`An error occurred while searching for booklets with name: ${bookletName}: ${error.message}`);
    }
  }

  async exportTestResults(workspaceId: number, res: Response, filters?: { groupNames?: string[]; bookletNames?: string[]; unitNames?: string[]; personIds?: number[] }): Promise<void> {
    this.logger.log(`Exporting test results for workspace ${workspaceId}`);
    await this.exportTestResultsToStream(workspaceId, res, filters);
  }

  async exportTestResultsToFile(
    workspaceId: number,
    filePath: string,
    filters?: { groupNames?: string[]; bookletNames?: string[]; unitNames?: string[]; personIds?: number[] },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    this.logger.log(`Exporting test results for workspace ${workspaceId} to file ${filePath}`);
    const fileStream = fs.createWriteStream(filePath);
    await this.exportTestResultsToStream(workspaceId, fileStream, filters, progressCallback);
  }

  async exportTestResultsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: { groupNames?: string[]; bookletNames?: string[]; unitNames?: string[]; personIds?: number[] },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    const csvStream = csv.format({
      headers: [
        'groupname',
        'loginname',
        'code',
        'bookletname',
        'unitname',
        'responses',
        'laststate',
        'originalUnitId'
      ],
      delimiter: ';',
      quote: '"'
    });

    csvStream.pipe(stream);

    const BATCH_SIZE = 20;
    let processedCount = 0;

    const createQuery = () => {
      const qb = this.unitRepository.createQueryBuilder('unit')
        .innerJoinAndSelect('unit.booklet', 'booklet')
        .innerJoinAndSelect('booklet.person', 'person')
        .innerJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
        .leftJoinAndSelect('unit.responses', 'response')
        .leftJoinAndSelect('unit.unitLastStates', 'laststate')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });

      if (filters?.groupNames?.length) {
        qb.andWhere('person.group IN (:...groupNames)', { groupNames: filters.groupNames });
      }
      if (filters?.bookletNames?.length) {
        qb.andWhere('bookletinfo.name IN (:...bookletNames)', { bookletNames: filters.bookletNames });
      }
      if (filters?.unitNames?.length) {
        qb.andWhere('unit.name IN (:...unitNames)', { unitNames: filters.unitNames });
      }
      if (filters?.personIds?.length) {
        qb.andWhere('person.id IN (:...personIds)', { personIds: filters.personIds });
      }
      return qb;
    };

    const totalCount = await createQuery().getCount();
    this.logger.log(`Total units to export: ${totalCount}`);

    let lastUnitId = 0;
    let hasMore = true;

    while (hasMore) {
      const units = await createQuery()
        .andWhere('unit.id > :lastUnitId', { lastUnitId })
        .orderBy('unit.id', 'ASC')
        .take(BATCH_SIZE)
        .getMany();

      if (units.length === 0) {
        hasMore = false;
        break;
      }

      lastUnitId = units[units.length - 1].id;

      for (const unit of units) {
        const responsesBySubform = new Map<string, TcMergeResponse[]>();

        if (unit.responses) {
          unit.responses.forEach(r => {
            const subform = r.subform || '';
            if (!responsesBySubform.has(subform)) {
              responsesBySubform.set(subform, []);
            }

            let value: ResponseValueType = r.value;
            try {
              value = JSON.parse(r.value);
            } catch (e) {
              // keep as string
            }

            responsesBySubform.get(subform).push({
              id: r.variableid,
              value: value,
              status: statusNumberToString(r.status) || 'UNSET',
              subform: r.subform,
              code: r.code_v1,
              score: r.score_v1
            });
          });
        }

        const chunks: Chunk[] = [];
        responsesBySubform.forEach((responses, subform) => {
          chunks.push({
            id: subform,
            subForm: subform,
            responseType: 'state',
            ts: 0,
            content: JSON.stringify(responses)
          });
        });

        const lastStateMap: { [key: string]: unknown } = {};
        if (unit.unitLastStates) {
          unit.unitLastStates.forEach(ls => {
            lastStateMap[ls.key] = ls.value;
          });
        }

        const canContinue = csvStream.write({
          groupname: unit.booklet.person.group,
          loginname: unit.booklet.person.login,
          code: unit.booklet.person.code,
          bookletname: unit.booklet.bookletinfo.name,
          unitname: unit.name,
          responses: JSON.stringify(chunks),
          laststate: JSON.stringify(lastStateMap),
          originalUnitId: unit.alias || unit.name
        });

        if (!canContinue) {
          await new Promise(resolve => {
            csvStream.once('drain', resolve);
          });
        }

        processedCount += 1;
      }

      if (progressCallback && totalCount > 0) {
        await progressCallback(Math.round((processedCount / totalCount) * 100));
      }
    }

    csvStream.end();

    return new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  async getExportOptions(workspaceId: number): Promise<{
    testPersons: { id: number; groupName: string; code: string; login: string }[];
    booklets: string[];
    units: string[];
  }> {
    const testPersons = await this.personsRepository
      .createQueryBuilder('person')
      .select(['person.id', 'person.group', 'person.code', 'person.login'])
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('person.group', 'ASC')
      .addOrderBy('person.code', 'ASC')
      .addOrderBy('person.login', 'ASC')
      .getMany();

    const booklets = await this.bookletRepository
      .createQueryBuilder('booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('DISTINCT bookletinfo.name', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .orderBy('bookletinfo.name', 'ASC')
      .getRawMany();

    const units = await this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('DISTINCT unit.name', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .orderBy('unit.name', 'ASC')
      .getRawMany();

    return {
      testPersons: testPersons.map(p => ({
        id: p.id, groupName: p.group, code: p.code, login: p.login
      })),
      booklets: booklets.map(b => b.name),
      units: units.map(u => u.name)
    };
  }
}
