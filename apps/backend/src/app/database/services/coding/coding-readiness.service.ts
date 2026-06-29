import {
  BadRequestException, Injectable, Logger, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, In, Repository, SelectQueryBuilder
} from 'typeorm';
import { createHash } from 'crypto';
import * as cheerio from 'cheerio';
import { CodingScheme } from '@iqbspecs/coding-scheme';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { Unit } from '../../entities/unit.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  AutocodingInvalidVariableSampleDto,
  AutocodingReadinessDetailLevel,
  AutocodingReadinessBlocker,
  AutocodingReadinessDto,
  AutocodingReadinessStatus
} from '../../../../../../../api-dto/coding/autocoding-readiness.dto';
import {
  getCodingVariableIdCandidateSql,
  isCodingVariableIdCandidate
} from './coding-response-candidate.util';
import { CacheService } from '../../../cache/cache.service';

export type AutocodingReadinessOptions = {
  personIds?: string[];
  unitIds?: number[];
  autoCoderRun?: 1 | 2;
  forceRefresh?: boolean;
  detailLevel?: AutocodingReadinessDetailLevel;
};

type ReadinessCacheSignature = {
  sourceRevision: number;
  fileRevision: string;
  cacheRevision: number;
  activePersonHash: string;
  scopedUnitHash: string;
};

type ReadinessCacheEntry = {
  expiresAt: number;
  readiness: AutocodingReadinessDto;
};

type CandidateVariableCountRow = {
  unitid: string | number;
  variableid: string;
  response_count: string | number;
};

type SummaryReadinessCountRow = {
  raw_responses_total: string | number;
  raw_responses_with_relevant_status: string | number;
};

type CandidateVariableCount = {
  unitid: number;
  variableid: string;
  responseCount: number;
};

type UnitFileDiagnostics = {
  availableUnitFileIds: Set<string>;
  unitFileMap: Map<string, FileUpload>;
  missingUnitFiles: string[];
};

type CodingSchemeDiagnostics = {
  unitHasCodingScheme: Map<number, boolean>;
  usableCodingSchemeRefs: Set<string>;
  missingCodingSchemes: string[];
  invalidCodingSchemes: string[];
};

type VariableFilterDiagnostics = {
  validResponses: ResponseEntity[];
  validVariablePairs: number;
  invalidVariableSamples: AutocodingInvalidVariableSampleDto[];
};

type VariableCountDiagnostics = {
  validCandidateCounts: CandidateVariableCount[];
  validResponses: number;
  validVariablePairs: number;
  invalidVariableSamples: AutocodingInvalidVariableSampleDto[];
};

@Injectable()
export class CodingReadinessService {
  private readonly logger = new Logger(CodingReadinessService.name);
  private readonly maxSamplesPerUnit = 8;
  private readonly maxSampleUnits = 10;
  private readonly cacheTtlMs = 10 * 60_000;
  private readonly distributedCacheTtlSeconds = 60 * 60;
  private readonly readinessCache = new Map<string, ReadinessCacheEntry>();
  private readonly readinessInFlight = new Map<string, Promise<AutocodingReadinessDto>>();
  private readonly cacheRevisionByWorkspace = new Map<number, number>();

  constructor(
    @InjectRepository(ResponseEntity)
    private readonly responseRepository: Repository<ResponseEntity>,
    @InjectRepository(Unit)
    private readonly unitRepository: Repository<Unit>,
    @InjectRepository(FileUpload)
    private readonly fileUploadRepository: Repository<FileUpload>,
    private readonly workspaceFilesService: WorkspaceFilesService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @Optional()
    private readonly cacheService?: CacheService
  ) {}

  async getReadiness(
    workspaceId: number,
    options: AutocodingReadinessOptions = {}
  ): Promise<AutocodingReadinessDto> {
    const startedAt = Date.now();
    const autoCoderRun = options.autoCoderRun || 1;
    const detailLevel = options.detailLevel || 'full';
    const workspaceWide = this.isWorkspaceWideReadiness(options);
    const scopedUnits = workspaceWide ?
      null :
      await this.getScopedUnits(workspaceId, options);
    const unitIds = scopedUnits?.map(unit => unit.id) || [];

    const cacheSignature = await this.getCacheSignature(
      workspaceId,
      unitIds,
      options,
      workspaceWide
    );
    const cacheKey = this.buildCacheKey(
      workspaceId,
      autoCoderRun,
      detailLevel,
      cacheSignature
    );
    if (!options.forceRefresh) {
      const cached = this.getCachedReadiness(cacheKey);
      if (cached) {
        return cached;
      }
      const distributedCached = await this.getDistributedCachedReadiness(
        workspaceId,
        autoCoderRun,
        cacheKey
      );
      if (distributedCached) {
        this.setCachedReadiness(cacheKey, distributedCached);
        return {
          ...distributedCached,
          fromCache: true
        };
      }
    }

    const inFlight = this.readinessInFlight.get(cacheKey);
    if (inFlight) {
      return inFlight;
    }

    const readinessPromise = this.computeReadiness(
      workspaceId,
      autoCoderRun,
      detailLevel,
      options,
      scopedUnits,
      startedAt,
      cacheSignature,
      cacheKey
    );
    this.readinessInFlight.set(cacheKey, readinessPromise);
    try {
      return await readinessPromise;
    } finally {
      this.readinessInFlight.delete(cacheKey);
    }
  }

  async assertAutoCodingCanProcess(
    workspaceId: number,
    options: AutocodingReadinessOptions = {}
  ): Promise<void> {
    const readiness = await this.getReadiness(
      workspaceId,
      { ...options, forceRefresh: true }
    );
    if (readiness.readiness !== 'BLOCKED') {
      return;
    }

    throw new BadRequestException(this.buildBlockedMessage(readiness));
  }

  invalidateWorkspaceReadinessCache(workspaceId: number): void {
    const workspaceKeyPrefix = `${workspaceId}|`;
    for (const key of Array.from(this.readinessCache.keys())) {
      if (key.startsWith(workspaceKeyPrefix)) {
        this.readinessCache.delete(key);
      }
    }
    for (const key of Array.from(this.readinessInFlight.keys())) {
      if (key.startsWith(workspaceKeyPrefix)) {
        this.readinessInFlight.delete(key);
      }
    }
    this.cacheRevisionByWorkspace.set(
      workspaceId,
      this.getWorkspaceCacheRevision(workspaceId) + 1
    );
  }

  async filterResponsesValidVariables(
    workspaceId: number,
    responses: ResponseEntity[],
    units: Unit[]
  ): Promise<ResponseEntity[]> {
    return (await this.filterResponsesValidVariablesWithDiagnostics(
      workspaceId,
      responses,
      units
    )).validResponses;
  }

  async filterResponsesCodeable(
    workspaceId: number,
    responses: ResponseEntity[],
    units: Unit[]
  ): Promise<ResponseEntity[]> {
    const variableDiagnostics = await this.filterResponsesValidVariablesWithDiagnostics(
      workspaceId,
      responses,
      units
    );
    const unitsWithValidResponses = this.getUnitsWithResponses(
      units,
      variableDiagnostics.validResponses
    );
    const unitFileDiagnostics = await this.getUnitFileDiagnostics(
      workspaceId,
      this.uniqueUnitFileIds(unitsWithValidResponses)
    );
    const codingSchemeDiagnostics = await this.getCodingSchemeDiagnostics(
      workspaceId,
      unitsWithValidResponses,
      unitFileDiagnostics.unitFileMap
    );

    return variableDiagnostics.validResponses.filter(
      response => codingSchemeDiagnostics.unitHasCodingScheme.get(response.unitid) === true
    );
  }

  private async computeReadiness(
    workspaceId: number,
    autoCoderRun: 1 | 2,
    detailLevel: AutocodingReadinessDetailLevel,
    options: AutocodingReadinessOptions,
    scopedUnits: Unit[] | null,
    startedAt: number,
    cacheSignature: ReadinessCacheSignature,
    cacheKey: string
  ): Promise<AutocodingReadinessDto> {
    if (detailLevel === 'summary') {
      return this.computeSummaryReadiness(
        workspaceId,
        autoCoderRun,
        options,
        scopedUnits,
        startedAt,
        cacheSignature,
        cacheKey
      );
    }

    const units = scopedUnits ?? await this.getScopedUnits(workspaceId, options);
    if (units.length === 0) {
      const emptyReadiness = this.withComputationMetadata(
        this.emptyReadiness(
          workspaceId,
          autoCoderRun,
          'NO_RESULTS',
          detailLevel
        ),
        startedAt,
        false,
        cacheSignature
      );
      this.setCachedReadiness(cacheKey, emptyReadiness);
      return emptyReadiness;
    }

    const [rawResponsesTotal, candidateVariableCounts] = await Promise.all([
      this.countRawResponses(workspaceId, options, autoCoderRun),
      this.getCandidateVariableCounts(workspaceId, options, autoCoderRun)
    ]);
    const rawResponsesWithRelevantStatus = candidateVariableCounts
      .reduce((sum, item) => sum + item.responseCount, 0);
    const candidateUnits = this.getUnitsWithCandidateCounts(units, candidateVariableCounts);
    const candidateUnitFileIds = this.uniqueUnitFileIds(candidateUnits);
    const unitFileDiagnostics = await this.getUnitFileDiagnostics(
      workspaceId,
      candidateUnitFileIds
    );
    const variableDiagnostics = await this.filterCandidateVariableCountsWithDiagnostics(
      workspaceId,
      candidateVariableCounts,
      candidateUnits
    );
    const codingSchemeDiagnostics = await this.getCodingSchemeDiagnostics(
      workspaceId,
      candidateUnits,
      unitFileDiagnostics.unitFileMap
    );
    const codeableResponses = variableDiagnostics.validCandidateCounts
      .filter(item => codingSchemeDiagnostics.unitHasCodingScheme.get(item.unitid) === true)
      .reduce((sum, item) => sum + item.responseCount, 0);
    const blockers = this.getBlockers({
      rawResponsesTotal,
      rawResponsesWithRelevantStatus,
      missingUnitFiles: unitFileDiagnostics.missingUnitFiles,
      missingCodingSchemes: codingSchemeDiagnostics.missingCodingSchemes,
      invalidCodingSchemes: codingSchemeDiagnostics.invalidCodingSchemes,
      validResponses: variableDiagnostics.validResponses,
      codeableResponses
    });

    const readiness = this.withComputationMetadata({
      workspaceId,
      autoCoderRun,
      detailLevel: 'full',
      detailsComplete: true,
      readiness: this.getReadinessStatus(
        rawResponsesTotal,
        codeableResponses,
        blockers
      ),
      blockers,
      rawResponsesTotal,
      rawResponsesWithRelevantStatus,
      resultUnitsTotal: units.length,
      resultUnitKeysTotal: candidateUnitFileIds.length,
      matchedUnitFiles: unitFileDiagnostics.availableUnitFileIds.size,
      missingUnitFiles: unitFileDiagnostics.missingUnitFiles,
      matchedCodingSchemes: codingSchemeDiagnostics.usableCodingSchemeRefs.size,
      missingCodingSchemes: codingSchemeDiagnostics.missingCodingSchemes,
      invalidCodingSchemes: codingSchemeDiagnostics.invalidCodingSchemes,
      validVariablePairs: variableDiagnostics.validVariablePairs,
      validResponses: variableDiagnostics.validResponses,
      codeableResponses,
      invalidVariableSamples: variableDiagnostics.invalidVariableSamples
    }, startedAt, false, cacheSignature);

    this.setCachedReadiness(cacheKey, readiness);
    this.logger.debug(
      `Computed autocoding readiness for workspace ${workspaceId}, run ${autoCoderRun} ` +
      `in ${readiness.computationMs}ms: ${readiness.readiness}.`
    );
    return readiness;
  }

  private async computeSummaryReadiness(
    workspaceId: number,
    autoCoderRun: 1 | 2,
    options: AutocodingReadinessOptions,
    scopedUnits: Unit[] | null,
    startedAt: number,
    cacheSignature: ReadinessCacheSignature,
    cacheKey: string
  ): Promise<AutocodingReadinessDto> {
    const {
      rawResponsesTotal,
      rawResponsesWithRelevantStatus
    } = await this.countSummaryResponses(workspaceId, options, autoCoderRun);
    const potentialCodeableResponses = rawResponsesWithRelevantStatus;
    const blockers = this.getSummaryBlockers({
      rawResponsesTotal,
      rawResponsesWithRelevantStatus
    });
    const needsFullDiagnostics =
      rawResponsesTotal > 0 &&
      rawResponsesWithRelevantStatus > 0;

    const readiness = this.withComputationMetadata({
      workspaceId,
      autoCoderRun,
      detailLevel: 'summary',
      detailsComplete: !needsFullDiagnostics,
      readiness: needsFullDiagnostics ?
        'DIAGNOSTICS_PENDING' :
        this.getReadinessStatus(rawResponsesTotal, 0, blockers),
      blockers,
      rawResponsesTotal,
      rawResponsesWithRelevantStatus,
      resultUnitsTotal: scopedUnits?.length || 0,
      resultUnitKeysTotal: 0,
      matchedUnitFiles: 0,
      missingUnitFiles: [],
      matchedCodingSchemes: 0,
      missingCodingSchemes: [],
      invalidCodingSchemes: [],
      validVariablePairs: 0,
      validResponses: 0,
      potentialCodeableResponses,
      codeableResponses: 0,
      invalidVariableSamples: []
    }, startedAt, false, cacheSignature);

    this.setCachedReadiness(cacheKey, readiness);
    this.logger.debug(
      `Computed summary autocoding readiness for workspace ${workspaceId}, ` +
      `run ${autoCoderRun} in ${readiness.computationMs}ms: ${readiness.readiness}.`
    );
    return readiness;
  }

  private async getScopedUnits(
    workspaceId: number,
    options: AutocodingReadinessOptions
  ): Promise<Unit[]> {
    const query = this.unitRepository
      .createQueryBuilder('unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select(['unit.id', 'unit.name', 'unit.alias'])
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    const personIds = this.uniquePositiveIds((options.personIds || []).map(id => Number(id)));
    if (personIds.length > 0) {
      query.andWhere('person.id = ANY(:personIds)', { personIds });
    }

    const unitIds = this.uniquePositiveIds(options.unitIds || []);
    if (unitIds.length > 0) {
      query.andWhere('unit.id = ANY(:unitIds)', { unitIds });
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(query, exclusions);
    return query.getMany();
  }

  private async countRawResponses(
    workspaceId: number,
    options: AutocodingReadinessOptions,
    autoCoderRun: 1 | 2
  ): Promise<number> {
    const query = await this.createScopedResponseQuery(workspaceId, options);
    this.applyAutocoderGeneratedFilter(query, autoCoderRun);
    return query.getCount();
  }

  private async countSummaryResponses(
    workspaceId: number,
    options: AutocodingReadinessOptions,
    autoCoderRun: 1 | 2
  ): Promise<{
      rawResponsesTotal: number;
      rawResponsesWithRelevantStatus: number;
    }> {
    const query = await this.createScopedResponseQuery(workspaceId, options);
    this.applyAutocoderGeneratedFilter(query, autoCoderRun);
    const derivePending = statusStringToNumber('DERIVE_PENDING') as number;
    const candidateCondition =
      `((response.status IN (3, 2, 1) OR response.status_v1 = ${derivePending}) ` +
      `AND ${getCodingVariableIdCandidateSql('response')})`;
    const row = await query
      .select('COUNT(response.id)', 'raw_responses_total')
      .addSelect(
        `COUNT(response.id) FILTER (WHERE ${candidateCondition})`,
        'raw_responses_with_relevant_status'
      )
      .getRawOne<SummaryReadinessCountRow>();

    return {
      rawResponsesTotal: Number(row?.raw_responses_total || 0),
      rawResponsesWithRelevantStatus: Number(
        row?.raw_responses_with_relevant_status || 0
      )
    };
  }

  private async getCandidateVariableCounts(
    workspaceId: number,
    options: AutocodingReadinessOptions,
    autoCoderRun: 1 | 2
  ): Promise<CandidateVariableCount[]> {
    const query = await this.createScopedResponseQuery(workspaceId, options);
    query
      .select('response.unitid', 'unitid')
      .addSelect('response.variableid', 'variableid')
      .addSelect('COUNT(response.id)', 'response_count')
      .andWhere(
        new Brackets(qb => {
          qb.where('response.status IN (:...statuses)', {
            statuses: [3, 2, 1]
          }).orWhere('response.status_v1 = :derivePending', {
            derivePending: statusStringToNumber('DERIVE_PENDING') as number
          });
        })
      );
    this.applyCodingCandidateFilter(query, 'response');

    this.applyAutocoderGeneratedFilter(query, autoCoderRun);
    const rows = await query
      .groupBy('response.unitid')
      .addGroupBy('response.variableid')
      .getRawMany<CandidateVariableCountRow>();

    return rows
      .map(row => ({
        unitid: Number(row.unitid),
        variableid: row.variableid,
        responseCount: Number(row.response_count || 0)
      }))
      .filter(row => Number.isInteger(row.unitid) && row.responseCount > 0);
  }

  private applyCodingCandidateFilter(
    query: SelectQueryBuilder<ResponseEntity>,
    alias: string
  ): void {
    query.andWhere(getCodingVariableIdCandidateSql(alias));
  }

  private async createScopedResponseQuery(
    workspaceId: number,
    options: AutocodingReadinessOptions
  ): Promise<SelectQueryBuilder<ResponseEntity>> {
    const query = this.responseRepository
      .createQueryBuilder('response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });

    const personIds = this.uniquePositiveIds((options.personIds || []).map(id => Number(id)));
    if (personIds.length > 0) {
      query.andWhere('person.id = ANY(:personIds)', { personIds });
    }

    const unitIds = this.uniquePositiveIds(options.unitIds || []);
    if (unitIds.length > 0) {
      query.andWhere('unit.id = ANY(:unitIds)', { unitIds });
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(query, exclusions);
    return query;
  }

  private getUnitsWithCandidateCounts(
    units: Unit[],
    candidateCounts: CandidateVariableCount[]
  ): Unit[] {
    if (candidateCounts.length === 0) {
      return [];
    }

    const candidateUnitIds = new Set(candidateCounts.map(response => response.unitid));
    return units.filter(unit => candidateUnitIds.has(unit.id));
  }

  private applyAutocoderGeneratedFilter(
    query: SelectQueryBuilder<ResponseEntity>,
    autoCoderRun: 1 | 2
  ): void {
    if (autoCoderRun === 1) {
      query.andWhere(
        '(response.is_autocoder_generated = :isAutocoderGenerated OR response.is_autocoder_generated IS NULL)',
        { isAutocoderGenerated: false }
      );
      return;
    }

    query.andWhere(
      new Brackets(qb => {
        qb.where(
          '(response.is_autocoder_generated = :isAutocoderGenerated OR response.is_autocoder_generated IS NULL)',
          { isAutocoderGenerated: false }
        ).orWhere(
          `response.is_autocoder_generated = :generatedWithSourceCoding
            AND (
              response.status_v1 IS NOT NULL
              OR response.status_v2 IS NOT NULL
            )`,
          { generatedWithSourceCoding: true }
        );
      })
    );
  }

  private async getUnitFileDiagnostics(
    workspaceId: number,
    unitFileIds: string[]
  ): Promise<UnitFileDiagnostics> {
    if (unitFileIds.length === 0) {
      return {
        availableUnitFileIds: new Set(),
        unitFileMap: new Map(),
        missingUnitFiles: []
      };
    }

    const unitFiles = await this.fileUploadRepository.find({
      where: {
        workspace_id: workspaceId,
        file_id: In(unitFileIds)
      },
      select: ['file_id', 'data', 'filename']
    });
    const unitFileMap = new Map(unitFiles.map(file => [file.file_id, file]));
    const availableUnitFileIds = new Set(unitFiles.map(file => file.file_id));

    return {
      availableUnitFileIds,
      unitFileMap,
      missingUnitFiles: unitFileIds.filter(unitFileId => !availableUnitFileIds.has(unitFileId))
    };
  }

  private async getCodingSchemeDiagnostics(
    workspaceId: number,
    units: Unit[],
    unitFileMap: Map<string, FileUpload>
  ): Promise<CodingSchemeDiagnostics> {
    const unitToSchemeRef = new Map<number, string>();
    const schemeRefs = new Set<string>();

    units.forEach(unit => {
      const unitFileId = this.getUnitFileId(unit);
      if (!unitFileId) {
        return;
      }
      const unitFile = unitFileMap.get(unitFileId);
      if (!unitFile) {
        return;
      }

      const codingSchemeRef = this.extractCodingSchemeRef(unitFile.data);
      if (codingSchemeRef) {
        unitToSchemeRef.set(unit.id, codingSchemeRef);
        schemeRefs.add(codingSchemeRef);
      }
    });

    const codingSchemeFiles = schemeRefs.size === 0 ?
      [] :
      await this.fileUploadRepository.find({
        where: {
          workspace_id: workspaceId,
          file_id: In(Array.from(schemeRefs))
        },
        select: ['file_id', 'filename', 'data']
      });
    const availableCodingSchemeRefs = new Set(codingSchemeFiles.map(file => file.file_id));
    const usableCodingSchemeRefs = new Set<string>();
    const invalidCodingSchemes: string[] = [];
    codingSchemeFiles.forEach(file => {
      if (this.isUsableCodingScheme(file)) {
        usableCodingSchemeRefs.add(file.file_id);
        return;
      }

      invalidCodingSchemes.push(file.file_id);
    });
    const unitHasCodingScheme = new Map<number, boolean>();
    units.forEach(unit => {
      const schemeRef = unitToSchemeRef.get(unit.id);
      unitHasCodingScheme.set(unit.id, !!schemeRef && usableCodingSchemeRefs.has(schemeRef));
    });

    return {
      unitHasCodingScheme,
      usableCodingSchemeRefs,
      missingCodingSchemes: Array.from(schemeRefs)
        .filter(schemeRef => !availableCodingSchemeRefs.has(schemeRef)),
      invalidCodingSchemes: invalidCodingSchemes.sort((a, b) => a.localeCompare(b))
    };
  }

  private isUsableCodingScheme(file: FileUpload): boolean {
    try {
      const data = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
      const scheme = new CodingScheme(data);
      if (!Array.isArray(scheme.variableCodings) || scheme.variableCodings.length === 0) {
        this.logger.warn(
          `Coding scheme ${file.filename} contains no variable codings and is not usable for auto-coding.`
        );
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error parsing coding scheme ${file.filename} for readiness check: ${message}`
      );
      return false;
    }
  }

  private extractCodingSchemeRef(data: string): string {
    try {
      const $ = cheerio.load(data);
      return $('codingSchemeRef').text().trim().toUpperCase();
    } catch {
      return '';
    }
  }

  private async filterCandidateVariableCountsWithDiagnostics(
    workspaceId: number,
    candidateCounts: CandidateVariableCount[],
    units: Unit[]
  ): Promise<VariableCountDiagnostics> {
    const unitVariables = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    const validVariableSets = this.buildValidVariableSets(unitVariables);
    const unitIdToNameMap = this.buildUnitIdToNameMap(units);
    const validCandidateCounts: CandidateVariableCount[] = [];
    const invalidByUnit = new Map<string, {
      responseCount: number;
      sampleVariableIds: Set<string>;
      knownVariableIds: string[];
    }>();

    candidateCounts.forEach(item => {
      if (!isCodingVariableIdCandidate(item.variableid)) {
        return;
      }

      const unitName = unitIdToNameMap.get(item.unitid) || '';
      const validVars = validVariableSets.get(unitName.toUpperCase());
      if (validVars?.has(item.variableid)) {
        validCandidateCounts.push(item);
        return;
      }

      const bucket = invalidByUnit.get(unitName) || {
        responseCount: 0,
        sampleVariableIds: new Set<string>(),
        knownVariableIds: Array.from(validVars || []).slice(0, this.maxSamplesPerUnit)
      };
      bucket.responseCount += item.responseCount;
      if (bucket.sampleVariableIds.size < this.maxSamplesPerUnit) {
        bucket.sampleVariableIds.add(item.variableid);
      }
      invalidByUnit.set(unitName, bucket);
    });

    return {
      validCandidateCounts,
      validResponses: validCandidateCounts
        .reduce((sum, item) => sum + item.responseCount, 0),
      validVariablePairs: this.countValidVariablePairs(unitVariables),
      invalidVariableSamples: this.buildInvalidVariableSamples(invalidByUnit)
    };
  }

  private async filterResponsesValidVariablesWithDiagnostics(
    workspaceId: number,
    responses: ResponseEntity[],
    units: Unit[]
  ): Promise<VariableFilterDiagnostics> {
    const unitVariables = await this.workspaceFilesService.getUnitVariableMap(workspaceId);
    const validVariableSets = this.buildValidVariableSets(unitVariables);
    const unitIdToNameMap = this.buildUnitIdToNameMap(units);
    const validResponses: ResponseEntity[] = [];
    const invalidByUnit = new Map<string, {
      responseCount: number;
      sampleVariableIds: Set<string>;
      knownVariableIds: string[];
    }>();

    responses.forEach(response => {
      if (!isCodingVariableIdCandidate(response.variableid)) {
        return;
      }

      const unitName = unitIdToNameMap.get(response.unitid) || '';
      const validVars = validVariableSets.get(unitName.toUpperCase());
      if (validVars?.has(response.variableid)) {
        validResponses.push(response);
        return;
      }

      const bucket = invalidByUnit.get(unitName) || {
        responseCount: 0,
        sampleVariableIds: new Set<string>(),
        knownVariableIds: Array.from(validVars || []).slice(0, this.maxSamplesPerUnit)
      };
      bucket.responseCount += 1;
      if (bucket.sampleVariableIds.size < this.maxSamplesPerUnit) {
        bucket.sampleVariableIds.add(response.variableid);
      }
      invalidByUnit.set(unitName, bucket);
    });

    return {
      validResponses,
      validVariablePairs: this.countValidVariablePairs(unitVariables),
      invalidVariableSamples: this.buildInvalidVariableSamples(invalidByUnit)
    };
  }

  private buildValidVariableSets(
    unitVariables: Map<string, Set<string>>
  ): Map<string, Set<string>> {
    const validVariableSets = new Map<string, Set<string>>();
    unitVariables.forEach((vars: Set<string>, unitName: string) => {
      validVariableSets.set(unitName.toUpperCase(), vars);
    });
    return validVariableSets;
  }

  private buildUnitIdToNameMap(units: Unit[]): Map<number, string> {
    const unitIdToNameMap = new Map<number, string>();
    units.forEach(unit => {
      unitIdToNameMap.set(unit.id, unit.name);
    });
    return unitIdToNameMap;
  }

  private getUnitsWithResponses(
    units: Unit[],
    responses: ResponseEntity[]
  ): Unit[] {
    const responseUnitIds = new Set(responses.map(response => response.unitid));
    return units.filter(unit => responseUnitIds.has(unit.id));
  }

  private countValidVariablePairs(unitVariables: Map<string, Set<string>>): number {
    return Array.from(unitVariables.values())
      .reduce((sum, variables) => sum + variables.size, 0);
  }

  private buildInvalidVariableSamples(invalidByUnit: Map<string, {
    responseCount: number;
    sampleVariableIds: Set<string>;
    knownVariableIds: string[];
  }>): AutocodingInvalidVariableSampleDto[] {
    return Array.from(invalidByUnit.entries())
      .map(([unitName, item]) => ({
        unitName,
        responseCount: item.responseCount,
        sampleVariableIds: Array.from(item.sampleVariableIds),
        knownVariableIds: item.knownVariableIds
      }))
      .sort((a, b) => b.responseCount - a.responseCount)
      .slice(0, this.maxSampleUnits);
  }

  private getBlockers(input: {
    rawResponsesTotal: number;
    rawResponsesWithRelevantStatus: number;
    missingUnitFiles: string[];
    missingCodingSchemes: string[];
    invalidCodingSchemes: string[];
    validResponses: number;
    codeableResponses: number;
  }): AutocodingReadinessBlocker[] {
    if (input.rawResponsesTotal === 0) {
      return [];
    }

    const blockers: AutocodingReadinessBlocker[] = [];
    if (input.rawResponsesWithRelevantStatus === 0) {
      blockers.push('NO_RELEVANT_RESPONSES');
    }
    if (input.rawResponsesWithRelevantStatus > 0 && input.validResponses === 0) {
      blockers.push('NO_VALID_VARIABLE_MATCHES');
    }
    if (input.rawResponsesWithRelevantStatus > 0 && input.codeableResponses === 0) {
      if (input.missingUnitFiles.length > 0) {
        blockers.push('MISSING_UNIT_FILES');
      }
      if (input.missingCodingSchemes.length > 0) {
        blockers.push('MISSING_CODING_SCHEMES');
      }
      if (input.invalidCodingSchemes.length > 0) {
        blockers.push('INVALID_CODING_SCHEMES');
      }
      blockers.push('NO_CODEABLE_RESPONSES');
    }
    return blockers;
  }

  private getSummaryBlockers(input: {
    rawResponsesTotal: number;
    rawResponsesWithRelevantStatus: number;
  }): AutocodingReadinessBlocker[] {
    if (input.rawResponsesTotal === 0) {
      return [];
    }

    const blockers: AutocodingReadinessBlocker[] = [];
    if (input.rawResponsesWithRelevantStatus === 0) {
      blockers.push('NO_RELEVANT_RESPONSES');
    }
    return blockers;
  }

  private getReadinessStatus(
    rawResponsesTotal: number,
    codeableResponses: number,
    blockers: AutocodingReadinessBlocker[]
  ): AutocodingReadinessStatus {
    if (rawResponsesTotal === 0) {
      return 'NO_RESULTS';
    }

    if (blockers.length > 0 || codeableResponses === 0) {
      return 'BLOCKED';
    }

    return 'READY';
  }

  private buildBlockedMessage(readiness: AutocodingReadinessDto): string {
    const parts = [
      `Auto-Coding ${readiness.autoCoderRun} kann nicht gestartet werden:`,
      `${readiness.rawResponsesTotal} Rohantworten vorhanden,`,
      `davon ${readiness.rawResponsesWithRelevantStatus} mit relevantem Antwortstatus,`,
      `aber ${readiness.codeableResponses} kodierbare Antworten.`
    ];

    if (readiness.missingUnitFiles.length > 0) {
      parts.push(`${readiness.missingUnitFiles.length} Unit-Dateien fehlen.`);
    }
    if (readiness.missingCodingSchemes.length > 0) {
      parts.push(`${readiness.missingCodingSchemes.length} Kodierschemata fehlen.`);
    }
    if (readiness.invalidCodingSchemes.length > 0) {
      parts.push(`${readiness.invalidCodingSchemes.length} Kodierschemata sind nicht nutzbar.`);
    }
    if (readiness.invalidVariableSamples.length > 0) {
      const examples = readiness.invalidVariableSamples
        .slice(0, 3)
        .map(item => item.unitName)
        .join(', ');
      parts.push(`Beispiele betroffener Units: ${examples}.`);
    }

    return parts.join(' ');
  }

  private emptyReadiness(
    workspaceId: number,
    autoCoderRun: 1 | 2,
    readiness: AutocodingReadinessStatus,
    detailLevel: AutocodingReadinessDetailLevel = 'full'
  ): AutocodingReadinessDto {
    return {
      workspaceId,
      autoCoderRun,
      detailLevel,
      detailsComplete: true,
      readiness,
      blockers: [],
      rawResponsesTotal: 0,
      rawResponsesWithRelevantStatus: 0,
      resultUnitsTotal: 0,
      resultUnitKeysTotal: 0,
      matchedUnitFiles: 0,
      missingUnitFiles: [],
      matchedCodingSchemes: 0,
      missingCodingSchemes: [],
      invalidCodingSchemes: [],
      validVariablePairs: 0,
      validResponses: 0,
      codeableResponses: 0,
      invalidVariableSamples: []
    };
  }

  private uniqueUnitFileIds(units: Unit[]): string[] {
    return Array.from(new Set(
      units
        .map(unit => this.getUnitFileId(unit))
        .filter((unitFileId): unitFileId is string => !!unitFileId)
    )).sort((a, b) => a.localeCompare(b));
  }

  private getUnitFileId(unit: Unit): string | null {
    const candidate = unit.alias?.trim() || unit.name?.trim() || '';
    return candidate ? candidate.toUpperCase() : null;
  }

  private uniquePositiveIds(ids: number[]): number[] {
    return Array.from(new Set(
      ids
        .map(id => Number(id))
        .filter(id => Number.isInteger(id) && id > 0)
    ));
  }

  private async getCacheSignature(
    workspaceId: number,
    unitIds: number[],
    options: AutocodingReadinessOptions,
    workspaceWide: boolean
  ): Promise<ReadinessCacheSignature> {
    const [sourceRevision, fileRevision, activePersonHash] = await Promise.all([
      this.getWorkspaceResultsRevision(workspaceId),
      this.getWorkspaceFileRevision(workspaceId),
      workspaceWide ?
        this.getWorkspaceActivePersonHash(workspaceId) :
        Promise.resolve('scoped')
    ]);

    return {
      sourceRevision,
      fileRevision,
      cacheRevision: this.getWorkspaceCacheRevision(workspaceId),
      activePersonHash,
      scopedUnitHash: workspaceWide ?
        this.hashValues(['workspace-wide']) :
        this.hashScope(unitIds, options)
    };
  }

  private isWorkspaceWideReadiness(
    options: AutocodingReadinessOptions
  ): boolean {
    return (
      this.uniquePositiveIds((options.personIds || []).map(id => Number(id))).length === 0 &&
      this.uniquePositiveIds(options.unitIds || []).length === 0
    );
  }

  private getWorkspaceCacheRevision(workspaceId: number): number {
    return this.cacheRevisionByWorkspace.get(workspaceId) || 0;
  }

  private hashScope(
    unitIds: number[],
    options: AutocodingReadinessOptions
  ): string {
    const scopedUnitIds = unitIds.slice().sort((a, b) => a - b);
    const personIds = this.uniquePositiveIds((options.personIds || []).map(id => Number(id)))
      .sort((a, b) => a - b);
    const requestedUnitIds = this.uniquePositiveIds(options.unitIds || [])
      .sort((a, b) => a - b);

    return this.hashValues([
      `scopedUnits:${scopedUnitIds.join(',')}`,
      `persons:${personIds.join(',')}`,
      `requestedUnits:${requestedUnitIds.join(',')}`
    ]);
  }

  private async getWorkspaceResultsRevision(workspaceId: number): Promise<number> {
    try {
      const rows = await this.responseRepository.query(
        'SELECT revision FROM workspace_test_results_revision WHERE workspace_id = $1',
        [workspaceId]
      ) as Array<{ revision: number | string }>;
      return Number(rows[0]?.revision || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve test result revision for readiness cache: ${message}`
      );
      return 0;
    }
  }

  private async getWorkspaceFileRevision(workspaceId: number): Promise<string> {
    try {
      const raw = await this.fileUploadRepository
        .createQueryBuilder('file')
        .select('COUNT(file.id)', 'file_count')
        .addSelect('MAX(file.created_at)', 'max_created_at')
        .where('file.workspace_id = :workspaceId', { workspaceId })
        .getRawOne<{ file_count: number | string; max_created_at: string | Date | null }>();
      return `${Number(raw?.file_count || 0)}:${raw?.max_created_at || ''}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve test file revision for readiness cache: ${message}`
      );
      return '0:';
    }
  }

  private async getWorkspaceActivePersonHash(workspaceId: number): Promise<string> {
    try {
      const rows = await this.responseRepository.query(
        `
          SELECT
            COUNT(id)::text AS active_count,
            COALESCE(md5(string_agg(id::text, ',' ORDER BY id)), '') AS active_hash
          FROM persons
          WHERE workspace_id = $1
            AND consider = true
        `,
        [workspaceId]
      ) as Array<{ active_count: string; active_hash: string }>;
      const row = rows[0];
      return `${row?.active_count || '0'}:${row?.active_hash || ''}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not resolve active person signature for readiness cache: ${message}`
      );
      return '0:';
    }
  }

  private buildCacheKey(
    workspaceId: number,
    autoCoderRun: 1 | 2,
    detailLevel: AutocodingReadinessDetailLevel,
    signature: ReadinessCacheSignature
  ): string {
    return [
      workspaceId,
      autoCoderRun,
      detailLevel,
      signature.sourceRevision,
      signature.fileRevision,
      signature.cacheRevision,
      signature.activePersonHash,
      signature.scopedUnitHash
    ].join('|');
  }

  private getCachedReadiness(cacheKey: string): AutocodingReadinessDto | null {
    const entry = this.readinessCache.get(cacheKey);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt <= Date.now()) {
      this.readinessCache.delete(cacheKey);
      return null;
    }

    return {
      ...entry.readiness,
      fromCache: true
    };
  }

  private setCachedReadiness(
    cacheKey: string,
    readiness: AutocodingReadinessDto
  ): void {
    this.readinessCache.set(cacheKey, {
      expiresAt: Date.now() + this.cacheTtlMs,
      readiness
    });
    this.setDistributedCachedReadiness(cacheKey, readiness);
  }

  private getDistributedReadinessCacheKey(
    workspaceId: number,
    autoCoderRun: 1 | 2,
    cacheKey: string
  ): string {
    return `coding_readiness:${workspaceId}:run${autoCoderRun}:${this.hashValues([cacheKey])}`;
  }

  private async getDistributedCachedReadiness(
    workspaceId: number,
    autoCoderRun: 1 | 2,
    cacheKey: string
  ): Promise<AutocodingReadinessDto | null> {
    if (!this.cacheService) {
      return null;
    }
    return this.cacheService.get<AutocodingReadinessDto>(
      this.getDistributedReadinessCacheKey(workspaceId, autoCoderRun, cacheKey)
    );
  }

  private setDistributedCachedReadiness(
    cacheKey: string,
    readiness: AutocodingReadinessDto
  ): void {
    if (!this.cacheService) {
      return;
    }
    const distributedCacheKey = this.getDistributedReadinessCacheKey(
      readiness.workspaceId,
      readiness.autoCoderRun,
      cacheKey
    );
    this.cacheService.set(
      distributedCacheKey,
      readiness,
      this.distributedCacheTtlSeconds
    ).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Could not store autocoding readiness cache ${distributedCacheKey}: ${message}`
      );
    });
  }

  private withComputationMetadata(
    readiness: AutocodingReadinessDto,
    startedAt: number,
    fromCache: boolean,
    signature: ReadinessCacheSignature
  ): AutocodingReadinessDto {
    return {
      ...readiness,
      computedAt: new Date().toISOString(),
      computationMs: Date.now() - startedAt,
      fromCache,
      sourceRevision: signature.sourceRevision,
      fileRevision: signature.fileRevision
    };
  }

  private hashValues(values: Array<string | number>): string {
    return createHash('sha1')
      .update(values.join(','))
      .digest('hex');
  }
}
