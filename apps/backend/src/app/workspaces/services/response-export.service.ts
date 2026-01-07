import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Response } from 'express';
import * as csv from 'fast-csv';
import * as fs from 'fs';
import { Writable } from 'stream';
import { ResponseValueType } from '@iqbspecs/response/response.interface';
import {
  Persons, Unit, ResponseEntity, Chunk, TcMergeResponse
} from '../../common';
import {
  statusNumberToString
} from '../utils/response-status-converter';
import { Booklet } from '../entities/booklet.entity';
import { BookletLog } from '../entities/bookletLog.entity';
import { UnitLog } from '../entities/unitLog.entity';
import { ChunkEntity } from '../entities/chunk.entity';
import { UnitLastState } from '../entities/unitLastState.entity';

@Injectable()
export class ResponseExportService {
  private readonly logger = new Logger(ResponseExportService.name);

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
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    private readonly connection: DataSource
  ) {}

  async exportTestResults(
    workspaceId: number,
    res: Response,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    }
  ): Promise<void> {
    this.logger.log(`Exporting test results for workspace ${workspaceId}`);
    await this.exportTestResultsToStream(workspaceId, res, filters);
  }

  async exportTestResultsToFile(
    workspaceId: number,
    filePath: string,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    this.logger.log(
      `Exporting test results for workspace ${workspaceId} to file ${filePath}`
    );
    const fileStream = fs.createWriteStream(filePath);
    await this.exportTestResultsToStream(
      workspaceId,
      fileStream,
      filters,
      progressCallback
    );
  }

  async exportTestResultsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
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

    const BATCH_SIZE = 100;
    let processedCount = 0;

    const createBaseQuery = () => {
      const qb = this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select([
          'unit.id',
          'unit.name',
          'unit.alias',
          'booklet.id',
          'person.group',
          'person.login',
          'person.code',
          'bookletinfo.name'
        ])
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });

      if (filters?.groupNames?.length) {
        qb.andWhere('person.group IN (:...groupNames)', {
          groupNames: filters.groupNames
        });
      }
      if (filters?.bookletNames?.length) {
        qb.andWhere('bookletinfo.name IN (:...bookletNames)', {
          bookletNames: filters.bookletNames
        });
      }
      if (filters?.unitNames?.length) {
        qb.andWhere('unit.name IN (:...unitNames)', {
          unitNames: filters.unitNames
        });
      }
      if (filters?.personIds?.length) {
        qb.andWhere('person.id IN (:...personIds)', {
          personIds: filters.personIds
        });
      }
      return qb;
    };

    const totalCount = await createBaseQuery().getCount();
    this.logger.log(`Total units to export: ${totalCount}`);

    let lastUnitId = 0;
    let hasMore = true;

    while (hasMore) {
      const units = await createBaseQuery()
        .andWhere('unit.id > :lastUnitId', { lastUnitId })
        .orderBy('unit.id', 'ASC')
        .take(BATCH_SIZE)
        .getMany();

      if (units.length === 0) {
        hasMore = false;
        break;
      }

      lastUnitId = units[units.length - 1].id;
      const unitIds = units.map(u => u.id);

      const responses = await this.responseRepository
        .createQueryBuilder('response')
        .select([
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
        .where('response.unitid IN (:...unitIds)', { unitIds })
        .getMany();

      const chunks = await this.chunkRepository
        .createQueryBuilder('chunk')
        .select([
          'chunk.unitid',
          'chunk.key',
          'chunk.variables',
          'chunk.ts',
          'chunk.type'
        ])
        .where('chunk.unitid IN (:...unitIds)', { unitIds })
        .getMany();

      const lastStates = await this.connection
        .getRepository(UnitLastState)
        .createQueryBuilder('laststate')
        .select(['laststate.unitid', 'laststate.key', 'laststate.value'])
        .where('laststate.unitid IN (:...unitIds)', { unitIds })
        .getMany();

      // Create maps for quick lookup
      const responsesByUnitId = new Map<number, ResponseEntity[]>();
      const chunksByUnitId = new Map<number, ChunkEntity[]>();
      const lastStatesByUnitId = new Map<
      number,
      Array<{ key: string; value: unknown }>
      >();

      responses.forEach(r => {
        if (!responsesByUnitId.has(r.unitid)) {
          responsesByUnitId.set(r.unitid, []);
        }
        responsesByUnitId.get(r.unitid)!.push(r);
      });

      chunks.forEach(chunk => {
        if (!chunksByUnitId.has(chunk.unitid)) {
          chunksByUnitId.set(chunk.unitid, []);
        }
        chunksByUnitId.get(chunk.unitid)!.push(chunk);
      });

      lastStates.forEach(ls => {
        if (!lastStatesByUnitId.has(ls.unitid)) {
          lastStatesByUnitId.set(ls.unitid, []);
        }
        lastStatesByUnitId
          .get(ls.unitid)!
          .push({ key: ls.key, value: ls.value });
      });

      for (const unit of units) {
        const unitResponses = responsesByUnitId.get(unit.id) || [];
        const unitChunks = chunksByUnitId.get(unit.id) || [];
        const unitLastStates = lastStatesByUnitId.get(unit.id) || [];

        const chunkKeyMap = new Map<string, string>();
        const chunkMetaByKey = new Map<string, { ts: number; type: string }>();

        unitChunks.forEach(chunk => {
          if (chunk.variables) {
            const variables = chunk.variables.split(',').map(v => v.trim());
            variables.forEach(variable => {
              chunkKeyMap.set(variable, chunk.key);
            });
          }

          // Store timestamp and type for each chunk key so we can use it in the export
          if (!chunkMetaByKey.has(chunk.key)) {
            chunkMetaByKey.set(chunk.key, {
              ts: Number(chunk.ts) || 0,
              type: chunk.type || 'state'
            });
          }
        });

        const responsesByChunkKey = new Map<string, TcMergeResponse[]>();

        unitResponses.forEach(r => {
          const chunkKey = chunkKeyMap.get(r.variableid) || r.subform || '';
          if (!responsesByChunkKey.has(chunkKey)) {
            responsesByChunkKey.set(chunkKey, []);
          }

          let value: ResponseValueType = r.value;
          try {
            if (typeof r.value === 'string' && r.value.length > 0) {
              value = JSON.parse(r.value);
            }
          } catch (e) {
            // keep as string
          }

          responsesByChunkKey.get(chunkKey)!.push({
            id: r.variableid,
            value: value,
            status: statusNumberToString(r.status) || 'UNSET',
            subform: r.subform,
            code: r.code_v1,
            score: r.score_v1
          });
        });

        const exportChunks: Chunk[] = [];
        responsesByChunkKey.forEach((chunkResponses, chunkKey) => {
          const meta = chunkMetaByKey.get(chunkKey);
          const resolvedSubForm =
            chunkResponses.find(r => r.subform && r.subform.length > 0)
              ?.subform || '';

          exportChunks.push({
            id: chunkKey,
            subForm: resolvedSubForm,
            responseType: meta?.type || 'state',
            ts: meta?.ts || 0,
            content: JSON.stringify(chunkResponses)
          });
        });

        const lastStateMap: { [key: string]: unknown } = {};
        unitLastStates.forEach(ls => {
          lastStateMap[ls.key] = ls.value;
        });

        const canContinue = csvStream.write({
          groupname: unit.booklet.person.group,
          loginname: unit.booklet.person.login,
          code: unit.booklet.person.code,
          bookletname: unit.booklet.bookletinfo.name,
          unitname: unit.name,
          responses: JSON.stringify(exportChunks),
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

  async exportTestLogsToFile(
    workspaceId: number,
    filePath: string,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    this.logger.log(
      `Exporting test logs for workspace ${workspaceId} to file ${filePath}`
    );
    const fileStream = fs.createWriteStream(filePath);
    await this.exportTestLogsToStream(
      workspaceId,
      fileStream,
      filters,
      progressCallback
    );
  }

  async exportTestLogsToStream(
    workspaceId: number,
    stream: Writable,
    filters?: {
      groupNames?: string[];
      bookletNames?: string[];
      unitNames?: string[];
      personIds?: number[];
    },
    progressCallback?: (progress: number) => Promise<void> | void
  ): Promise<void> {
    const csvStream = csv.format({
      headers: [
        'groupname',
        'loginname',
        'code',
        'bookletname',
        'unitname',
        'originalUnitId',
        'timestamp',
        'logentry'
      ],
      delimiter: ';',
      quote: null
    });

    csvStream.pipe(stream);

    const BATCH_SIZE = 2000;
    let processedCount = 0;

    const hasUnitFilters = Boolean(filters?.unitNames?.length);

    // Export booklet logs (unitname must be empty string for importer)
    if (!hasUnitFilters) {
      let lastBookletLogId = 0;
      let hasMoreBookletLogs = true;

      const createBookletLogsBaseQuery = () => {
        const qb = this.bookletLogRepository
          .createQueryBuilder('bookletLog')
          .innerJoin('bookletLog.booklet', 'booklet')
          .innerJoin('booklet.person', 'person')
          .innerJoin('booklet.bookletinfo', 'bookletinfo')
          .select('bookletLog.id', 'id')
          .addSelect('bookletLog.ts', 'ts')
          .addSelect('bookletLog.key', 'key')
          .addSelect('bookletLog.parameter', 'parameter')
          .addSelect('person.group', 'groupname')
          .addSelect('person.login', 'loginname')
          .addSelect('person.code', 'code')
          .addSelect('bookletinfo.name', 'bookletname')
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true });

        if (filters?.groupNames?.length) {
          qb.andWhere('person.group IN (:...groupNames)', {
            groupNames: filters.groupNames
          });
        }
        if (filters?.bookletNames?.length) {
          qb.andWhere('bookletinfo.name IN (:...bookletNames)', {
            bookletNames: filters.bookletNames
          });
        }
        if (filters?.personIds?.length) {
          qb.andWhere('person.id IN (:...personIds)', {
            personIds: filters.personIds
          });
        }

        return qb;
      };

      const totalBookletLogs = await createBookletLogsBaseQuery().getCount();

      while (hasMoreBookletLogs) {
        const logs = await createBookletLogsBaseQuery()
          .andWhere('bookletLog.id > :lastBookletLogId', { lastBookletLogId })
          .orderBy('bookletLog.id', 'ASC')
          .take(BATCH_SIZE)
          .getRawMany<{
          id: number;
          ts: string | number | null;
          key: string;
          parameter: string | null;
          groupname: string;
          loginname: string;
          code: string;
          bookletname: string;
        }>();

        if (logs.length === 0) {
          hasMoreBookletLogs = false;
          break;
        }

        lastBookletLogId = Number(logs[logs.length - 1].id);

        for (const log of logs) {
          const parameter = log.parameter || '';
          const logentry = `${log.key} : ${parameter}`;
          const canContinue = csvStream.write({
            groupname: log.groupname,
            loginname: log.loginname,
            code: log.code,
            bookletname: log.bookletname,
            unitname: '',
            originalUnitId: '',
            timestamp: (log.ts ?? '').toString(),
            logentry
          });

          if (!canContinue) {
            await new Promise(resolve => {
              csvStream.once('drain', resolve);
            });
          }

          processedCount += 1;
          if (progressCallback && totalBookletLogs > 0) {
            await progressCallback(
              Math.round((processedCount / totalBookletLogs) * 100)
            );
          }
        }
      }
    }

    // Export unit logs (unitname must be non-empty for importer)
    let lastUnitLogId = 0;
    let hasMoreUnitLogs = true;

    const createUnitLogsBaseQuery = () => {
      const qb = this.unitLogRepository
        .createQueryBuilder('unitLog')
        .innerJoin('unitLog.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select('unitLog.id', 'id')
        .addSelect('unitLog.ts', 'ts')
        .addSelect('unitLog.key', 'key')
        .addSelect('unitLog.parameter', 'parameter')
        .addSelect('unit.name', 'unitname')
        .addSelect('unit.alias', 'originalUnitId')
        .addSelect('person.group', 'groupname')
        .addSelect('person.login', 'loginname')
        .addSelect('person.code', 'code')
        .addSelect('bookletinfo.name', 'bookletname')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true });

      if (filters?.groupNames?.length) {
        qb.andWhere('person.group IN (:...groupNames)', {
          groupNames: filters.groupNames
        });
      }
      if (filters?.bookletNames?.length) {
        qb.andWhere('bookletinfo.name IN (:...bookletNames)', {
          bookletNames: filters.bookletNames
        });
      }
      if (filters?.unitNames?.length) {
        qb.andWhere('unit.name IN (:...unitNames)', {
          unitNames: filters.unitNames
        });
      }
      if (filters?.personIds?.length) {
        qb.andWhere('person.id IN (:...personIds)', {
          personIds: filters.personIds
        });
      }

      return qb;
    };

    const totalUnitLogs = await createUnitLogsBaseQuery().getCount();

    while (hasMoreUnitLogs) {
      const logs = await createUnitLogsBaseQuery()
        .andWhere('unitLog.id > :lastUnitLogId', { lastUnitLogId })
        .orderBy('unitLog.id', 'ASC')
        .take(BATCH_SIZE)
        .getRawMany<{
        id: number;
        ts: string | number | null;
        key: string;
        parameter: string | null;
        unitname: string;
        originalUnitId: string | null;
        groupname: string;
        loginname: string;
        code: string;
        bookletname: string;
      }>();

      if (logs.length === 0) {
        hasMoreUnitLogs = false;
        break;
      }

      lastUnitLogId = Number(logs[logs.length - 1].id);

      for (const log of logs) {
        const parameter = log.parameter || '';
        const logentry = `${log.key}=${parameter}`;

        const canContinue = csvStream.write({
          groupname: log.groupname,
          loginname: log.loginname,
          code: log.code,
          bookletname: log.bookletname,
          unitname: log.unitname,
          originalUnitId: log.originalUnitId || log.unitname,
          timestamp: (log.ts ?? '').toString(),
          logentry
        });

        if (!canContinue) {
          await new Promise(resolve => {
            csvStream.once('drain', resolve);
          });
        }

        processedCount += 1;
        if (progressCallback && totalUnitLogs > 0) {
          await progressCallback(
            Math.round((processedCount / totalUnitLogs) * 100)
          );
        }
      }
    }

    csvStream.end();

    return new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });
  }

  async getExportOptions(workspaceId: number): Promise<{
    testPersons: {
      id: number;
      groupName: string;
      code: string;
      login: string;
    }[];
    groups: string[];
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

    const groups = await this.personsRepository
      .createQueryBuilder('person')
      .select('DISTINCT person.group', 'name')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .orderBy('person.group', 'ASC')
      .getRawMany();

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
        id: p.id,
        groupName: p.group,
        code: p.code,
        login: p.login
      })),
      groups: groups.map(g => g.name),
      booklets: booklets.map(b => b.name),
      units: units.map(u => u.name)
    };
  }
}
