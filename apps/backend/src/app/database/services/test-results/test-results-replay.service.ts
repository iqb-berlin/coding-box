import {
  ConflictException, Inject,
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import type { ReplayUnitResponseDto } from '../../../../../../../api-dto/coding/replay-unit-response.dto';
import { REPLAY_RESPONSE_CACHE_SUFFIX } from '../workspace/workspace-constants';
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

interface ReplayResponseRow {
  id: number;
  variableid: string;
  value: string | null;
  status: number;
  subform: string | null;
  sourceChunkKey: string | null;
}

function resolvePlayerChunkKey(
  response: ReplayResponseRow, keys: Set<string> | undefined, scope?: string
): string {
  if (typeof response.sourceChunkKey === 'string') return response.sourceChunkKey;
  const subform = response.subform ?? '';
  // Old imports stored both explicit subforms and fallback chunk IDs in the same column.
  const unknownScope = scope !== undefined && subform !== '' && subform !== scope;
  if (unknownScope || (keys?.size ?? 0) > 1) {
    throw new ConflictException('Original replay chunk is ambiguous. Reimport the original responses to restore the chunk mapping.');
  }
  return keys?.values().next().value ?? subform;
}

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
    unitId: string,
    responseId?: number
  ): Promise<ReplayUnitResponseDto> {
    const unitCacheKey = `${this.cacheService.generateUnitResponseCacheKey(
      workspaceId,
      connector,
      unitId
    )}${REPLAY_RESPONSE_CACHE_SUFFIX}`;
    let cacheKey = unitCacheKey;
    if (responseId === undefined) {
      const cached = await this.cacheService.get<ReplayUnitResponseDto>(cacheKey);
      if (cached) return cached;
    }

    const parts = connector.split('@');
    const login = parts[0];
    const code = parts[1];
    const group = parts.length >= 4 ? parts[2] : undefined;
    const bookletId = parts[parts.length - 1];
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    if (isExcludedByResolvedExclusions(exclusions, bookletId, unitId)) {
      return { responses: [] };
    }

    const unitLookup = this.unitRepository
      .createQueryBuilder('unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .select('unit.id', 'unitId')
      .where('person.login = :login', { login })
      .andWhere('person.code = :code', { code });

    if (group) {
      unitLookup.andWhere('person.group = :group', { group });
    }

    unitLookup
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('bookletinfo.name = :bookletId', { bookletId });
    applyExclusionsToQuery(unitLookup, exclusions);
    if (responseId !== undefined) {
      unitLookup.innerJoin('unit.responses', 'target', 'target.id = :responseId', { responseId })
        .addSelect('target.subform', 'subform')
        .addSelect('target.is_autocoder_generated', 'generated');
    }
    const unitRow = await unitLookup
      .andWhere('(unit.alias = :unitId OR unit.name = :unitId)', { unitId })
      .orderBy('CASE WHEN unit.alias = :unitId THEN 0 ELSE 1 END', 'ASC')
      .limit(1)
      .getRawOne<{ unitId: number; subform?: string | null; generated?: boolean }>();

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

      const person = await this.personsRepository.findOne({ where: personWhere, select: { id: true } });

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
        select: { id: true },
        loadEagerRelations: false,
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

    const scope = responseId === undefined ? undefined : unitRow.subform ?? '';
    if (responseId !== undefined) {
      // All generated targets in a subform use its source rows. For a base target, check
      // that the cached state contains its exact row before reusing it.
      cacheKey = `${unitCacheKey}:scope:${JSON.stringify([unitDbId, scope, !!unitRow.generated])}`;
      const cached = await this.cacheService.get<ReplayUnitResponseDto>(cacheKey);
      if (cached && (unitRow.generated || cached.subformResponseIds?.includes(responseId))) return cached;
    }

    const result = await this.readPlayerState(unitDbId, scope, responseId);
    await this.cacheService.set(cacheKey, result);
    this.logger.log(
      `Cached replay responses: workspace=${workspaceId}, unitId=${unitId}`
    );

    return result;
  }

  private async readPlayerState(unitDbId: number, scope?: string, responseId?: number): Promise<ReplayUnitResponseDto> {
    const chunks = await this.chunkRepository.find({
      where: { unitid: unitDbId }
    });

    const responseRows = await this.readResponseRows(unitDbId, responseId, scope);

    return {
      responses: this.buildPlayerChunks(chunks, responseRows, scope),
      subformResponseIds: responseId === undefined ? undefined : responseRows
        .filter(row => (row.subform ?? '') === scope)
        .map(row => row.id)
    };
  }

  private buildPlayerChunks(chunks: ChunkEntity[], responseRows: ReplayResponseRow[], scope?: string) {
    const chunkKeysByVariable = new Map<string, Set<string>>();
    for (const chunk of chunks) {
      if (!chunk.variables) continue;
      for (const variable of chunk.variables.split(',').map(id => id.trim())) {
        const keys = chunkKeysByVariable.get(variable) ?? new Set<string>();
        keys.add(chunk.key);
        chunkKeysByVariable.set(variable, keys);
      }
    }

    const responsesByChunk = new Map<string, Map<string, ReplayResponseRow>>();
    for (const response of responseRows) {
      const chunkKey = resolvePlayerChunkKey(response, chunkKeysByVariable.get(response.variableid), scope);
      const variables = responsesByChunk.get(chunkKey) ?? new Map<string, ReplayResponseRow>();
      variables.set(response.variableid, response);
      responsesByChunk.set(chunkKey, variables);
    }
    return Array.from(responsesByChunk, ([id, variables]) => ({
      id,
      content: JSON.stringify(Array.from(variables.values(), row => ({
        id: row.variableid,
        value: parseStoredResponseValue(row.value, row.variableid),
        status: row.status
      })))
    }));
  }

  private readResponseRows(unitDbId: number, responseId?: number, subform?: string | null) {
    const responseQuery = this.responseRepository
      .createQueryBuilder('response')
      .select([
        'response.id AS id',
        'response.variableid AS variableid',
        'response.value AS value',
        'response.status AS status',
        'response.subform AS subform',
        'response.source_chunk_key AS "sourceChunkKey"'
      ])
      .where('response.unitid = :unitDbId', { unitDbId })
      .andWhere(
        nonAutocoderGeneratedResponseCondition(
          'response'
        )
      );
    if (responseId !== undefined) {
      // A derived target can depend on both local and shared inputs. Prefer its local row
      // when a variable exists in both scopes, and the exact target among repeated rows.
      responseQuery.andWhere(`(
        COALESCE(response.subform, '') IN ('', :subform)
        OR (response.chunk_has_subform IS FALSE AND NOT EXISTS (
          SELECT 1 FROM response sibling WHERE sibling.unitid = response.unitid
            AND sibling.variableid = response.variableid AND sibling.id <> response.id
            AND sibling.is_autocoder_generated IS NOT TRUE AND sibling.chunk_has_subform IS FALSE
        ))
        OR (response.chunk_has_subform IS NULL AND EXISTS (
          SELECT 1 FROM chunk c WHERE c.unitid = response.unitid AND c.key = response.subform
            AND response.variableid = ANY(string_to_array(c.variables, ','))
        ))
      )`, { subform: subform ?? '' })
        .distinctOn(['response.variableid'])
        .orderBy('response.variableid', 'ASC')
        .addOrderBy('(response.id = :responseId)', 'DESC')
        .addOrderBy("(COALESCE(response.subform, '') = :subform)", 'DESC')
        // A possible legacy input outside the target scope needs its original import to resolve it.
        .addOrderBy("(response.chunk_has_subform IS NULL AND NULLIF(response.subform, '') IS NOT NULL)", 'DESC')
        .addOrderBy('response.id', 'ASC')
        .setParameter('responseId', responseId);
    }
    return responseQuery.getRawMany<ReplayResponseRow>();
  }
}
