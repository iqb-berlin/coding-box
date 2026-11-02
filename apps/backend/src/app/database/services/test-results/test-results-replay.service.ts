import {
  Inject,
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import { CacheService } from '../../../cache/cache.service';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import {
  WorkspaceExclusionService,
  isExcludedByResolvedExclusions
} from '../workspace/workspace-exclusion.service';
import { ReplayResourceNotFoundError } from './replay-resource-not-found.error';
import { applyExclusionsToQuery, nonAutocoderGeneratedResponseCondition, parseStoredResponseValue } from './test-results.util';
import { PersonWhere } from './workspace-test-results.types';

@Injectable()
export class TestResultsReplayService {
  private readonly logger = new Logger('WorkspaceTestResultsService');

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
    @InjectRepository(ChunkEntity)
    private chunkRepository: Repository<ChunkEntity>,
    private readonly cacheService: CacheService,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async findUnitResponse(
    workspaceId: number,
    connector: string,
    unitId: string
  ): Promise<{
    responses: {
      id: string;
      content: string;
    }[];
  }> {
    const cacheKey = `${this.cacheService.generateUnitResponseCacheKey(
      workspaceId,
      connector,
      unitId
    )}:v6`;
    const cachedResponse = await this.cacheService.get<{
      responses: {
        id: string;
        content: string;
      }[];
    }>(cacheKey);

    if (cachedResponse) {
      this.logger.log(
        `Cache hit for replay responses: workspace=${workspaceId}, unitId=${unitId}`
      );
      return cachedResponse;
    }

    this.logger.log(
      `Cache miss for replay responses: workspace=${workspaceId}, unitId=${unitId}`
    );

    const parts = connector.split('@');
    const login = parts[0];
    const code = parts[1];
    const group = parts.length >= 4 ? parts[2] : undefined;
    const bookletId = parts[parts.length - 1];
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    if (isExcludedByResolvedExclusions(exclusions, bookletId, unitId)) {
      return { responses: [] };
    }

    const createUnitLookupQuery = () => {
      const queryBuilder = this.unitRepository
        .createQueryBuilder('unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .select('unit.id', 'unitId')
        .where('person.login = :login', { login })
        .andWhere('person.code = :code', { code });

      if (group) {
        queryBuilder.andWhere('person.group = :group', { group });
      }

      queryBuilder
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('bookletinfo.name = :bookletId', { bookletId });
      applyExclusionsToQuery(queryBuilder, exclusions);
      return queryBuilder;
    };

    const unitRow = await createUnitLookupQuery()
      .andWhere('(unit.alias = :unitId OR unit.name = :unitId)', { unitId })
      .orderBy('CASE WHEN unit.alias = :unitId THEN 0 ELSE 1 END', 'ASC')
      .limit(1)
      .getRawOne<{ unitId: number }>();

    const unitDbId = unitRow?.unitId;

    if (!unitDbId) {
      const personWhere: PersonWhere = {
        code,
        login,
        workspace_id: workspaceId,
        consider: true
      };
      if (group) {
        personWhere.group = group;
      }

      const person = await this.personsRepository.findOne({
        where: personWhere
      });

      if (!person) {
        throw new ReplayResourceNotFoundError('REPLAY_PERSON_NOT_FOUND');
      }

      const bookletInfo = await this.bookletInfoRepository.findOne({
        where: { name: bookletId }
      });

      if (!bookletInfo) {
        throw new ReplayResourceNotFoundError('REPLAY_BOOKLET_NOT_FOUND');
      }

      const booklet = await this.bookletRepository.findOne({
        where: {
          personid: person.id,
          infoid: bookletInfo.id
        }
      });

      if (!booklet) {
        throw new ReplayResourceNotFoundError('REPLAY_BOOKLET_NOT_FOUND');
      }

      throw new ReplayResourceNotFoundError('REPLAY_UNIT_NOT_FOUND');
    }

    const chunks = await this.chunkRepository.find({
      where: { unitid: unitDbId }
    });

    if (chunks.length > 0) {
      this.logger.log(`Found ${chunks.length} chunks for unit ${unitDbId}`);
      chunks.forEach(chunk => {
        this.logger.log(
          `Chunk: key=${chunk.key}, type=${chunk.type}, variables=${chunk.variables}, ts=${chunk.ts}`
        );
      });
    } else {
      this.logger.log(`No chunks found for unit ${unitDbId}`);
    }

    const responseRows = await this.responseRepository
      .createQueryBuilder('response')
      .select([
        'response.variableid AS variableid',
        'response.value AS value',
        'response.status AS status',
        'response.subform AS subform'
      ])
      .where('response.unitid = :unitDbId', { unitDbId })
      .andWhere(
        nonAutocoderGeneratedResponseCondition(
          'response'
        )
      )
      .getRawMany<{
      variableid: string;
      value: string | null;
      status: number;
      subform: string | null;
    }>();

    const chunkKeyMap = new Map<string, { key: string; ts: number }>();
    chunks.forEach(chunk => {
      if (chunk.variables) {
        const chunkTs = Number(chunk.ts) || 0;
        const variables = chunk.variables.split(',').map(v => v.trim());
        variables.forEach(variable => {
          const current = chunkKeyMap.get(variable);
          if (!current || chunkTs >= current.ts) {
            chunkKeyMap.set(variable, { key: chunk.key, ts: chunkTs });
          }
        });
      }
    });

    const responsesByChunk = new Map<string, Map<string, {
      id: string;
      value: unknown;
      status: number;
      chunkTs: number;
    }>>();

    responseRows.forEach(response => {
      const mappedChunk = chunkKeyMap.get(response.variableid);
      const chunkKey = mappedChunk?.key || response.subform || '';
      const chunkTs = mappedChunk?.ts || 0;
      const mappedResponse = {
        id: response.variableid,
        value: parseStoredResponseValue(response.value, response.variableid),
        status: response.status,
        chunkTs
      };

      if (!responsesByChunk.has(chunkKey)) {
        responsesByChunk.set(chunkKey, new Map());
      }
      const chunkResponses = responsesByChunk.get(chunkKey)!;
      const existing = chunkResponses.get(mappedResponse.id);
      if (!existing || mappedResponse.chunkTs >= existing.chunkTs) {
        chunkResponses.set(mappedResponse.id, mappedResponse);
      }
    });

    const responsesArray = Array.from(responsesByChunk.entries()).map(([chunkKey, responseMap]) => ({
      id: chunkKey,
      content: JSON.stringify(Array.from(responseMap.values()).map(({
        chunkTs: _chunkTs,
        ...response
      }) => response))
    }));

    const result = {
      responses: responsesArray
    };

    await this.cacheService.set(cacheKey, result);
    this.logger.log(
      `Cached replay responses: workspace=${workspaceId}, unitId=${unitId}`
    );

    return result;
  }
}
