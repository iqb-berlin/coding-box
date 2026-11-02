import {
  Inject,
  Injectable,
  Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityTarget,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder
} from 'typeorm';
import {
  TestResultsDeletePreviewDto,
  TestResultsDeleteRequestDto,
  TestResultsResponseCleanupRequestDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { Booklet } from '../../entities/booklet.entity';
import { BookletInfo } from '../../entities/bookletInfo.entity';
import { BookletLog } from '../../entities/bookletLog.entity';
import { ChunkEntity } from '../../entities/chunk.entity';
import Persons from '../../entities/persons.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Session } from '../../entities/session.entity';
import { Unit } from '../../entities/unit.entity';
import { UnitLog } from '../../entities/unitLog.entity';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import {
  applyDeleteTargetFilter, chunkArray, getDeleteLabel, getResponseCleanupLabel, limitPreviewStrings, normalizeDeleteRequest, normalizeResponseCleanupRequest, normalizeStringList, normalizeUnitKey, rawRowsToIds, responseMatchesChunkCondition, toPreviewList, toResponseCleanupSample, uniqueIds
} from './test-results-deletion.util';
import { applyExclusionsToQuery, applyIgnoredBookletsToQuery, excludeAutocoderGeneratedResponses } from './test-results.util';
import {
  DeleteDependencySnapshot, LogDeleteCounts, LogDeleteSnapshot, NormalizedResponseCleanupRequest, ResponseCleanupTargetRow, ResponseCleanupTargets, TestResultsDeleteTargetKind, TestResultsDeleteTargets
} from './workspace-test-results.types';

@Injectable()
export class TestResultsDeletionQueryService {
  constructor(
    @InjectRepository(Persons)
    private personsRepository: Repository<Persons>,
    @InjectRepository(Unit)
    private unitRepository: Repository<Unit>,
    @InjectRepository(Booklet)
    private bookletRepository: Repository<Booklet>,
    private readonly connection: DataSource,
    @Inject(WorkspaceExclusionService)
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @Optional()
    @Inject(CodingFreshnessService)
    private readonly codingFreshnessService?: CodingFreshnessService
  ) {}

  async resolveResponseCleanupTargets(
    workspaceId: number,
    request: TestResultsResponseCleanupRequestDto
  ): Promise<ResponseCleanupTargets> {
    const normalized =
      normalizeResponseCleanupRequest(request);
    const warnings: string[] = [];
    const isValidRequest =
      normalized.unitNames.length > 0 &&
      normalized.answeredBefore !== null &&
      (
        normalized.answeredFrom === null ||
        normalized.answeredFrom < normalized.answeredBefore
      );

    if (normalized.unitNames.length === 0) {
      warnings.push('Es wurde keine Aufgabe ausgewählt.');
    }

    if (normalized.answeredBefore === null) {
      warnings.push('Es wurde kein gültiger Stichtag angegeben.');
    }

    if (
      normalized.answeredFrom !== null &&
      normalized.answeredBefore !== null &&
      normalized.answeredFrom >= normalized.answeredBefore
    ) {
      warnings.push('Der Beginn des Zeitraums muss vor dem Stichtag liegen.');
    }

    const rows = isValidRequest ?
      await this.getResponseCleanupRows(workspaceId, normalized) :
      [];
    const unknownTimestampResponses = isValidRequest ?
      await this.countResponseCleanupUnknownTimestamps(workspaceId, normalized) :
      0;

    if (rows.length === 0 && isValidRequest) {
      warnings.push(
        'Keine passenden Antworten mit auswertbarem Chunk-Zeitstempel gefunden.'
      );
    }

    if (unknownTimestampResponses > 0) {
      warnings.push(
        `${unknownTimestampResponses} Antwort(en) in der Auswahl haben keinen auswertbaren Chunk-Zeitstempel und werden nicht gelöscht.`
      );
    }

    const responseIds = uniqueIds(
      rows.map(row => row.responseId)
    );
    const unitIds = uniqueIds(
      rows.map(row => row.unitId)
    );
    const codingImpact = await this.getResponseCleanupCodingImpact(
      responseIds,
      unitIds
    );
    const groups = normalizeStringList(
      rows.map(row => row.personGroup)
    );
    const bookletNames = limitPreviewStrings(
      rows.map(row => row.bookletName)
    );
    const unitNames = limitPreviewStrings(
      rows.map(row => row.unitName)
    );

    const preview: TestResultsDeletePreviewDto = {
      targetType: 'responses',
      scope: 'units',
      label: getResponseCleanupLabel(normalized),
      persons: new Set(rows.map(row => row.personId)).size,
      booklets: new Set(rows.map(row => row.bookletId)).size,
      units: unitIds.length,
      responses: responseIds.length,
      groups,
      bookletNames,
      unitNames,
      codingImpact,
      warnings,
      responseCleanup: {
        answeredFrom: normalized.answeredFrom || undefined,
        answeredBefore: normalized.answeredBefore || undefined,
        variableIds: normalized.variableIds,
        subforms: normalized.subforms,
        timestampSourceCounts: {
          chunk: responseIds.length,
          unknown: unknownTimestampResponses
        },
        unknownTimestampResponses,
        samples: rows
          .slice(0, 10)
          .map(toResponseCleanupSample)
      }
    };

    return {
      responseIds,
      unitIds,
      preview
    };
  }

  private async getResponseCleanupRows(
    workspaceId: number,
    request: NormalizedResponseCleanupRequest
  ): Promise<ResponseCleanupTargetRow[]> {
    const query = this.createResponseCleanupBaseQuery(workspaceId, request)
      .select('response.id', 'responseId')
      .addSelect('unit.id', 'unitId')
      .addSelect('person.id', 'personId')
      .addSelect('person.code', 'personCode')
      .addSelect('person.login', 'personLogin')
      .addSelect('person.group', 'personGroup')
      .addSelect('booklet.id', 'bookletId')
      .addSelect('bookletinfo.name', 'bookletName')
      .addSelect('COALESCE(unit.alias, unit.name)', 'unitName')
      .addSelect('response.variableid', 'variableId')
      .addSelect('response.subform', 'subform')
      .addSelect('response.value', 'value')
      .addSelect('MAX(chunk.ts)', 'answeredAt')
      .groupBy('response.id')
      .addGroupBy('unit.id')
      .addGroupBy('person.id')
      .addGroupBy('person.code')
      .addGroupBy('person.login')
      .addGroupBy('person.group')
      .addGroupBy('booklet.id')
      .addGroupBy('bookletinfo.name')
      .addGroupBy('unit.alias')
      .addGroupBy('unit.name')
      .addGroupBy('response.variableid')
      .addGroupBy('response.subform')
      .addGroupBy('response.value')
      .having('MAX(chunk.ts) < :answeredBefore', {
        answeredBefore: request.answeredBefore
      });

    if (request.answeredFrom !== null) {
      query.andHaving('MAX(chunk.ts) >= :answeredFrom', {
        answeredFrom: request.answeredFrom
      });
    }

    const rows = await query.getRawMany<Record<string, unknown>>();
    return rows
      .map(row => ({
        responseId: Number(row.responseId),
        unitId: Number(row.unitId),
        personId: Number(row.personId),
        personCode: String(row.personCode || ''),
        personLogin: String(row.personLogin || ''),
        personGroup: String(row.personGroup || ''),
        bookletId: Number(row.bookletId),
        bookletName: String(row.bookletName || ''),
        unitName: String(row.unitName || ''),
        variableId: String(row.variableId || ''),
        subform: row.subform === null || row.subform === undefined ?
          null :
          String(row.subform),
        value: row.value === null || row.value === undefined ?
          null :
          String(row.value),
        answeredAt: row.answeredAt === null || row.answeredAt === undefined ?
          null :
          Number(row.answeredAt),
        timestampSource: 'chunk' as const
      }))
      .filter(row => Number.isInteger(row.responseId) && row.responseId > 0);
  }

  private createResponseCleanupBaseQuery(
    workspaceId: number,
    request: NormalizedResponseCleanupRequest
  ): SelectQueryBuilder<ObjectLiteral> {
    const query = this.connection
      .createQueryBuilder()
      .from(ResponseEntity, 'response')
      .innerJoin(Unit, 'unit', 'unit.id = response.unitid')
      .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid')
      .innerJoin(
        ChunkEntity,
        'chunk',
        `chunk.unitid = unit.id
          AND chunk.ts IS NOT NULL
          AND ${responseMatchesChunkCondition('chunk', 'response')}`
      )
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(
        `(REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') IN (:...unitNames)
          OR REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') IN (:...unitNames))`,
        { unitNames: request.unitNames }
      );

    if (request.variableIds.length > 0) {
      query.andWhere('response.variableid IN (:...variableIds)', {
        variableIds: request.variableIds
      });
    }

    if (request.subforms.length > 0) {
      query.andWhere("COALESCE(response.subform, '') IN (:...subforms)", {
        subforms: request.subforms
      });
    }

    return query;
  }

  private async countResponseCleanupUnknownTimestamps(
    workspaceId: number,
    request: NormalizedResponseCleanupRequest
  ): Promise<number> {
    const query = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT response.id)', 'count')
      .from(ResponseEntity, 'response')
      .innerJoin(Unit, 'unit', 'unit.id = response.unitid')
      .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(
        `(REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') IN (:...unitNames)
          OR REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') IN (:...unitNames))`,
        { unitNames: request.unitNames }
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM chunk cleanup_chunk
          WHERE cleanup_chunk.unitid = unit.id
            AND cleanup_chunk.ts IS NOT NULL
            AND ${responseMatchesChunkCondition('cleanup_chunk', 'response')}
        )`
      );

    if (request.variableIds.length > 0) {
      query.andWhere('response.variableid IN (:...variableIds)', {
        variableIds: request.variableIds
      });
    }

    if (request.subforms.length > 0) {
      query.andWhere("COALESCE(response.subform, '') IN (:...subforms)", {
        subforms: request.subforms
      });
    }

    const raw = await query.getRawOne<{ count: string }>();
    return Number(raw?.count || 0);
  }

  private async getResponseCleanupCodingImpact(
    responseIds: number[],
    unitIds: number[]
  ): Promise<NonNullable<TestResultsDeletePreviewDto['codingImpact']>> {
    const impact = {
      autoCodingV1: 0,
      manualCodingV2: 0,
      autoCodingV3: 0,
      affectedUnits: unitIds.length
    };

    for (const chunk of chunkArray(
      responseIds,
      1000
    )) {
      const raw = await this.connection
        .createQueryBuilder()
        .select(
          'SUM(CASE WHEN response.status_v1 IS NOT NULL OR response.code_v1 IS NOT NULL OR response.score_v1 IS NOT NULL THEN 1 ELSE 0 END)',
          'autoCodingV1'
        )
        .addSelect(
          'SUM(CASE WHEN response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL THEN 1 ELSE 0 END)',
          'manualCodingV2'
        )
        .addSelect(
          'SUM(CASE WHEN response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL THEN 1 ELSE 0 END)',
          'autoCodingV3'
        )
        .from(ResponseEntity, 'response')
        .where('response.id IN (:...responseIds)', { responseIds: chunk })
        .getRawOne<Record<string, string | null>>();

      impact.autoCodingV1 += Number(raw?.autoCodingV1 || 0);
      impact.manualCodingV2 += Number(raw?.manualCodingV2 || 0);
      impact.autoCodingV3 += Number(raw?.autoCodingV3 || 0);
    }

    return impact;
  }

  async buildLogDeletePreview(
    targets: TestResultsDeleteTargets
  ): Promise<TestResultsDeletePreviewDto> {
    const snapshot = await this.collectLogDeleteSnapshot(
      targets.kind,
      targets.ids
    );
    const counts = await this.getLogDeleteCounts(snapshot);
    const warnings = [...targets.preview.warnings];
    const totalLogRows = counts.bookletLogs + counts.unitLogs + counts.sessions;

    if (targets.kind === 'units') {
      warnings.push(
        'Bei Aufgaben-Auswahl werden nur Aufgaben-Logs entfernt. Booklet-Logs und Sitzungen bleiben erhalten.'
      );
    }

    if (targets.ids.length > 0 && totalLogRows === 0) {
      warnings.push('Für den ausgewählten Bereich wurden keine Logs gefunden.');
    }

    return {
      ...targets.preview,
      targetType: 'logs',
      bookletLogs: counts.bookletLogs,
      unitLogs: counts.unitLogs,
      sessions: counts.sessions,
      warnings
    };
  }

  async collectLogDeleteSnapshot(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<LogDeleteSnapshot> {
    if (ids.length === 0) {
      return {
        bookletIds: [],
        unitIds: []
      };
    }

    const [bookletIds, unitIds] = await Promise.all([
      kind === 'units' ? Promise.resolve([]) :
        this.collectAffectedBookletIds(kind, ids),
      this.collectAffectedUnitIds(kind, ids)
    ]);

    return {
      bookletIds: uniqueIds(bookletIds),
      unitIds: uniqueIds(unitIds)
    };
  }

  private async getLogDeleteCounts(
    snapshot: LogDeleteSnapshot
  ): Promise<LogDeleteCounts> {
    const [bookletLogs, unitLogs, sessions] = await Promise.all([
      this.countRowsByIds(BookletLog, 'bookletid', snapshot.bookletIds),
      this.countRowsByIds(UnitLog, 'unitid', snapshot.unitIds),
      this.countRowsByIds(Session, 'bookletid', snapshot.bookletIds)
    ]);

    return {
      bookletLogs,
      unitLogs,
      sessions
    };
  }

  async collectDeleteDependencySnapshot(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<DeleteDependencySnapshot> {
    if (ids.length === 0) {
      return {
        bookletIds: [],
        unitIds: [],
        responseIds: [],
        bookletInfoIds: []
      };
    }

    const [bookletIds, unitIds, bookletInfoIds] = await Promise.all([
      this.collectAffectedBookletIds(kind, ids),
      this.collectAffectedUnitIds(kind, ids),
      this.collectAffectedBookletInfoIds(kind, ids)
    ]);
    const responseIds = await this.collectIdsFromChunks(
      unitIds,
      async chunk => {
        const rows = await this.connection
          .createQueryBuilder()
          .select('response.id', 'id')
          .from(ResponseEntity, 'response')
          .where('response.unitid IN (:...ids)', { ids: chunk })
          .getRawMany<{ id: number | string }>();

        return rawRowsToIds(rows);
      }
    );

    return {
      bookletIds,
      unitIds,
      responseIds,
      bookletInfoIds
    };
  }

  private async collectAffectedBookletIds(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<number[]> {
    if (kind === 'booklets') {
      return ids;
    }

    const query = this.connection
      .createQueryBuilder()
      .select('DISTINCT booklet.id', 'id')
      .from(Booklet, 'booklet');

    if (kind === 'persons') {
      query.where('booklet.personid IN (:...ids)', { ids });
    } else {
      query
        .innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('unit.id IN (:...ids)', { ids });
    }

    const rows = await query.getRawMany<{ id: number | string }>();
    return rawRowsToIds(rows);
  }

  private async collectAffectedUnitIds(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<number[]> {
    if (ids.length === 0) {
      return [];
    }

    if (kind === 'units') {
      return ids;
    }

    const query = this.connection
      .createQueryBuilder()
      .select('DISTINCT unit.id', 'id')
      .from(Unit, 'unit');

    if (kind === 'persons') {
      query
        .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
        .where('booklet.personid IN (:...ids)', { ids });
    } else {
      query.where('unit.bookletid IN (:...ids)', { ids });
    }

    const rows = await query.getRawMany<{ id: number | string }>();
    return rawRowsToIds(rows);
  }

  private async collectAffectedBookletInfoIds(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<number[]> {
    const query = this.connection
      .createQueryBuilder()
      .select('DISTINCT booklet.infoid', 'id')
      .from(Booklet, 'booklet');

    if (kind === 'persons') {
      query.where('booklet.personid IN (:...ids)', { ids });
    } else if (kind === 'booklets') {
      query.where('booklet.id IN (:...ids)', { ids });
    } else {
      query
        .innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('unit.id IN (:...ids)', { ids });
    }

    const rows = await query.getRawMany<{ id: number | string }>();
    return rawRowsToIds(rows);
  }

  async countRowsByIds(
    entity: EntityTarget<ObjectLiteral>,
    columnExpression: string,
    ids: number[]
  ): Promise<number> {
    let count = 0;
    for (const chunk of chunkArray(
      uniqueIds(ids),
      1000
    )) {
      const raw = await this.connection
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from(entity, 'row')
        .where(`row.${columnExpression} IN (:...ids)`, { ids: chunk })
        .getRawOne<{ count: string }>();
      count += Number(raw?.count || 0);
    }
    return count;
  }

  async countOrphanedBookletInfos(infoIds: number[]): Promise<number> {
    let count = 0;
    for (const chunk of chunkArray(
      uniqueIds(infoIds),
      1000
    )) {
      const raw = await this.connection
        .createQueryBuilder()
        .select('COUNT(*)', 'count')
        .from(BookletInfo, 'bookletinfo')
        .where('bookletinfo.id IN (:...ids)', { ids: chunk })
        .andWhere(
          'NOT EXISTS (SELECT 1 FROM booklet WHERE booklet.infoid = bookletinfo.id)'
        )
        .getRawOne<{ count: string }>();
      count += Number(raw?.count || 0);
    }
    return count;
  }

  private async collectIdsFromChunks(
    ids: number[],
    collect: (chunk: number[]) => Promise<number[]>
  ): Promise<number[]> {
    const result: number[] = [];
    for (const chunk of chunkArray(
      uniqueIds(ids),
      1000
    )) {
      result.push(...await collect(chunk));
    }
    return uniqueIds(result);
  }

  async resolveDeleteTargets(
    workspaceId: number,
    request: TestResultsDeleteRequestDto
  ): Promise<TestResultsDeleteTargets> {
    const normalizedRequest =
      normalizeDeleteRequest(request);
    const warnings: string[] = [];
    let kind: TestResultsDeleteTargetKind = 'persons';
    let ids: number[] = [];

    switch (normalizedRequest.scope) {
      case 'persons':
        kind = 'persons';
        if (normalizedRequest.personIds.length > 0) {
          const rows = await this.personsRepository
            .createQueryBuilder('person')
            .select(['person.id'])
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.id IN (:...personIds)', {
              personIds: normalizedRequest.personIds
            })
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      case 'filteredPersons': {
        kind = 'persons';
        const query = this.personsRepository
          .createQueryBuilder('person')
          .select(['person.id'])
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true });

        if (normalizedRequest.searchText) {
          query.andWhere(
            '(person.code ILIKE :searchText OR person.group ILIKE :searchText OR person.login ILIKE :searchText)',
            { searchText: `%${normalizedRequest.searchText}%` }
          );
        }

        const rows = await query.getMany();
        ids = rows.map(row => row.id);
        break;
      }
      case 'filteredGroups': {
        // Expand matching persons to their complete groups in the same workspace.
        // Neither the matching query nor the target query is paginated.
        const matchingGroups = this.personsRepository
          .createQueryBuilder('matchingPerson')
          .select('matchingPerson.group')
          .where('matchingPerson.workspace_id = :workspaceId', { workspaceId })
          .andWhere('matchingPerson.consider = :consider', { consider: true })
          .andWhere("BTRIM(matchingPerson.group) <> ''");
        if (normalizedRequest.searchText) {
          matchingGroups.andWhere(
            '(matchingPerson.code ILIKE :searchText OR matchingPerson.group ILIKE :searchText OR matchingPerson.login ILIKE :searchText)',
            { searchText: `%${normalizedRequest.searchText}%` }
          );
        }
        const rows = await this.personsRepository
          .createQueryBuilder('person')
          .select(['person.id'])
          .where('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere(`person.group IN (${matchingGroups.getQuery()})`)
          .setParameters(matchingGroups.getParameters())
          .getMany();
        ids = rows.map(row => row.id);
        break;
      }
      case 'groups':
        kind = 'persons';
        if (normalizedRequest.groups.length > 0) {
          const rows = await this.personsRepository
            .createQueryBuilder('person')
            .select(['person.id'])
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere('person.group IN (:...groups)', {
              groups: normalizedRequest.groups
            })
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      case 'booklets':
        kind = 'booklets';
        if (normalizedRequest.bookletNames.length > 0) {
          const rows = await this.bookletRepository
            .createQueryBuilder('booklet')
            .select(['booklet.id'])
            .innerJoin('booklet.person', 'person')
            .innerJoin('booklet.bookletinfo', 'bookletinfo')
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere('UPPER(bookletinfo.name) IN (:...bookletNames)', {
              bookletNames: normalizedRequest.bookletNames.map(name => name.toUpperCase())
            })
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      case 'units':
        kind = 'units';
        if (normalizedRequest.unitNames.length > 0) {
          const unitNames = normalizedRequest.unitNames.map(
            normalizeUnitKey
          );
          const rows = await this.unitRepository
            .createQueryBuilder('unit')
            .select(['unit.id'])
            .innerJoin('unit.booklet', 'booklet')
            .innerJoin('booklet.person', 'person')
            .where('person.workspace_id = :workspaceId', { workspaceId })
            .andWhere('person.consider = :consider', { consider: true })
            .andWhere(
              `(REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') IN (:...unitNames)
                OR REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') IN (:...unitNames))`,
              { unitNames }
            )
            .getMany();
          ids = rows.map(row => row.id);
        }
        break;
      default:
        warnings.push('Unbekannter Löschbereich.');
    }

    ids = Array.from(new Set(ids));
    if (ids.length === 0) {
      warnings.push('Keine passenden Testergebnisdaten gefunden.');
    }

    const preview = await this.buildDeletePreview(
      workspaceId,
      normalizedRequest,
      kind,
      ids,
      warnings
    );

    return { kind, ids, preview };
  }

  private async buildDeletePreview(
    workspaceId: number,
    request: Required<TestResultsDeleteRequestDto>,
    kind: TestResultsDeleteTargetKind,
    ids: number[],
    warnings: string[]
  ): Promise<TestResultsDeletePreviewDto> {
    const counts = await this.getDeleteCounts(workspaceId, kind, ids);
    const metadata = await this.getDeleteMetadata(kind, ids);
    const unitIds = await this.collectAffectedUnitIds(kind, ids);
    const codingImpact =
      await this.codingFreshnessService?.getDeleteImpactForUnitIds(
        workspaceId,
        unitIds
      ) || {
        autoCodingV1: 0,
        manualCodingV2: 0,
        autoCodingV3: 0,
        affectedUnits: 0
      };

    return {
      scope: request.scope,
      label: getDeleteLabel(request),
      persons: counts.persons,
      booklets: counts.booklets,
      units: counts.units,
      responses: counts.responses,
      groups: metadata.groups,
      bookletNames: metadata.bookletNames,
      unitNames: metadata.unitNames,
      codingImpact,
      warnings
    };
  }

  private async getDeleteCounts(
    workspaceId: number,
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<Pick<TestResultsDeletePreviewDto, 'persons' | 'booklets' | 'units' | 'responses'>> {
    if (ids.length === 0) {
      return {
        persons: 0,
        booklets: 0,
        units: 0,
        responses: 0
      };
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    const personsQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT person.id)', 'count')
      .from(Persons, 'person');

    if (kind === 'booklets') {
      personsQuery.innerJoin(Booklet, 'booklet', 'booklet.personid = person.id');
    } else if (kind === 'units') {
      personsQuery
        .innerJoin(Booklet, 'booklet', 'booklet.personid = person.id')
        .innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id');
    }
    applyDeleteTargetFilter(personsQuery, kind, ids);

    const bookletsQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT bookletinfo.name)', 'count')
      .from(Booklet, 'booklet')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid');
    if (kind === 'units') {
      bookletsQuery.innerJoin(Unit, 'unit', 'unit.bookletid = booklet.id');
    }
    applyDeleteTargetFilter(bookletsQuery, kind, ids);
    applyIgnoredBookletsToQuery(bookletsQuery, exclusions.ignoredBooklets);

    const unitsQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT COALESCE(unit.alias, unit.name))', 'count')
      .from(Unit, 'unit')
      .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid');
    applyDeleteTargetFilter(unitsQuery, kind, ids);
    applyExclusionsToQuery(unitsQuery, exclusions);

    const responsesQuery = this.connection
      .createQueryBuilder()
      .select('COUNT(DISTINCT response.id)', 'count')
      .from(ResponseEntity, 'response')
      .innerJoin(Unit, 'unit', 'unit.id = response.unitid')
      .innerJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
      .innerJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
      .innerJoin(Persons, 'person', 'person.id = booklet.personid');
    applyDeleteTargetFilter(responsesQuery, kind, ids);
    applyExclusionsToQuery(responsesQuery, exclusions);
    excludeAutocoderGeneratedResponses(responsesQuery);

    const [personsRaw, bookletsRaw, unitsRaw, responsesRaw] = await Promise.all([
      personsQuery.getRawOne<{ count: string }>(),
      bookletsQuery.getRawOne<{ count: string }>(),
      unitsQuery.getRawOne<{ count: string }>(),
      responsesQuery.getRawOne<{ count: string }>()
    ]);

    return {
      persons: Number(personsRaw?.count || 0),
      booklets: Number(bookletsRaw?.count || 0),
      units: Number(unitsRaw?.count || 0),
      responses: Number(responsesRaw?.count || 0)
    };
  }

  private async getDeleteMetadata(
    kind: TestResultsDeleteTargetKind,
    ids: number[]
  ): Promise<Pick<TestResultsDeletePreviewDto, 'groups' | 'bookletNames' | 'unitNames'>> {
    if (ids.length === 0) {
      return {
        groups: [],
        bookletNames: [],
        unitNames: []
      };
    }

    const query = this.connection
      .createQueryBuilder()
      .select("COALESCE(array_remove(array_agg(DISTINCT person.group), NULL), '{}')", 'groups')
      .addSelect("COALESCE(array_remove(array_agg(DISTINCT bookletinfo.name), NULL), '{}')", 'bookletNames')
      .addSelect("COALESCE(array_remove(array_agg(DISTINCT COALESCE(unit.alias, unit.name)), NULL), '{}')", 'unitNames');

    if (kind === 'persons') {
      query
        .from(Persons, 'person')
        .leftJoin(Booklet, 'booklet', 'booklet.personid = person.id')
        .leftJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .leftJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('person.id IN (:...ids)', { ids });
    } else if (kind === 'booklets') {
      query
        .from(Booklet, 'booklet')
        .leftJoin(Persons, 'person', 'person.id = booklet.personid')
        .leftJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .leftJoin(Unit, 'unit', 'unit.bookletid = booklet.id')
        .where('booklet.id IN (:...ids)', { ids });
    } else {
      query
        .from(Unit, 'unit')
        .leftJoin(Booklet, 'booklet', 'booklet.id = unit.bookletid')
        .leftJoin(Persons, 'person', 'person.id = booklet.personid')
        .leftJoin(BookletInfo, 'bookletinfo', 'bookletinfo.id = booklet.infoid')
        .where('unit.id IN (:...ids)', { ids });
    }

    const raw = await query.getRawOne<{
      groups: string[] | string | null;
      bookletNames: string[] | string | null;
      unitNames: string[] | string | null;
    }>();

    return {
      groups: toPreviewList(raw?.groups),
      bookletNames: toPreviewList(raw?.bookletNames).slice(0, 30),
      unitNames: toPreviewList(raw?.unitNames).slice(0, 30)
    };
  }
}
