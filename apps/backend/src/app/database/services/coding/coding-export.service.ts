import { Injectable, Logger, Optional } from '@nestjs/common';
import { Readable, PassThrough } from 'stream';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, Repository, SelectQueryBuilder, FindOperator
} from 'typeorm';
import * as ExcelJS from 'exceljs';
import { Request, Response } from 'express';
import { EXCLUDED_STATUSES } from '../../utils/response-status-converter';
import { generateReplayUrl, generateReplayUrlFromRequest } from '../../../utils/replay-url.util';
import {
  calculateModalValue,
  formatModalCandidates,
  getLatestCode,
  getModalTieLabel,
  buildCoderNameMapping,
  mapCodeForExport,
  type ModalValueResult
} from '../../../utils/coding-utils';
import { generateUniqueWorksheetName } from '../../../utils/excel-utils';
import { CodingListService, CodingItem } from './coding-list.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import {
  applyResolvedExclusionsToQuery,
  isExcludedByResolvedExclusions,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { MissingsProfilesService, ResolvedMissingValue } from './missings-profiles.service';
import {
  createManualCodingVariablePairKeySet,
  createManualCodingVariableReferences,
  ManualCodingVariableReference,
  toManualCodingVariablePairKey
} from '../../utils/manual-coding-candidate.util';
import { applyNonCodingIssueReviewJobFilter } from './coding-job-type.util';

interface ByVariableCombination {
  unitName: string;
  variableId: string;
  bookletName?: string;
}

export interface ByVariableExportEstimate {
  exportType: 'by-variable' | 'by-variable-compact';
  unitVariableCount: number;
  worksheetLimit: number | null;
  exceedsWorksheetLimit: boolean;
}

interface CompactByVariableRawRow {
  cjuId: string | number;
  unitName: string;
  variableId: string;
  login: string;
  personCode: string;
  personGroup: string | null;
  bookletName: string | null;
  cju_code: string | number | null;
  coding_issue_option: string | number | null;
  updatedAt: Date | string | null;
  code_v1: string | number | null;
  code_v2: string | number | null;
  code_v3: string | number | null;
  status_v1: string | number | null;
  username: string | null;
  notes: string | null;
  pId: string | number;
  trainingId: string | number | null;
  missingsProfileId: string | number | null;
  responseId: string | number | null;
}

interface CompactByVariableCoding {
  code: number | null;
  notes: string | null;
  codingIssueOption: number | null;
  updatedAt: Date | string | null;
}

interface TrainingDiscussionExportResult {
  code: number | null;
  score: number | null;
  notes: string | null;
  managerUsername: string | null;
  updatedAt: Date | null;
}

interface AggregatedMostFrequentCoding {
  code: number;
  codingIssueOption: number | null;
}

interface AggregatedMostFrequentVariableData {
  codings: AggregatedMostFrequentCoding[];
  comments: string[];
}

interface CompactByVariableGroup {
  key: string;
  unitName: string;
  variableId: string;
  login: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  codings: Map<string, CompactByVariableCoding>;
}

@Injectable()
export class CodingExportService {
  private readonly logger = new Logger(CodingExportService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJob)
    private codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobVariable)
    private codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private codingListService: CodingListService,
    private workspaceCoreService: WorkspaceCoreService,
    private workspaceExclusionService: WorkspaceExclusionService,
    @Optional()
    private missingsProfilesService?: MissingsProfilesService,
    @Optional()
    private replayAnchorService?: CodingReplayAnchorService
  ) { }

  private readonly manualMissingExportValueCache = new Map<string, ResolvedMissingValue>();

  private async getManualMissingExportValue(
    workspaceId: number,
    code: number | null | undefined,
    profileId?: number | null
  ): Promise<ResolvedMissingValue | null> {
    let missingId: 'mir' | 'mci' | null = null;
    if (code === -3) {
      missingId = 'mir';
    }
    if (code === -4) {
      missingId = 'mci';
    }
    if (!missingId || !this.missingsProfilesService) {
      return null;
    }

    const cacheKey = `${workspaceId}:${profileId ?? 'default'}:${missingId}`;
    const cached = this.manualMissingExportValueCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const missing = await this.missingsProfilesService.getMissingByIdForProfileOrDefault(
      workspaceId,
      profileId,
      missingId
    );
    this.manualMissingExportValueCache.set(cacheKey, missing);
    return missing;
  }

  private async mapCodeAndScoreForExport(
    workspaceId: number,
    code: number | null | undefined,
    score: number | null | undefined,
    profileId?: number | null
  ): Promise<{ code: number | null; score: number | null }> {
    const manualMissing = await this.getManualMissingExportValue(workspaceId, code, profileId);
    if (manualMissing) {
      return {
        code: manualMissing.code,
        score: manualMissing.score
      };
    }

    return {
      code: mapCodeForExport(code),
      score: score ?? null
    };
  }

  private async getExclusionChecker(workspaceId: number): Promise<(bookletName: string, unitName: string) => boolean> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    return (bookletName: string, unitName: string) => !unitName || isExcludedByResolvedExclusions(exclusions, bookletName, unitName);
  }

  private async getManualCodingVariableReferences(workspaceId: number): Promise<ManualCodingVariableReference[]> {
    const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
    const manualJobVariables = await this.codingJobUnitRepository
      .createQueryBuilder('coding_job_unit')
      .select('coding_job_unit.unit_name', 'unitName')
      .addSelect('coding_job_unit.variable_id', 'variableId')
      .innerJoin('coding_job_unit.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .distinct(true);
    applyNonCodingIssueReviewJobFilter(
      manualJobVariables,
      'coding_job',
      'manualCodingVariablesReviewJobType'
    );
    const manualJobVariableRows =
      await manualJobVariables.getRawMany<{
        unitName: string;
        variableId: string;
      }>();

    const manualCodingVariables = createManualCodingVariableReferences([
      ...codingListVariables,
      ...manualJobVariableRows
    ]);

    if (manualCodingVariables.length === 0) {
      throw new Error('No manual coding variables found for this workspace');
    }

    this.logger.log(`Found ${manualCodingVariables.length} manual unit-variable combinations for workspace ${workspaceId}`);
    return manualCodingVariables;
  }

  private async getManualCodingVariableSet(workspaceId: number): Promise<Set<string>> {
    const manualCodingVariables = await this.getManualCodingVariableReferences(workspaceId);
    return createManualCodingVariablePairKeySet(manualCodingVariables);
  }

  private getByVariableWorksheetLimit(): number {
    const configuredLimit = Number.parseInt(process.env.EXPORT_MAX_WORKSHEETS || '1000', 10);
    return Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1000;
  }

  private escapeCsvField(field: unknown): string {
    return `"${field?.toString().replace(/"/g, '""') || ''}"`;
  }

  private normalizeCodingIssueOption(issueOption: number | null | undefined): number | null {
    if (issueOption === null || issueOption === undefined || issueOption === 0) {
      return null;
    }
    const normalized = Math.abs(issueOption);
    return [1, 2, 3, 4].includes(normalized) ? normalized : null;
  }

  private getCodingIssueText(issueOption: number | null | undefined): string {
    const normalized = this.normalizeCodingIssueOption(issueOption);
    if (normalized === null) {
      return '';
    }
    const issueTexts: Record<number, string> = {
      1: 'Code-Vergabe unsicher',
      2: 'Neuer Code nötig',
      3: 'Ungültig (Spaßantwort)',
      4: 'Technische Probleme'
    };
    return issueTexts[normalized] || '';
  }

  private getCodingIssueSuffix(issueOption: number | null | undefined): string {
    const normalized = this.normalizeCodingIssueOption(issueOption);
    if (normalized === null) {
      return '';
    }
    const issueSuffixes: Record<number, string> = {
      1: 'unsicher',
      2: 'neuer Code nötig',
      3: 'ungültig',
      4: 'technische Probleme'
    };
    return issueSuffixes[normalized] || '';
  }

  private formatCodeWithIssueSuffix(code: number | null | undefined, issueOption: number | null | undefined): string {
    const mappedCode = mapCodeForExport(code);
    if (mappedCode === null) {
      return '';
    }
    const issueSuffix = this.getCodingIssueSuffix(issueOption);
    if (!issueSuffix) {
      return mappedCode.toString();
    }
    return `${mappedCode} (${issueSuffix})`;
  }

  private formatCodeWithIssueSuffixes(
    code: number | null | undefined,
    issueOptions: number[]
  ): string {
    const mappedCode = mapCodeForExport(code);
    if (mappedCode === null) {
      return '';
    }

    const issueSuffixes = issueOptions
      .map(issueOption => this.getCodingIssueSuffix(issueOption))
      .filter(Boolean);
    if (issueSuffixes.length === 0) {
      return mappedCode.toString();
    }

    return `${mappedCode} (${issueSuffixes.join('; ')})`;
  }

  private formatModalCandidatesWithIssueSuffixes(
    modal: ModalValueResult | null | undefined,
    codings: AggregatedMostFrequentCoding[]
  ): string {
    return formatModalCandidates(modal, code => this.formatCodeWithIssueSuffixes(
      code,
      this.getCodingIssueOptionsForModalCode(codings, code)
    ));
  }

  private getMostFrequentModalTieHeader(variable: string): string {
    return `${variable} Modalwert-Gleichstand`;
  }

  private getMostFrequentModalCandidatesHeader(variable: string): string {
    return `${variable} Modalwert-Kandidaten`;
  }

  private getCodingIssueOptionsForModalCode(
    codings: AggregatedMostFrequentCoding[],
    modalCode: number | null | undefined
  ): number[] {
    if (modalCode === null || modalCode === undefined) {
      return [];
    }

    const normalizedIssueOptions = new Set<number>();
    codings.forEach(coding => {
      if (coding.code !== modalCode) {
        return;
      }
      const normalizedIssueOption = this.normalizeCodingIssueOption(coding.codingIssueOption);
      if (normalizedIssueOption !== null) {
        normalizedIssueOptions.add(normalizedIssueOption);
      }
    });

    return Array.from(normalizedIssueOptions).sort((a, b) => a - b);
  }

  private variablePageMapsCache = new Map<string, Map<string, string>>();
  private variableAnchorMapsCache = new Map<string, Map<string, string>>();
  private currentWorkspaceId: number | null = null;

  private clearPageMapsCache(): void {
    this.variablePageMapsCache.clear();
    this.variableAnchorMapsCache.clear();
    this.currentWorkspaceId = null;
  }

  private async getVariablePage(unitName: string, variableId: string, workspaceId: number): Promise<string> {
    if (this.currentWorkspaceId !== workspaceId) {
      this.clearPageMapsCache();
      this.currentWorkspaceId = workspaceId;
    }

    if (!this.variablePageMapsCache.has(unitName)) {
      const pageMap = await this.codingListService.getVariablePageMap(unitName, workspaceId);
      this.variablePageMapsCache.set(unitName, pageMap);
    }

    return this.variablePageMapsCache.get(unitName)?.get(variableId) || '0';
  }

  private async getVariableAnchor(unitName: string, variableId: string, workspaceId: number): Promise<string> {
    if (!this.replayAnchorService) {
      return variableId;
    }

    if (this.currentWorkspaceId !== workspaceId) {
      this.clearPageMapsCache();
      this.currentWorkspaceId = workspaceId;
    }

    if (!this.variableAnchorMapsCache.has(unitName)) {
      const anchorMap = await this.replayAnchorService.getVariableAnchorMap(unitName, workspaceId);
      this.variableAnchorMapsCache.set(unitName, anchorMap);
    }

    return this.variableAnchorMapsCache.get(unitName)?.get(variableId) || variableId;
  }

  async exportCodingListAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    const csvStream = await this.codingListService.getCodingListCsvStream(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );

    // Excel compatibility: UTF-8 BOM
    res.write('\uFEFF');
    csvStream.pipe(res);
  }

  async exportCodingListAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    const excelData = await this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`
    );

    res.send(excelData);
  }

  async exportCodingListAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    res: Response
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-list-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`
    );
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    res.write('[');
    const stream = await this.codingListService.getCodingListJsonStream(
      workspaceId,
      authToken || '',
      serverUrl || ''
    );

    let first = true;
    stream.on('data', (item: CodingItem) => {
      if (!first) {
        res.write(',');
      } else {
        first = false;
      }
      res.write(JSON.stringify(item));

      if (global.gc) {
        global.gc();
      }
    });

    stream.on('end', () => {
      res.write(']');
      res.end();
    });

    stream.on('error', (error: Error) => {
      this.logger.error(`Error during JSON export: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      } else {
        res.end();
      }
    });
  }

  async exportCodingListForJobAsCsv(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean
  ): Promise<Readable> {
    return this.codingListService.getCodingListCsvStream(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired
    );
  }

  async exportCodingListForJobAsExcel(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean
  ): Promise<Buffer> {
    return this.codingListService.getCodingListAsExcel(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired
    );
  }

  async exportCodingListForJobAsJson(
    workspaceId: number,
    authToken: string,
    serverUrl: string,
    progressCallback?: (percentage: number) => Promise<void>,
    trainingRequired?: boolean
  ): Promise<Readable> {
    const stream = this.codingListService.getCodingListJsonStream(
      workspaceId,
      authToken || '',
      serverUrl || '',
      progressCallback,
      trainingRequired
    );

    const passThrough = new PassThrough();
    passThrough.write('[');
    let first = true;

    stream.on('data', (item: CodingItem) => {
      if (!first) {
        passThrough.write(',');
      } else {
        first = false;
      }
      passThrough.write(JSON.stringify(item));
    });

    stream.on('end', () => {
      passThrough.write(']');
      passThrough.end();
    });

    stream.on('error', err => {
      passThrough.emit('error', err);
    });

    return passThrough;
  }

  async exportCodingResultsByVersionAsCsv(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false
  ): Promise<Readable> {
    return this.codingListService.getCodingResultsByVersionCsvStream(
      workspaceId,
      version,
      authToken || '',
      serverUrl || '',
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues
    );
  }

  async exportCodingResultsByVersionAsExcel(
    workspaceId: number,
    version: 'v1' | 'v2' | 'v3',
    authToken: string,
    serverUrl: string,
    includeReplayUrls: boolean,
    progressCallback?: (percentage: number) => Promise<void>,
    includeResponseValues: boolean = true,
    includeGeoGebraResponseValues: boolean = false
  ): Promise<Buffer> {
    return this.codingListService.getCodingResultsByVersionAsExcel(
      workspaceId,
      version,
      authToken || '',
      serverUrl || '',
      includeReplayUrls,
      progressCallback,
      includeResponseValues,
      includeGeoGebraResponseValues
    );
  }

  private async generateReplayUrlWithPageLookup(
    req: Request | undefined,
    loginName: string,
    loginCode: string,
    group: string,
    bookletId: string,
    unitName: string,
    variableId: string,
    workspaceId: number,
    authToken: string,
    serverUrl?: string
  ): Promise<string> {
    const [variablePage, variableAnchor] = await Promise.all([
      this.getVariablePage(unitName, variableId, workspaceId),
      this.getVariableAnchor(unitName, variableId, workspaceId)
    ]);
    if (req) {
      return generateReplayUrlFromRequest(req, {
        loginName,
        loginCode,
        loginGroup: group,
        bookletId,
        unitId: unitName,
        variablePage,
        variableAnchor,
        authToken
      });
    }

    if (!serverUrl) {
      return '';
    }

    return generateReplayUrl({
      serverUrl,
      loginName,
      loginCode,
      loginGroup: group,
      bookletId,
      unitId: unitName,
      variablePage,
      variableAnchor,
      authToken
    });
  }

  private async getByVariableCombinations(
    workspaceId: number,
    excludeAutoCoded: boolean,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<ByVariableCombination[]> {
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const isExcluded = await this.getExclusionChecker(workspaceId);

    if (excludeAutoCoded && !hasScopedJobFilters) {
      const manualCodingVariables = await this.getManualCodingVariableReferences(workspaceId);
      return manualCodingVariables
        .filter(variable => !isExcluded('', variable.unitName))
        .sort((a, b) => {
          const unitCmp = a.unitName.localeCompare(b.unitName);
          if (unitCmp !== 0) return unitCmp;
          return a.variableId.localeCompare(b.variableId);
        });
    }

    if (excludeAutoCoded) {
      const jobUnitVariableResultsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .select('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('MIN(cju.booklet_name)', 'bookletName')
        .where('cj.workspace_id = :workspaceId', { workspaceId })
        .andWhere('cju.unit_name IS NOT NULL')
        .andWhere('cju.variable_id IS NOT NULL');
      applyResolvedExclusionsToQuery(jobUnitVariableResultsQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name'
      });
      this.applyJobFilters(
        jobUnitVariableResultsQuery as SelectQueryBuilder<unknown>,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds,
        'cju'
      );
      if (!coderTrainingIds?.length) {
        jobUnitVariableResultsQuery.andWhere('cj.training_id IS NULL');
      }

      const combinations = await jobUnitVariableResultsQuery
        .groupBy('cju.unit_name')
        .addGroupBy('cju.variable_id')
        .orderBy('cju.unit_name', 'ASC')
        .addOrderBy('cju.variable_id', 'ASC')
        .getRawMany<ByVariableCombination>();

      return combinations.filter(c => c.unitName && !isExcluded(c.bookletName || '', c.unitName));
    }

    const unitVariableResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .select('unit.name', 'unitName')
      .addSelect('resp.variableid', 'variableId')
      .addSelect('MIN(bookletinfo.name)', 'bookletName')
      .where('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true });
    applyResolvedExclusionsToQuery(unitVariableResultsQuery, exclusions, {
      unitAlias: 'unit',
      bookletInfoAlias: 'bookletinfo'
    });

    if (hasScopedJobFilters) {
      unitVariableResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.applyJobFilters(
        unitVariableResultsQuery as SelectQueryBuilder<unknown>,
        jobDefinitionIds,
        coderTrainingIds,
        coderIds,
        'cju'
      );
      if (!coderTrainingIds?.length) {
        unitVariableResultsQuery.andWhere('cj.training_id IS NULL');
      }
    }

    const combinations = await unitVariableResultsQuery
      .groupBy('unit.name')
      .addGroupBy('resp.variableid')
      .orderBy('unit.name', 'ASC')
      .addOrderBy('resp.variableid', 'ASC')
      .getRawMany<ByVariableCombination>();

    return combinations.filter(c => c.unitName && !isExcluded(c.bookletName || '', c.unitName));
  }

  async estimateCodingResultsByVariableExport(
    workspaceId: number,
    exportType: 'by-variable' | 'by-variable-compact' = 'by-variable',
    excludeAutoCoded = false,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<ByVariableExportEstimate> {
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const combinations = await this.getByVariableCombinations(
      workspaceId,
      excludeAutoCoded,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    const worksheetLimit = this.getByVariableWorksheetLimit();

    return {
      exportType,
      unitVariableCount: combinations.length,
      worksheetLimit: exportType === 'by-variable' ? worksheetLimit : null,
      exceedsWorksheetLimit: exportType === 'by-variable' && combinations.length > worksheetLimit
    };
  }

  async exportCodingResultsAggregated(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    doubleCodingMethod: 'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent' = 'most-frequent',
    includeComments = false,
    includeModalValue = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated coding results for workspace ${workspaceId} with method: ${doubleCodingMethod}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ' (including auto-coded)'}`);

    this.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );

    if (doubleCodingMethod === 'new-row-per-variable') {
      return this.exportAggregatedNewRowPerVariable(
        workspaceId,
        outputCommentsInsteadOfCodes,
        includeReplayUrl,
        anonymizeCoders,
        usePseudoCoders,
        includeComments,
        includeModalValue,
        authToken,
        req,
        excludeAutoCoded,
        checkCancellation,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        serverUrl
      );
    } if (doubleCodingMethod === 'new-column-per-coder') {
      return this.exportAggregatedNewColumnPerCoder(
        workspaceId,
        outputCommentsInsteadOfCodes,
        anonymizeCoders,
        usePseudoCoders,
        includeComments,
        includeModalValue,
        excludeAutoCoded,
        checkCancellation,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds
      );
    }

    this.logger.log(`Exporting aggregated results with most-frequent method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const isExcluded = await this.getExclusionChecker(workspaceId);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const hasScopedJobFilters = !!(
      normalizedJobDefinitionIds.length ||
      normalizedCoderTrainingIds.length ||
      normalizedCoderIds.length
    );

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.getManualCodingVariableSet(workspaceId);
    }

    // 1. Get all variables to define columns
    const variableRecordsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId });
    applyResolvedExclusionsToQuery(variableRecordsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.applyJobFilters(
      variableRecordsQuery,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds,
      'cju'
    );
    if (normalizedCoderTrainingIds.length === 0) {
      variableRecordsQuery.andWhere('cj.training_id IS NULL');
    }

    const variableRecords = await variableRecordsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const variableSet = new Set<string>();
    const variableUnitNames = new Map<string, string>();
    variableRecords.forEach(v => {
      if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
        const compositeKey = `${v.unitName}_${v.variableId}`;
        if (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(v.unitName, v.variableId))) {
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      }
    });

    if (!excludeAutoCoded && !hasScopedJobFilters) {
      const autoVariables = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.code_v1 IS NOT NULL');
      applyResolvedExclusionsToQuery(autoVariables, exclusions);
      const autoVariableRows = await autoVariables
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariableRows.forEach(v => {
        if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
          const compositeKey = `${v.unitName}_${v.variableId}`;
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      });
    }

    const variables = Array.from(variableSet).sort();

    // 2. Get all distinct test persons metadata
    const personResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .addSelect('MAX(bookletinfo.name)', 'bookletName')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (normalizedJobDefinitionIds.length || normalizedCoderTrainingIds.length || normalizedCoderIds.length) {
      personResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.applyJobFilters(
        personResultsQuery,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        personResultsQuery.andWhere('cj.training_id IS NULL');
      }
    }

    const personResults = await personResultsQuery
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter in diesem Workspace gefunden' :
          'Keine Kodierergebnisse für diesen Workspace gefunden'
      );
    }

    // 3. Setup Streaming Workbook
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
    if (includeReplayUrl) baseHeaders.push('Replay URL');
    const includeMostFrequentModalMetadata = includeModalValue && !outputCommentsInsteadOfCodes;
    const variableHeaders = variables.flatMap(variable => {
      if (!includeMostFrequentModalMetadata) {
        return [variable];
      }

      return [
        variable,
        this.getMostFrequentModalTieHeader(variable),
        this.getMostFrequentModalCandidatesHeader(variable)
      ];
    });
    const headers = [...baseHeaders, ...variableHeaders];

    worksheet.columns = headers.map(header => ({ header, key: header, width: header === 'Replay URL' ? 60 : 15 }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 4. Batch Process Test Persons
    const batchSize = 100;
    for (let i = 0; i < personResults.length; i += batchSize) {
      if (checkCancellation) await checkCancellation();
      const batch = personResults.slice(i, i + batchSize);
      const batchPersonIds = batch.map(p => p.id);

      // Fetch coding results for this batch
      const manualCodingQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cju.response', 'resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .leftJoin('cjc.user', 'user')
        .select('person.id', 'personId')
        .addSelect('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('cju.code', 'cju_code')
        .addSelect('cju.coding_issue_option', 'coding_issue_option')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.applyJobFilters(
        manualCodingQuery,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        manualCodingQuery.andWhere('cj.training_id IS NULL');
      }

      const manualCoding = await manualCodingQuery.getRawMany();
      if (normalizedCoderTrainingIds.length > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.getTrainingDiscussionResultsMap(
          workspaceId,
          normalizedCoderTrainingIds,
          responseIds
        );
        const managerRows: Record<string, unknown>[] = [];
        const handledCases = new Set<string>();

        for (const row of manualCoding) {
          const trainingId = parseInt(row.trainingId, 10);
          const responseId = parseInt(row.responseId, 10);
          if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

          const caseKey = `${trainingId}|${responseId}`;
          if (handledCases.has(caseKey)) continue;
          handledCases.add(caseKey);

          const discussionResult = discussionResultMap.get(caseKey);
          if (!discussionResult?.managerUsername) continue;

          managerRows.push({
            ...row,
            username: discussionResult.managerUsername,
            cju_code: discussionResult.code,
            cju_score: discussionResult.score,
            code_v1: null,
            code_v2: null,
            code_v3: null,
            score_v1: null,
            score_v2: null,
            score_v3: null,
            notes: discussionResult.notes
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v1', 'code_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere('cju.id IS NULL')
        .andWhere('resp.code_v1 IS NOT NULL')
        .getRawMany();

      // Group data by person and variable
      const personData = new Map<number, Map<string, AggregatedMostFrequentVariableData>>();

      for (const row of manualCoding) {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varData = personData.get(pid)!;
        if (!varData.has(compositeKey)) varData.set(compositeKey, { codings: [], comments: [] });
        const d = varData.get(compositeKey)!;
        const rawCode = row.cju_code ?? row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const mapped = await this.mapCodeAndScoreForExport(
          workspaceId,
          rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
          null,
          this.toIntegerOrNull(row.missingsProfileId)
        );
        const code = mapped.code;
        if (code !== null) {
          d.codings.push({
            code,
            codingIssueOption: row.coding_issue_option !== null && row.coding_issue_option !== undefined ?
              parseInt(row.coding_issue_option, 10) :
              null
          });
        }
        if (row.notes) {
          const coderName = row.username || `Job ${row.jobId}`;
          d.comments.push(`${coderName}: ${row.notes}`);
        }
      }

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varData = personData.get(pid)!;
        if (!varData.has(compositeKey)) varData.set(compositeKey, { codings: [], comments: [] });
        const d = varData.get(compositeKey)!;
        const code = mapCodeForExport(row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null);
        if (code !== null) {
          d.codings.push({ code, codingIssueOption: null });
        }
      });

      // Write rows
      for (const p of batch) {
        const pid = parseInt(p.id, 10);
        const row: Record<string, string | number | null> = {
          'Test Person Login': p.login,
          'Test Person Code': p.code,
          'Test Person Group': p.group || ''
        };

        const modalValues = new Map<string, number | null>();
        const varData = personData.get(pid);

        for (const vKey of variables) {
          const data = varData?.get(vKey);
          if (data && data.codings.length > 0) {
            const codes = data.codings.map(coding => coding.code);
            const modalResult = calculateModalValue(codes);
            const codingIssueOptions = this.getCodingIssueOptionsForModalCode(
              data.codings,
              modalResult.modalValue
            );
            modalValues.set(vKey, modalResult.modalValue);
            row[vKey] = outputCommentsInsteadOfCodes ?
              data.comments.join(' | ') :
              this.formatCodeWithIssueSuffixes(modalResult.modalValue, codingIssueOptions);
            if (includeMostFrequentModalMetadata) {
              row[this.getMostFrequentModalTieHeader(vKey)] = getModalTieLabel(modalResult);
              row[this.getMostFrequentModalCandidatesHeader(vKey)] =
                this.formatModalCandidatesWithIssueSuffixes(modalResult, data.codings);
            }
          } else {
            row[vKey] = '';
            if (includeMostFrequentModalMetadata) {
              row[this.getMostFrequentModalTieHeader(vKey)] = '';
              row[this.getMostFrequentModalCandidatesHeader(vKey)] = '';
            }
          }
        }

        if (includeReplayUrl && (req || serverUrl)) {
          let replayUrl = '';
          for (const vKey of variables) {
            if (modalValues.has(vKey)) {
              const variableId = vKey.split('_').slice(1).join('_');
              const unitName = variableUnitNames.get(vKey) || '';
              replayUrl = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
              break;
            }
          }
          row['Replay URL'] = replayUrl;
        }

        worksheet.addRow(row).commit();
      }

      // Garbage collection hint
      if (global.gc) global.gc();

      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return Buffer.concat(chunks);
  }

  private async exportAggregatedNewRowPerVariable(
    workspaceId: number,
    outputCommentsInsteadOfCodes: boolean,
    includeReplayUrl: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    includeComments: boolean,
    includeModalValue: boolean,
    authToken: string,
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-row-per-variable method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const MODAL_TIE_HEADER = 'Modalwert-Gleichstand';
    const MODAL_CANDIDATES_HEADER = 'Modalwert-Kandidaten';
    const COMMENTS_HEADER = 'Kommentare';
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    const isExcluded = await this.getExclusionChecker(workspaceId);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.getManualCodingVariableSet(workspaceId);
    }

    const variableRecordsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .where('cj.workspace_id = :workspaceId', { workspaceId });
    applyResolvedExclusionsToQuery(variableRecordsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.applyJobFilters(variableRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
    if (!coderTrainingIds?.length) {
      variableRecordsQuery.andWhere('cj.training_id IS NULL');
    }

    const variableRecords = await variableRecordsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .getRawMany();

    const variableSet = new Set<string>();
    const variableUnitNames = new Map<string, string>();
    variableRecords.forEach(v => {
      if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
        const compositeKey = `${v.unitName}_${v.variableId}`;
        if (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(v.unitName, v.variableId))) {
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      }
    });

    if (!excludeAutoCoded && !hasScopedJobFilters) {
      const autoVariables = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.code_v1 IS NOT NULL');
      applyResolvedExclusionsToQuery(autoVariables, exclusions);
      const autoVariableRows = await autoVariables
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariableRows.forEach(v => {
        if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
          const compositeKey = `${v.unitName}_${v.variableId}`;
          variableSet.add(compositeKey);
          variableUnitNames.set(compositeKey, v.unitName);
        }
      });
    }

    const sortedVariables = Array.from(variableSet).sort();

    const coderRecordsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(coderRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
    if (!coderTrainingIds?.length) {
      coderRecordsQuery.andWhere('cj.training_id IS NULL');
    }

    const coderRecords = await coderRecordsQuery
      .groupBy('user.username')
      .getRawMany();

    const allCoderNames = coderRecords.map(c => c.userName).sort();
    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      managerUsernames.forEach(managerUsername => {
        if (!allCoderNames.includes(managerUsername)) {
          allCoderNames.push(managerUsername);
        }
      });
      allCoderNames.sort();
    }
    const coderMapping = new Map<string, string>();
    if (anonymizeCoders) {
      allCoderNames.forEach((name, idx) => {
        coderMapping.set(name, usePseudoCoders ? `Coder ${idx + 1}` : `Coder_${idx + 1}`);
      });
    }

    // 3. Get all persons
    const personResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .addSelect('MAX(bookletinfo.name)', 'bookletName')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length) {
      personResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.applyJobFilters(personResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
      if (!coderTrainingIds?.length) {
        personResultsQuery.andWhere('cj.training_id IS NULL');
      }
    }

    const personResults = await personResultsQuery
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter nach Anwendung der Exportregeln gefunden' :
          'Keine Kodierergebnisse für diesen Workspace nach Anwendung der Exportregeln gefunden'
      );
    }

    // 4. Setup Streaming Workbook
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group', 'Unit', 'Variable'];
    if (includeReplayUrl) baseHeaders.push('Replay URL');

    const coderHeaderNames: string[] = [];
    allCoderNames.forEach(name => {
      const displayName = anonymizeCoders ? coderMapping.get(name)! : name;
      coderHeaderNames.push(`${displayName} Code`, `${displayName} Score`);
      if (includeComments) coderHeaderNames.push(`${displayName} Note`);
    });

    const headers = [...baseHeaders, ...coderHeaderNames];
    if (includeModalValue) {
      headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER, MODAL_TIE_HEADER, MODAL_CANDIDATES_HEADER);
    }
    if (includeComments) headers.push(COMMENTS_HEADER);

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // 5. Batch Process Test Persons
    const batchSize = 50;
    for (let i = 0; i < personResults.length; i += batchSize) {
      if (checkCancellation) await checkCancellation();
      const batch = personResults.slice(i, i + batchSize);
      const batchPersonIds = batch.map(p => p.id);

      const manualCodingQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cju.response', 'resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .leftJoin('cjc.user', 'user')
        .select('person.id', 'personId')
        .addSelect('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('cju.code', 'cju_code')
        .addSelect('cju.coding_issue_option', 'coding_issue_option')
        .addSelect('cju.score', 'cju_score')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.score_v3', 'score_v3')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.score_v2', 'score_v2')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.applyJobFilters(manualCodingQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
      if (!coderTrainingIds?.length) {
        manualCodingQuery.andWhere('cj.training_id IS NULL');
      }

      const manualCoding = await manualCodingQuery.getRawMany();
      if ((coderTrainingIds?.length || 0) > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.getTrainingDiscussionResultsMap(workspaceId, coderTrainingIds, responseIds);
        const managerRows: Record<string, unknown>[] = [];
        const handledCases = new Set<string>();

        for (const row of manualCoding) {
          const trainingId = parseInt(row.trainingId, 10);
          const responseId = parseInt(row.responseId, 10);
          if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

          const caseKey = `${trainingId}|${responseId}`;
          if (handledCases.has(caseKey)) continue;
          handledCases.add(caseKey);

          const discussionResult = discussionResultMap.get(caseKey);
          if (!discussionResult?.managerUsername) continue;

          managerRows.push({
            ...row,
            username: discussionResult.managerUsername,
            cju_code: discussionResult.code,
            cju_score: discussionResult.score,
            code_v1: null,
            code_v2: null,
            code_v3: null,
            score_v1: null,
            score_v2: null,
            score_v3: null,
            notes: discussionResult.notes
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.score_v1', 'score_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere('cju.id IS NULL')
        .andWhere('resp.code_v1 IS NOT NULL')
        .getRawMany();

      // Group data by person and variable
      const personData = new Map<number, Map<string, Map<string, {
        code: number | null,
        score: number | null,
        comment: string | null,
        codingIssueOption: number | null
      }>>>();

      for (const row of manualCoding) {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        const coderName = row.username || `Job ${row.jobId}`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varMap = personData.get(pid)!;
        if (!varMap.has(compositeKey)) varMap.set(compositeKey, new Map());
        const coderMap = varMap.get(compositeKey)!;

        const rawCode = row.cju_code ?? row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const rawScore = row.cju_score ?? row.score_v3 ?? row.score_v2 ?? row.score_v1;
        const mapped = await this.mapCodeAndScoreForExport(
          workspaceId,
          rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
          rawScore !== null && rawScore !== undefined ? parseInt(rawScore, 10) : null,
          this.toIntegerOrNull(row.missingsProfileId)
        );
        coderMap.set(coderName, {
          code: mapped.code,
          score: mapped.score,
          comment: row.notes,
          codingIssueOption: row.coding_issue_option !== null && row.coding_issue_option !== undefined ?
            parseInt(row.coding_issue_option, 10) :
            null
        });
      }

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const compositeKey = `${row.unitName}_${row.variableId}`;
        const coderName = 'AUTO';
        if (!personData.has(pid)) personData.set(pid, new Map());
        const varMap = personData.get(pid)!;
        if (!varMap.has(compositeKey)) varMap.set(compositeKey, new Map());
        const coderMap = varMap.get(compositeKey)!;
        coderMap.set(coderName, {
          code: mapCodeForExport(row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null),
          score: row.score_v1 !== null && row.score_v1 !== undefined ? parseInt(row.score_v1, 10) : null,
          comment: null,
          codingIssueOption: null
        });
      });

      for (const p of batch) {
        const pid = parseInt(p.id, 10);
        const varMap = personData.get(pid);

        for (const vKey of sortedVariables) {
          const coderDataMap = varMap?.get(vKey);
          if (!coderDataMap && excludeAutoCoded) continue;

          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || '',
            Unit: variableUnitNames.get(vKey) || '',
            Variable: vKey.split('_').slice(1).join('_')
          };

          const codes: number[] = [];
          const comments: string[] = [];

          allCoderNames.forEach(coderName => {
            const data = coderDataMap?.get(coderName);
            const displayName = anonymizeCoders ? coderMapping.get(coderName)! : coderName;
            row[`${displayName} Code`] = outputCommentsInsteadOfCodes ?
              (data?.comment ?? '') :
              this.formatCodeWithIssueSuffix(data?.code ?? null, data?.codingIssueOption ?? null);
            row[`${displayName} Score`] = outputCommentsInsteadOfCodes ? '' : (data?.score ?? '');
            if (includeComments) row[`${displayName} Note`] = data?.comment ?? '';
            if (data?.code !== null && data?.code !== undefined) codes.push(data.code);
            if (data?.comment) comments.push(`${displayName}: ${data.comment}`);
          });

          // Add AUTO if present
          if (coderDataMap?.has('AUTO')) {
            const data = coderDataMap.get('AUTO')!;
            if (data.code !== null && data.code !== undefined) codes.push(data.code);
          }

          if (includeModalValue && codes.length > 0) {
            const modalResult = calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = mapCodeForExport(modalResult.modalValue) ?? '';
            row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
            row[MODAL_TIE_HEADER] = getModalTieLabel(modalResult);
            row[MODAL_CANDIDATES_HEADER] = formatModalCandidates(modalResult, code => mapCodeForExport(code));
          } else if (includeModalValue) {
            row[MODAL_VALUE_HEADER] = '';
            row[DEVIATION_COUNT_HEADER] = '';
            row[MODAL_TIE_HEADER] = '';
            row[MODAL_CANDIDATES_HEADER] = '';
          }

          if (includeComments) {
            row[COMMENTS_HEADER] = comments.join(' | ');
          }

          if (includeReplayUrl && (req || serverUrl)) {
            const unitName = variableUnitNames.get(vKey) || '';
            const variableId = vKey.split('_').slice(1).join('_');
            row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
          }

          worksheet.addRow(row).commit();
        }
      }

      if (global.gc) global.gc();
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return Buffer.concat(chunks);
  }

  private async exportAggregatedNewColumnPerCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    includeComments: boolean,
    includeModalValue: boolean,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<Buffer> {
    this.logger.log(`Exporting aggregated results with new-column-per-coder method for workspace ${workspaceId}`);
    if (checkCancellation) await checkCancellation();

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const MODAL_TIE_HEADER = 'Modalwert-Gleichstand';
    const MODAL_CANDIDATES_HEADER = 'Modalwert-Kandidaten';
    const COMMENTS_HEADER = 'Kommentare';

    const isExcluded = await this.getExclusionChecker(workspaceId);
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const hasScopedJobFilters = !!(jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length);

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.getManualCodingVariableSet(workspaceId);
    }

    // 1. Get all coders to build mapping
    const coderRecordsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(coderRecordsQuery, jobDefinitionIds, coderTrainingIds, coderIds);
    if (!coderTrainingIds?.length) {
      coderRecordsQuery.andWhere('cj.training_id IS NULL');
    }

    const coderRecords = await coderRecordsQuery
      .groupBy('user.username')
      .getRawMany();
    const allCoderNamesList = coderRecords.map(c => c.userName).sort();
    if ((coderTrainingIds?.length || 0) > 0) {
      const managerUsernames = await this.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      managerUsernames.forEach(managerUsername => {
        if (!allCoderNamesList.includes(managerUsername)) {
          allCoderNamesList.push(managerUsername);
        }
      });
      allCoderNamesList.sort();
    }
    const coderMapping = new Map<string, string>();
    if (anonymizeCoders) {
      allCoderNamesList.forEach((name, idx) => {
        coderMapping.set(name, usePseudoCoders ? `Coder ${idx + 1}` : `Coder_${idx + 1}`);
      });
    }

    // 2. Get all variable-coder pairs for columns
    const variableCoderPairsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('user.username', 'userName')
      .where('cj.workspace_id = :workspaceId', { workspaceId });
    applyResolvedExclusionsToQuery(variableCoderPairsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.applyJobFilters(variableCoderPairsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
    if (!coderTrainingIds?.length) {
      variableCoderPairsQuery.andWhere('cj.training_id IS NULL');
    }

    const variableCoderPairs = await variableCoderPairsQuery
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id')
      .addGroupBy('user.username')
      .getRawMany();

    const colSet = new Set<string>();
    variableCoderPairs.forEach(v => {
      if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
        if (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(v.unitName, v.variableId))) {
          const cName = anonymizeCoders ? coderMapping.get(v.userName)! : v.userName;
          colSet.add(`${v.unitName}_${v.variableId}_${cName}`);
        }
      }
    });

    if ((coderTrainingIds?.length || 0) > 0) {
      const managerVariablePairs = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
        .select('unit.name', 'unitName')
        .addSelect('bookletinfo.name', 'bookletName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('ctdr.training_id', 'trainingId')
        .addSelect('ctdr.response_id', 'responseId')
        .where('ctdr.workspace_id = :workspaceId', { workspaceId })
        .andWhere('ctdr.training_id IN (:...coderTrainingIds)', { coderTrainingIds });
      applyResolvedExclusionsToQuery(managerVariablePairs, exclusions, {
        unitAlias: 'unit',
        bookletInfoAlias: 'bookletinfo'
      });
      const managerVariablePairRows = await managerVariablePairs
        .getRawMany();

      const managerDiscussionMap = await this.getTrainingDiscussionResultsMap(
        workspaceId,
        coderTrainingIds,
        Array.from(new Set(
          managerVariablePairRows
            .map(pair => parseInt(pair.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ))
      );

      managerVariablePairRows.forEach(pair => {
        if (!pair.unitName || isExcluded(pair.bookletName || '', pair.unitName)) return;
        if (manualCodingVariableSet && !manualCodingVariableSet.has(toManualCodingVariablePairKey(pair.unitName, pair.variableId))) return;

        const caseKey = `${parseInt(pair.trainingId, 10)}|${parseInt(pair.responseId, 10)}`;
        const discussion = managerDiscussionMap.get(caseKey);
        if (!discussion?.managerUsername) return;

        const displayCoderName = anonymizeCoders ?
          (coderMapping.get(discussion.managerUsername) || discussion.managerUsername) :
          discussion.managerUsername;
        colSet.add(`${pair.unitName}_${pair.variableId}_${displayCoderName}`);
      });
    }

    if (!excludeAutoCoded && !hasScopedJobFilters) {
      const autoVariables = await this.responseRepository.createQueryBuilder('response')
        .innerJoin('response.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('response.code_v1 IS NOT NULL');
      applyResolvedExclusionsToQuery(autoVariables, exclusions);
      const autoVariableRows = await autoVariables
        .groupBy('unit.name')
        .addGroupBy('response.variableid')
        .getRawMany();

      autoVariableRows.forEach(v => {
        if (v.unitName && !isExcluded(v.bookletName || '', v.unitName)) {
          colSet.add(`${v.unitName}_${v.variableId}_Autocoder`);
        }
      });
    }

    const sortedColumns = Array.from(colSet).sort();

    // 3. Get all persons
    const personResultsQuery = this.responseRepository.createQueryBuilder('resp')
      .innerJoin('resp.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.person', 'person')
      .select('person.id', 'id')
      .addSelect('MAX(person.login)', 'login')
      .addSelect('MAX(person.code)', 'code')
      .addSelect('MAX(person.group)', 'group')
      .where('person.workspace_id = :workspaceId', { workspaceId });

    if (jobDefinitionIds?.length || coderTrainingIds?.length || coderIds?.length) {
      personResultsQuery.innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .innerJoin('cju.coding_job', 'cj');
      this.applyJobFilters(personResultsQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
      if (!coderTrainingIds?.length) {
        personResultsQuery.andWhere('cj.training_id IS NULL');
      }
    }

    const personResults = await personResultsQuery
      .groupBy('person.id')
      .orderBy('MAX(person.login)', 'ASC')
      .addOrderBy('MAX(person.code)', 'ASC')
      .getRawMany();

    if (personResults.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter in diesem Workspace gefunden' :
          'Keine Kodierergebnisse für diesen Workspace gefunden'
      );
    }

    // 4. Setup Streaming Workbook
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const worksheet = workbook.addWorksheet('Coding Results');

    const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
    const headers = [...baseHeaders, ...sortedColumns];
    if (includeModalValue) {
      headers.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER, MODAL_TIE_HEADER, MODAL_CANDIDATES_HEADER);
    }
    if (includeComments) headers.push(COMMENTS_HEADER);

    worksheet.columns = headers.map(h => ({ header: h, key: h, width: 25 }));
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

    // 5. Batch Process Test Persons
    const batchSize = 100;
    for (let i = 0; i < personResults.length; i += batchSize) {
      if (checkCancellation) await checkCancellation();
      const batch = personResults.slice(i, i + batchSize);
      const batchPersonIds = batch.map(p => p.id);

      const manualCodingQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cju.response', 'resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .leftJoin('cjc.user', 'user')
        .select('person.id', 'personId')
        .addSelect('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('cju.code', 'cju_code')
        .addSelect('cju.coding_issue_option', 'coding_issue_option')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('cju.notes', 'notes')
        .addSelect('user.username', 'username')
        .addSelect('cj.id', 'jobId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.id IN (:...ids)', { ids: batchPersonIds });

      this.applyJobFilters(manualCodingQuery, jobDefinitionIds, coderTrainingIds, coderIds, 'cju');
      if (!coderTrainingIds?.length) {
        manualCodingQuery.andWhere('cj.training_id IS NULL');
      }

      const manualCoding = await manualCodingQuery.getRawMany();
      if ((coderTrainingIds?.length || 0) > 0 && manualCoding.length > 0) {
        const responseIds = Array.from(new Set(
          manualCoding
            .map(row => parseInt(row.responseId, 10))
            .filter(responseId => !Number.isNaN(responseId))
        ));

        const discussionResultMap = await this.getTrainingDiscussionResultsMap(workspaceId, coderTrainingIds, responseIds);
        const managerRows: Record<string, unknown>[] = [];
        const handledCases = new Set<string>();

        for (const row of manualCoding) {
          const trainingId = parseInt(row.trainingId, 10);
          const responseId = parseInt(row.responseId, 10);
          if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

          const caseKey = `${trainingId}|${responseId}`;
          if (handledCases.has(caseKey)) continue;
          handledCases.add(caseKey);

          const discussionResult = discussionResultMap.get(caseKey);
          if (!discussionResult?.managerUsername) continue;

          managerRows.push({
            ...row,
            username: discussionResult.managerUsername,
            cju_code: discussionResult.code,
            cju_score: discussionResult.score,
            code_v1: null,
            code_v2: null,
            code_v3: null,
            score_v1: null,
            score_v2: null,
            score_v3: null,
            notes: discussionResult.notes
          });
        }

        manualCoding.push(...managerRows);
      }

      const autoCoding = (excludeAutoCoded || hasScopedJobFilters) ? [] : await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'personId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('resp.code_v1', 'code_v1')
        .where('person.id IN (:...ids)', { ids: batchPersonIds })
        .andWhere('cju.id IS NULL')
        .andWhere('resp.code_v1 IS NOT NULL')
        .getRawMany();

      const personData = new Map<number, Map<string, {
        code: number | null,
        comment: string | null,
        codingIssueOption: number | null
      }>>();

      for (const row of manualCoding) {
        const pid = parseInt(row.personId, 10);
        const coderName = row.username || `Job ${row.jobId}`;
        const displayName = anonymizeCoders ? coderMapping.get(coderName)! : coderName;
        const columnKey = `${row.unitName}_${row.variableId}_${displayName}`;

        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;

        const rawCode = row.cju_code ?? row.code_v3 ?? row.code_v2 ?? row.code_v1;
        const mapped = await this.mapCodeAndScoreForExport(
          workspaceId,
          rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
          null,
          this.toIntegerOrNull(row.missingsProfileId)
        );
        dataMapForPerson.set(columnKey, {
          code: mapped.code,
          comment: row.notes,
          codingIssueOption: row.coding_issue_option !== null && row.coding_issue_option !== undefined ?
            parseInt(row.coding_issue_option, 10) :
            null
        });
      }

      autoCoding.forEach(row => {
        const pid = parseInt(row.personId, 10);
        const columnKey = `${row.unitName}_${row.variableId}_Autocoder`;
        if (!personData.has(pid)) personData.set(pid, new Map());
        const dataMapForPerson = personData.get(pid)!;
        dataMapForPerson.set(columnKey, {
          code: mapCodeForExport(row.code_v1 !== null && row.code_v1 !== undefined ? parseInt(row.code_v1, 10) : null),
          comment: null,
          codingIssueOption: null
        });
      });

      for (const p of batch) {
        const pid = parseInt(p.id, 10);
        const dataMapForPerson = personData.get(pid);
        const row: Record<string, unknown> = {
          'Test Person Login': p.login,
          'Test Person Code': p.code,
          'Test Person Group': p.group || ''
        };

        const codes: number[] = [];
        const comments: string[] = [];

        for (const col of sortedColumns) {
          const data = dataMapForPerson?.get(col);
          row[col] = outputCommentsInsteadOfCodes ?
            data?.comment || '' :
            this.formatCodeWithIssueSuffix(data?.code ?? null, data?.codingIssueOption ?? null);
          if (data?.code !== null && data?.code !== undefined) codes.push(data.code);
          if (data?.comment) {
            const coderName = col.split('_').pop();
            comments.push(`${coderName}: ${data.comment}`);
          }
        }

        if (includeModalValue && codes.length > 0) {
          const modalResult = calculateModalValue(codes);
          row[MODAL_VALUE_HEADER] = mapCodeForExport(modalResult.modalValue) ?? '';
          row[DEVIATION_COUNT_HEADER] = modalResult.deviationCount;
          row[MODAL_TIE_HEADER] = getModalTieLabel(modalResult);
          row[MODAL_CANDIDATES_HEADER] = formatModalCandidates(modalResult, code => mapCodeForExport(code));
        } else if (includeModalValue) {
          row[MODAL_VALUE_HEADER] = '';
          row[DEVIATION_COUNT_HEADER] = '';
          row[MODAL_TIE_HEADER] = '';
          row[MODAL_CANDIDATES_HEADER] = '';
        }

        if (includeComments) {
          row[COMMENTS_HEADER] = comments.join(' | ');
        }

        worksheet.addRow(row).commit();
      }

      if (global.gc) global.gc();
      await new Promise<void>(resolve => { setImmediate(resolve); });
    }

    await workbook.commit();
    return Buffer.concat(chunks);
  }

  async exportCodingResultsByCoder(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by coder for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    if (checkCancellation) await checkCancellation();

    const codingJobsQuery = this.codingJobRepository.createQueryBuilder('cj')
      .leftJoinAndSelect('cj.codingJobCoders', 'cjc')
      .leftJoinAndSelect('cjc.user', 'user')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(
      codingJobsQuery,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    if (normalizedCoderTrainingIds.length === 0) {
      codingJobsQuery.andWhere('cj.training_id IS NULL');
    }

    const codingJobs = await codingJobsQuery.getMany();

    if (codingJobs.length === 0) {
      throw new Error(this.getNoCodingResultsMessage(hasScopedJobFilters));
    }

    const coderJobsMap = new Map<string, CodingJob[]>();
    const allCoderNames = new Set<string>();
    const managerCoderKeySuffix = '|||manager';

    for (const job of codingJobs) {
      for (const jc of job.codingJobCoders) {
        if (normalizedCoderIds.length > 0 && !normalizedCoderIds.includes(jc.user.id)) {
          continue;
        }
        allCoderNames.add(jc.user.username);
        const coderKey = `${jc.user.username}_${jc.user.id}`;
        if (!coderJobsMap.has(coderKey)) {
          coderJobsMap.set(coderKey, []);
        }
        coderJobsMap.get(coderKey)!.push(job);
      }
    }

    if (normalizedCoderTrainingIds.length > 0) {
      const managerUsernames = await this.getTrainingManagerUsernames(workspaceId, normalizedCoderTrainingIds);
      const trainingJobs = codingJobs.filter(
        job => job.training_id && normalizedCoderTrainingIds.includes(job.training_id)
      );

      managerUsernames.forEach(managerUsername => {
        allCoderNames.add(managerUsername);
        const managerCoderKey = `${managerUsername}${managerCoderKeySuffix}`;
        if (!coderJobsMap.has(managerCoderKey)) {
          coderJobsMap.set(managerCoderKey, trainingJobs);
        }
      });
    }

    const coderNameMapping = anonymizeCoders ?
      buildCoderNameMapping(Array.from(allCoderNames), usePseudoCoders) :
      null;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const isExcluded = await this.getExclusionChecker(workspaceId);
    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.getManualCodingVariableSet(workspaceId);
    }

    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });

    for (const [coderKey, jobs] of coderJobsMap) {
      if (checkCancellation) await checkCancellation();
      const isManagerSheet = coderKey.endsWith(managerCoderKeySuffix);
      const coderName = isManagerSheet ?
        coderKey.slice(0, -managerCoderKeySuffix.length) :
        coderKey.replace(/_\d+$/, '');
      const displayName = anonymizeCoders && coderNameMapping ? coderNameMapping.get(coderName) || coderName : coderName;
      const worksheetName = generateUniqueWorksheetName(workbook, displayName);
      const worksheet = workbook.addWorksheet(worksheetName);

      const jobIds = jobs.map(j => j.id);
      const variablePairsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .select('cju.unit_name', 'unitName')
        .addSelect('cju.variable_id', 'variableId')
        .addSelect('cju.booklet_name', 'bookletName')
        .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
        .andWhere('cju.unit_name IS NOT NULL')
        .andWhere('cju.variable_id IS NOT NULL')
        .distinct(true);
      applyResolvedExclusionsToQuery(variablePairsQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name'
      });
      const visibleVariablePairs = (await variablePairsQuery.getRawMany())
        .filter(item => (
          (!manualCodingVariableSet || manualCodingVariableSet.has(toManualCodingVariablePairKey(item.unitName, item.variableId))) &&
          !isExcluded(item.bookletName || '', item.unitName)
        ));
      const uniqueVariablePairs = Array.from(
        new Map(visibleVariablePairs.map(item => [`${item.unitName}|${item.variableId}`, item])).values()
      );

      const variableColumns = uniqueVariablePairs
        .map(item => ({
          unitName: item.unitName,
          variableId: item.variableId,
          key: JSON.stringify([item.unitName, item.variableId]),
          header: `${item.unitName} | ${item.variableId}`
        }))
        .sort((a, b) => {
          const unitCmp = a.unitName.localeCompare(b.unitName);
          if (unitCmp !== 0) return unitCmp;
          return a.variableId.localeCompare(b.variableId);
        });

      if (variableColumns.length === 0) {
        await worksheet.commit();
        continue;
      }

      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) baseHeaders.push('Replay URL');
      const headers = [...baseHeaders, ...variableColumns.map(col => col.header)];

      worksheet.columns = headers.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      const personResults = await this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
        .select('person.id', 'id')
        .addSelect('MAX(person.login)', 'login')
        .addSelect('MAX(person.code)', 'code')
        .addSelect('MAX(person.group)', 'group')
        .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
        .groupBy('person.id')
        .orderBy('MAX(person.login)', 'ASC');
      applyResolvedExclusionsToQuery(personResults, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name'
      });
      const personResultsRows = await personResults.getRawMany();

      const batchSize = 100;
      for (let j = 0; j < personResultsRows.length; j += batchSize) {
        const batch = personResultsRows.slice(j, j + batchSize);
        const batchIds = batch.map(p => p.id);

        const personDataMap = new Map<number, Record<string, unknown>>();

        if (isManagerSheet) {
          const trainingIdsForJobs = Array.from(
            new Set(
              jobs
                .map(job => job.training_id)
                .filter((trainingId): trainingId is number => !!trainingId)
            )
          );

          if (trainingIdsForJobs.length > 0) {
            const managerCases = await this.responseRepository.createQueryBuilder('resp')
              .innerJoin('resp.unit', 'unit')
              .innerJoin('unit.booklet', 'booklet')
              .leftJoin('booklet.bookletinfo', 'bookletinfo')
              .innerJoin('booklet.person', 'person')
              .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
              .select('resp.variableid', 'variableId')
              .addSelect('unit.name', 'unitName')
              .addSelect('person.id', 'pId')
              .addSelect('bookletinfo.name', 'bookletName')
              .addSelect('ctdr.training_id', 'trainingId')
              .addSelect('ctdr.response_id', 'responseId')
              .where('person.id IN (:...ids)', { ids: batchIds })
              .andWhere('ctdr.workspace_id = :workspaceId', { workspaceId })
              .andWhere('ctdr.training_id IN (:...trainingIds)', { trainingIds: trainingIdsForJobs });
            applyResolvedExclusionsToQuery(managerCases, exclusions, {
              unitNameExpression: 'unit.name',
              bookletNameExpression: 'bookletinfo.name'
            });
            const managerCaseRows = await managerCases.getRawMany();

            const managerDiscussionMap = await this.getTrainingDiscussionResultsMap(
              workspaceId,
              trainingIdsForJobs,
              Array.from(new Set(
                managerCaseRows
                  .map(item => parseInt(item.responseId, 10))
                  .filter(responseId => !Number.isNaN(responseId))
              ))
            );

            for (const managerCase of managerCaseRows) {
              const trainingId = parseInt(managerCase.trainingId, 10);
              const responseId = parseInt(managerCase.responseId, 10);
              if (Number.isNaN(trainingId) || Number.isNaN(responseId)) continue;

              const discussion = managerDiscussionMap.get(`${trainingId}|${responseId}`);
              if (!discussion?.managerUsername || discussion.managerUsername !== coderName) continue;

              const pid = parseInt(managerCase.pId, 10);
              if (!personDataMap.has(pid)) {
                personDataMap.set(pid, {});
              }

              if (!managerCase.unitName || !managerCase.variableId) {
                continue;
              }

              if (manualCodingVariableSet && !manualCodingVariableSet.has(toManualCodingVariablePairKey(managerCase.unitName, managerCase.variableId))) {
                continue;
              }

              const pData = personDataMap.get(pid)!;
              const variableKey = JSON.stringify([managerCase.unitName, managerCase.variableId]);
              const mappedCode = mapCodeForExport(discussion.code);
              pData[variableKey] = outputCommentsInsteadOfCodes ? discussion.notes || '' : mappedCode ?? '';
              pData[`_metadata_${variableKey}`] = {
                unitName: managerCase.unitName,
                variableId: managerCase.variableId,
                bookletName: managerCase.bookletName
              };
            }
          }
        } else {
          const responses = await this.responseRepository.createQueryBuilder('resp')
            .innerJoin('resp.unit', 'unit')
            .innerJoin('unit.booklet', 'booklet')
            .leftJoin('booklet.bookletinfo', 'bookletinfo')
            .innerJoin('booklet.person', 'person')
            .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
            .innerJoin('cju.coding_job', 'cj')
            .select('resp.variableid', 'variableId')
            .addSelect('unit.name', 'unitName')
            .addSelect('cju.code', 'cju_code')
            .addSelect('resp.code_v1', 'code_v1')
            .addSelect('resp.code_v2', 'code_v2')
            .addSelect('resp.code_v3', 'code_v3')
            .addSelect('cju.notes', 'notes')
            .addSelect('person.id', 'pId')
            .addSelect('bookletinfo.name', 'bookletName')
            .addSelect('cj.missings_profile_id', 'missingsProfileId')
            .where('person.id IN (:...ids)', { ids: batchIds })
            .andWhere('cju.coding_job_id IN (:...jobIds)', { jobIds });
          applyResolvedExclusionsToQuery(responses, exclusions, {
            unitNameExpression: 'unit.name',
            bookletNameExpression: 'bookletinfo.name'
          });
          const responseRows = await responses.getRawMany();

          for (const resp of responseRows) {
            const pid = parseInt(resp.pId, 10);
            if (!personDataMap.has(pid)) {
              personDataMap.set(pid, {});
            }
            const pData = personDataMap.get(pid)!;
            const latest = getLatestCode(resp);
            const rawCode = resp.cju_code ?? latest.code;
            const mapped = await this.mapCodeAndScoreForExport(
              workspaceId,
              rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
              null,
              this.toIntegerOrNull(resp.missingsProfileId)
            );

            if (!resp.unitName || !resp.variableId) {
              continue;
            }

            if (manualCodingVariableSet && !manualCodingVariableSet.has(toManualCodingVariablePairKey(resp.unitName, resp.variableId))) {
              continue;
            }

            const variableKey = JSON.stringify([resp.unitName, resp.variableId]);
            pData[variableKey] = outputCommentsInsteadOfCodes ? resp.notes || '' : mapped.code ?? '';
            pData[`_metadata_${variableKey}`] = {
              unitName: resp.unitName,
              variableId: resp.variableId,
              bookletName: resp.bookletName
            };
          }
        }

        for (const p of batch) {
          const pid = parseInt(p.id, 10);
          const pData = personDataMap.get(pid) || {};
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };
          if (!variableColumns.some(variableColumn => pData[variableColumn.key] !== undefined)) {
            continue;
          }

          if (includeReplayUrl && (req || serverUrl)) {
            const firstVar = variableColumns.find(v => pData[`_metadata_${v.key}`]);
            if (firstVar) {
              const meta = pData[`_metadata_${firstVar.key}`] as { bookletName: string, unitName: string, variableId: string };
              row['Replay URL'] = await this.generateReplayUrlWithPageLookup(
                req,
                p.login,
                p.code,
                p.group || '',
                meta.bookletName || '',
                meta.unitName,
                meta.variableId,
                workspaceId,
                authToken,
                serverUrl
              );
            }
          }

          for (const variableColumn of variableColumns) {
            row[variableColumn.header] = pData[variableColumn.key] ?? '';
          }
          worksheet.addRow(row).commit();
        }
      }
      await worksheet.commit();
    }

    await workbook.commit();
    return Buffer.concat(chunks);
  }

  async exportCodingResultsByVariable(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (manual coding only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    this.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const MAX_WORKSHEETS = this.getByVariableWorksheetLimit();

    const BATCH_SIZE = 100;

    const MODAL_VALUE_HEADER = 'Häufigster Wert';
    const DEVIATION_COUNT_HEADER = 'Anzahl der Abweichungen';
    const MODAL_TIE_HEADER = 'Modalwert-Gleichstand';
    const MODAL_CANDIDATES_HEADER = 'Modalwert-Kandidaten';
    const DOUBLE_CODED_HEADER = 'Doppelkodierung';
    const COMMENTS_HEADER = 'Kommentare';
    const hasScopedJobFilters = !!(
      normalizedJobDefinitionIds.length ||
      normalizedCoderTrainingIds.length ||
      normalizedCoderIds.length
    );

    if (checkCancellation) await checkCancellation();

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const filteredCombinations = await this.getByVariableCombinations(
      workspaceId,
      excludeAutoCoded,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );

    if (filteredCombinations.length === 0) {
      throw new Error(
        hasScopedJobFilters ?
          'Keine Antworten für den gewählten Job-/Training-/Kodierer-Filter in diesem Export gefunden' :
          'Keine Antworten für den angeforderten Export gefunden'
      );
    }

    if (filteredCombinations.length > MAX_WORKSHEETS) {
      throw new Error(
        `Der Export enthaelt ${filteredCombinations.length} Unit-Variable-Kombinationen ` +
        `und ueberschreitet das konfigurierte Limit von ${MAX_WORKSHEETS} Tabellenblaettern. ` +
        'Bitte EXPORT_MAX_WORKSHEETS erhoehen, damit der Export vollstaendig erzeugt wird.'
      );
    }

    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', chunk => chunks.push(chunk));
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });

    for (const { unitName, variableId } of filteredCombinations) {
      if (checkCancellation) await checkCancellation();
      const worksheetName = generateUniqueWorksheetName(workbook, `${unitName}_${variableId}`);
      const worksheet = workbook.addWorksheet(worksheetName);

      // Get all coders for this variable
      const personIdsQuery = this.responseRepository.createQueryBuilder('resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.bookletinfo', 'bookletinfo')
        .innerJoin('booklet.person', 'person')
        .select('person.id', 'pId')
        .where('unit.name = :unitName', { unitName })
        .andWhere('resp.variableid = :variableId', { variableId })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .groupBy('person.id');
      applyResolvedExclusionsToQuery(personIdsQuery, exclusions, {
        unitAlias: 'unit',
        bookletInfoAlias: 'bookletinfo',
        parameterPrefix: 'variableExportPersons'
      });
      const personIdsRaw = await personIdsQuery.getRawMany();

      const pIds = personIdsRaw.map(r => r.pId);
      if (pIds.length === 0) {
        await worksheet.commit();
        continue;
      }

      // Find coders involved
      const coderQueryBuilder = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cj.codingJobCoders', 'cjc')
        .innerJoin('cjc.user', 'user')
        .select('user.username', 'username')
        .where('cju.unit_name = :unitName', { unitName })
        .andWhere('cju.variable_id = :variableId', { variableId })
        .andWhere('cj.workspace_id = :workspaceId', { workspaceId });

      this.applyJobFilters(
        coderQueryBuilder,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        coderQueryBuilder.andWhere('cj.training_id IS NULL');
      }

      const coderQuery = await coderQueryBuilder
        .groupBy('user.username')
        .getRawMany();

      const coderNames = coderQuery.map(c => c.username).sort();
      let discussionResultMap = new Map<string, TrainingDiscussionExportResult>();
      if (normalizedCoderTrainingIds.length > 0) {
        const managerCasesQuery = this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('booklet.person', 'person')
          .innerJoin('coder_training_discussion_result', 'ctdr', 'ctdr.response_id = resp.id')
          .select('ctdr.training_id', 'trainingId')
          .addSelect('ctdr.response_id', 'responseId')
          .where('person.id IN (:...pIds)', { pIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId })
          .andWhere('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere('ctdr.workspace_id = :workspaceId', { workspaceId })
          .andWhere('ctdr.training_id IN (:...coderTrainingIds)', { coderTrainingIds: normalizedCoderTrainingIds });
        applyResolvedExclusionsToQuery(managerCasesQuery, exclusions, {
          unitAlias: 'unit',
          bookletInfoAlias: 'bookletinfo',
          parameterPrefix: 'variableExportManagerCases'
        });
        const managerCases = await managerCasesQuery.getRawMany();

        discussionResultMap = await this.getTrainingDiscussionResultsMap(
          workspaceId,
          normalizedCoderTrainingIds,
          Array.from(new Set(
            managerCases
              .map(item => parseInt(item.responseId, 10))
              .filter(responseId => !Number.isNaN(responseId))
          ))
        );

        managerCases.forEach(item => {
          const caseKey = `${parseInt(item.trainingId, 10)}|${parseInt(item.responseId, 10)}`;
          const discussion = discussionResultMap.get(caseKey);
          if (discussion?.managerUsername && !coderNames.includes(discussion.managerUsername)) {
            coderNames.push(discussion.managerUsername);
          }
        });
        coderNames.sort();
      }
      const coderMapping = anonymizeCoders ? buildCoderNameMapping(coderNames, usePseudoCoders) : null;
      const displayCoders = coderNames.map(c => coderMapping?.get(c) || c);

      const baseHeaders = ['Test Person Login', 'Test Person Code', 'Test Person Group'];
      if (includeReplayUrl) baseHeaders.push('Replay URL');
      baseHeaders.push(...displayCoders);
      if (includeModalValue) {
        baseHeaders.push(MODAL_VALUE_HEADER, DEVIATION_COUNT_HEADER, MODAL_TIE_HEADER, MODAL_CANDIDATES_HEADER);
      }
      if (includeDoubleCoded) baseHeaders.push(DOUBLE_CODED_HEADER);
      if (includeComments) baseHeaders.push(...displayCoders.map(c => `${COMMENTS_HEADER} (${c})`));

      worksheet.columns = baseHeaders.map(h => ({ header: h, key: h, width: h === 'Replay URL' ? 60 : 15 }));
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };

      for (let i = 0; i < pIds.length; i += BATCH_SIZE) {
        const batchIds = pIds.slice(i, i + BATCH_SIZE);
        const dataQueryBuilder = this.responseRepository.createQueryBuilder('resp')
          .innerJoin('resp.unit', 'unit')
          .innerJoin('unit.booklet', 'booklet')
          .innerJoin('booklet.person', 'person')
          .leftJoin('booklet.bookletinfo', 'bookletinfo')
          .innerJoin('coding_job_unit', 'cju', 'cju.response_id = resp.id')
          .innerJoin('cju.coding_job', 'cj')
          .leftJoin('cj.codingJobCoders', 'cjc')
          .leftJoin('cjc.user', 'user')
          .select('person.login', 'login')
          .addSelect('person.code', 'code')
          .addSelect('person.group', 'group')
          .addSelect('bookletinfo.name', 'bookletName')
          .addSelect('cju.code', 'cju_code')
          .addSelect('cju.coding_issue_option', 'coding_issue_option')
          .addSelect('resp.code_v1', 'code_v1')
          .addSelect('resp.code_v2', 'code_v2')
          .addSelect('resp.code_v3', 'code_v3')
          .addSelect('resp.status_v1', 'status_v1')
          .addSelect('user.username', 'username')
          .addSelect('cju.notes', 'notes')
          .addSelect('person.id', 'pId')
          .addSelect('cj.training_id', 'trainingId')
          .addSelect('cj.missings_profile_id', 'missingsProfileId')
          .addSelect('cju.response_id', 'responseId')
          .where('person.id IN (:...batchIds)', { batchIds })
          .andWhere('unit.name = :unitName', { unitName })
          .andWhere('resp.variableid = :variableId', { variableId })
          .andWhere('person.workspace_id = :workspaceId', { workspaceId })
          .andWhere('person.consider = :consider', { consider: true })
          .andWhere('cj.workspace_id = :workspaceId', { workspaceId });
        applyResolvedExclusionsToQuery(dataQueryBuilder, exclusions, {
          unitAlias: 'unit',
          bookletInfoAlias: 'bookletinfo'
        });

        this.applyJobFilters(
          dataQueryBuilder,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds,
          'cju'
        );
        if (normalizedCoderTrainingIds.length === 0) {
          dataQueryBuilder.andWhere('cj.training_id IS NULL');
        }

        const dataQuery = await dataQueryBuilder.getRawMany();

        const personGroup = new Map<number, {
          login: string,
          code: string,
          group: string,
          bookletName: string,
          codings: Record<string, { code: number | null, notes: string | null, status: number | null, codingIssueOption: number | null }>,
          metadata: Record<string, unknown>
        }>();
        for (const d of dataQuery) {
          const pid = parseInt(d.pId, 10);
          if (!personGroup.has(pid)) {
            personGroup.set(pid, {
              login: d.login, code: d.code, group: d.group, bookletName: d.bookletName, codings: {}, metadata: d
            });
          }
          const p = personGroup.get(pid)!;
          if (d.username) {
            const latest = getLatestCode(d);
            const rawCode = d.cju_code ?? latest.code;
            const mapped = await this.mapCodeAndScoreForExport(
              workspaceId,
              rawCode !== null && rawCode !== undefined ? parseInt(rawCode, 10) : null,
              null,
              this.toIntegerOrNull(d.missingsProfileId)
            );
            p.codings[d.username] = {
              code: mapped.code,
              notes: d.notes,
              status: d.status_v1,
              codingIssueOption: d.coding_issue_option !== null && d.coding_issue_option !== undefined ?
                parseInt(d.coding_issue_option, 10) :
                null
            };
          }

          if (normalizedCoderTrainingIds.length > 0) {
            const trainingId = parseInt(d.trainingId, 10);
            const responseId = parseInt(d.responseId, 10);
            if (!Number.isNaN(trainingId) && !Number.isNaN(responseId)) {
              const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
              if (discussion?.managerUsername && !p.codings[discussion.managerUsername]) {
                p.codings[discussion.managerUsername] = {
                  code: mapCodeForExport(discussion.code),
                  notes: discussion.notes,
                  status: d.status_v1,
                  codingIssueOption: null
                };
              }
            }
          }
        }

        for (const [, p] of personGroup) {
          const row: Record<string, unknown> = {
            'Test Person Login': p.login,
            'Test Person Code': p.code,
            'Test Person Group': p.group || ''
          };

          if (includeReplayUrl && (req || serverUrl)) {
            row['Replay URL'] = await this.generateReplayUrlWithPageLookup(req, p.login, p.code, p.group || '', p.bookletName || '', unitName, variableId, workspaceId, authToken, serverUrl);
          }

          const codes: (number | null)[] = [];
          for (const cName of coderNames) {
            const cData = p.codings[cName];
            const dName = coderMapping?.get(cName) || cName;
            row[dName] = outputCommentsInsteadOfCodes ?
              cData?.notes || '' :
              this.formatCodeWithIssueSuffix(cData?.code ?? null, cData?.codingIssueOption ?? null);
            if (cData?.code !== null && cData?.code !== undefined) {
              codes.push(cData.code);
            }
          }

          if (includeModalValue && codes.length > 0) {
            const modal = calculateModalValue(codes);
            row[MODAL_VALUE_HEADER] = modal.modalValue ?? '';
            row[DEVIATION_COUNT_HEADER] = modal.deviationCount;
            row[MODAL_TIE_HEADER] = getModalTieLabel(modal);
            row[MODAL_CANDIDATES_HEADER] = formatModalCandidates(modal);
          } else if (includeModalValue) {
            row[MODAL_VALUE_HEADER] = '';
            row[DEVIATION_COUNT_HEADER] = '';
            row[MODAL_TIE_HEADER] = '';
            row[MODAL_CANDIDATES_HEADER] = '';
          }

          if (includeDoubleCoded) {
            row[DOUBLE_CODED_HEADER] = codes.length > 1 ? 'Ja' : 'Nein';
          }

          if (includeComments) {
            for (const cName of coderNames) {
              const cData = p.codings[cName];
              const dName = coderMapping?.get(cName) || cName;
              row[`${COMMENTS_HEADER} (${dName})`] = cData?.notes || '';
            }
          }

          worksheet.addRow(row).commit();
        }
      }
      await worksheet.commit();
    }

    await workbook.commit();
    return Buffer.concat(chunks);
  }

  exportCodingResultsByVariableCompactAsCsvStream(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Readable {
    return Readable.from(this.generateCodingResultsByVariableCompactCsv(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      serverUrl
    ));
  }

  async exportCodingResultsByVariableCompact(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    const stream = this.exportCodingResultsByVariableCompactAsCsvStream(
      workspaceId,
      includeModalValue,
      includeDoubleCoded,
      includeComments,
      outputCommentsInsteadOfCodes,
      includeReplayUrl,
      anonymizeCoders,
      usePseudoCoders,
      authToken,
      req,
      excludeAutoCoded,
      checkCancellation,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds,
      serverUrl
    );

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf-8'));
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private async* generateCodingResultsByVariableCompactCsv(
    workspaceId: number,
    includeModalValue = false,
    includeDoubleCoded = false,
    includeComments = false,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): AsyncGenerator<string> {
    this.logger.log(`Exporting compact coding results by variable for workspace ${workspaceId}${excludeAutoCoded ? ' (manual coding only)' : ''}${includeModalValue ? ' with modal value' : ''}${includeDoubleCoded ? ' with double coding indicator' : ''}${includeComments ? ' with comments' : ''}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}`);

    this.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    const BATCH_SIZE = 1000;

    if (checkCancellation) await checkCancellation();

    const manualCodingVariableSet = excludeAutoCoded ?
      await this.getManualCodingVariableSet(workspaceId) :
      null;
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const globalCoderMapping = await this.getCompactByVariableCoderMapping(
      workspaceId,
      anonymizeCoders,
      usePseudoCoders,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );

    yield this.buildCompactByVariableHeader(
      includeComments,
      includeModalValue,
      includeDoubleCoded,
      includeReplayUrl
    );

    let exportedRowCount = 0;
    let currentGroup: CompactByVariableGroup | null = null;
    let offset = 0;

    while (true) {
      if (checkCancellation) await checkCancellation();

      const dataQueryBuilder = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .innerJoin('cju.response', 'resp')
        .innerJoin('resp.unit', 'unit')
        .innerJoin('unit.booklet', 'booklet')
        .innerJoin('booklet.person', 'person')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('cj.codingJobCoders', 'cjc')
        .leftJoin('cjc.user', 'user')
        .select('cju.id', 'cjuId')
        .addSelect('unit.name', 'unitName')
        .addSelect('resp.variableid', 'variableId')
        .addSelect('person.login', 'login')
        .addSelect('person.code', 'personCode')
        .addSelect('person.group', 'personGroup')
        .addSelect('bookletinfo.name', 'bookletName')
        .addSelect('cju.code', 'cju_code')
        .addSelect('cju.coding_issue_option', 'coding_issue_option')
        .addSelect('cju.updated_at', 'updatedAt')
        .addSelect('resp.code_v1', 'code_v1')
        .addSelect('resp.code_v2', 'code_v2')
        .addSelect('resp.code_v3', 'code_v3')
        .addSelect('resp.status_v1', 'status_v1')
        .addSelect('user.username', 'username')
        .addSelect('cju.notes', 'notes')
        .addSelect('person.id', 'pId')
        .addSelect('cj.training_id', 'trainingId')
        .addSelect('cj.missings_profile_id', 'missingsProfileId')
        .addSelect('cju.response_id', 'responseId')
        .where('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        .andWhere('cj.workspace_id = :workspaceId', { workspaceId });

      applyResolvedExclusionsToQuery(dataQueryBuilder, exclusions, {
        unitAlias: 'unit',
        bookletInfoAlias: 'bookletinfo',
        parameterPrefix: 'variableCompactRows'
      });

      this.applyJobFilters(
        dataQueryBuilder,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        dataQueryBuilder.andWhere('cj.training_id IS NULL');
      }
      this.applySelectedCoderJoinFilter(dataQueryBuilder, normalizedCoderIds);

      const rows = await dataQueryBuilder
        .orderBy('unit.name', 'ASC')
        .addOrderBy('resp.variableid', 'ASC')
        .addOrderBy('person.id', 'ASC')
        .addOrderBy('user.username', 'ASC')
        .addOrderBy('cju.updated_at', 'ASC')
        .addOrderBy('cju.id', 'ASC')
        .offset(offset)
        .limit(BATCH_SIZE)
        .getRawMany<CompactByVariableRawRow>();

      if (rows.length === 0) {
        break;
      }

      const discussionResultMap = normalizedCoderTrainingIds.length > 0 ?
        await this.getTrainingDiscussionResultsMap(
          workspaceId,
          normalizedCoderTrainingIds,
          Array.from(new Set(
            rows
              .map(row => this.toIntegerOrNull(row.responseId))
              .filter((responseId): responseId is number => responseId !== null)
          ))
        ) :
        new Map<string, TrainingDiscussionExportResult>();

      for (const row of rows) {
        if (
          manualCodingVariableSet &&
          !manualCodingVariableSet.has(toManualCodingVariablePairKey(row.unitName, row.variableId))
        ) {
          continue;
        }
        const groupKey = this.getCompactByVariableGroupKey(row);
        if (currentGroup && currentGroup.key !== groupKey) {
          const renderedGroup = await this.renderCompactByVariableGroup(
            currentGroup,
            includeModalValue,
            includeDoubleCoded,
            includeComments,
            outputCommentsInsteadOfCodes,
            includeReplayUrl,
            anonymizeCoders,
            usePseudoCoders,
            globalCoderMapping,
            authToken,
            req,
            serverUrl,
            workspaceId
          );
          exportedRowCount += renderedGroup.rowCount;
          if (renderedGroup.csv) yield renderedGroup.csv;
          currentGroup = null;
        }

        if (!currentGroup) {
          currentGroup = this.createCompactByVariableGroup(row, groupKey);
        }

        await this.addCompactCodingToGroup(currentGroup, row, workspaceId);
        this.addCompactDiscussionToGroup(currentGroup, row, discussionResultMap);
      }

      offset += rows.length;
    }

    if (currentGroup) {
      const renderedGroup = await this.renderCompactByVariableGroup(
        currentGroup,
        includeModalValue,
        includeDoubleCoded,
        includeComments,
        outputCommentsInsteadOfCodes,
        includeReplayUrl,
        anonymizeCoders,
        usePseudoCoders,
        globalCoderMapping,
        authToken,
        req,
        serverUrl,
        workspaceId
      );
      exportedRowCount += renderedGroup.rowCount;
      if (renderedGroup.csv) yield renderedGroup.csv;
    }

    if (exportedRowCount === 0) {
      throw new Error(this.getNoCodingResultsMessage(hasScopedJobFilters));
    }

    this.logger.log(`Exported compact by-variable results for workspace ${workspaceId}`);
  }

  private buildCompactByVariableHeader(
    includeComments: boolean,
    includeModalValue: boolean,
    includeDoubleCoded: boolean,
    includeReplayUrl: boolean
  ): string {
    const headerColumns = [
      'Unit',
      'Variable',
      'Test Person Login',
      'Test Person Code',
      'Test Person Group',
      'Kodierer',
      'Code',
      'Kodierzeitpunkt',
      'Code-Hinweis'
    ];
    if (includeComments) headerColumns.splice(7, 0, 'Kommentar');
    if (includeModalValue) {
      headerColumns.push(
        'Häufigster Wert',
        'Anzahl der Abweichungen',
        'Modalwert-Gleichstand',
        'Modalwert-Kandidaten'
      );
    }
    if (includeDoubleCoded) headerColumns.push('Doppelkodierung');
    if (includeReplayUrl) headerColumns.push('Replay URL');
    return `${headerColumns.map(h => this.escapeCsvField(h)).join(';')}\n`;
  }

  private async getCompactByVariableCoderMapping(
    workspaceId: number,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    jobDefinitionIds: number[],
    coderTrainingIds: number[],
    coderIds: number[]
  ): Promise<Map<string, string> | null> {
    if (!anonymizeCoders || usePseudoCoders) {
      return null;
    }

    const coderQueryBuilder = this.codingJobRepository.createQueryBuilder('cj')
      .innerJoin('cj.codingJobCoders', 'cjc')
      .innerJoin('cjc.user', 'user')
      .select('user.username', 'username')
      .where('cj.workspace_id = :workspaceId', { workspaceId });

    this.applyJobFilters(
      coderQueryBuilder,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    if (coderTrainingIds.length === 0) {
      coderQueryBuilder.andWhere('cj.training_id IS NULL');
    }
    this.applySelectedCoderJoinFilter(coderQueryBuilder, coderIds);

    const coderRows = await coderQueryBuilder
      .groupBy('user.username')
      .getRawMany<{ username: string }>();
    const coderNames = new Set(coderRows.map(row => row.username).filter(Boolean));

    if (coderTrainingIds.length > 0) {
      const managerNames = await this.getTrainingManagerUsernames(workspaceId, coderTrainingIds);
      managerNames.forEach(managerName => coderNames.add(managerName));
    }

    return buildCoderNameMapping(Array.from(coderNames).sort(), false);
  }

  private getCompactByVariableGroupKey(row: CompactByVariableRawRow): string {
    return [
      row.unitName || '',
      row.variableId || '',
      row.pId?.toString() || ''
    ].join('\u001F');
  }

  private createCompactByVariableGroup(
    row: CompactByVariableRawRow,
    key: string
  ): CompactByVariableGroup {
    return {
      key,
      unitName: row.unitName || '',
      variableId: row.variableId || '',
      login: row.login || '',
      personCode: row.personCode || '',
      personGroup: row.personGroup || '',
      bookletName: row.bookletName || '',
      codings: new Map()
    };
  }

  private async addCompactCodingToGroup(
    group: CompactByVariableGroup,
    row: CompactByVariableRawRow,
    workspaceId: number
  ): Promise<void> {
    if (!row.username) return;

    const latest = getLatestCode(row as unknown as ResponseEntity);
    const rawCode = row.cju_code ?? latest.code;
    const parsedCode = this.toIntegerOrNull(rawCode);
    const mapped = await this.mapCodeAndScoreForExport(
      workspaceId,
      parsedCode,
      null,
      this.toIntegerOrNull(row.missingsProfileId)
    );
    const coding = {
      code: mapped.code,
      notes: row.notes || null,
      codingIssueOption: this.toIntegerOrNull(row.coding_issue_option),
      updatedAt: row.updatedAt || null
    };
    const existingCoding = group.codings.get(row.username);
    if (!existingCoding || this.isLaterCoding(coding.updatedAt, existingCoding.updatedAt)) {
      group.codings.set(row.username, coding);
    }
  }

  private addCompactDiscussionToGroup(
    group: CompactByVariableGroup,
    row: CompactByVariableRawRow,
    discussionResultMap: Map<string, TrainingDiscussionExportResult>
  ): void {
    const trainingId = this.toIntegerOrNull(row.trainingId);
    const responseId = this.toIntegerOrNull(row.responseId);
    if (trainingId === null || responseId === null) return;

    const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
    if (!discussion?.managerUsername || group.codings.has(discussion.managerUsername)) return;

    group.codings.set(discussion.managerUsername, {
      code: mapCodeForExport(discussion.code),
      notes: discussion.notes,
      codingIssueOption: null,
      updatedAt: discussion.updatedAt
    });
  }

  private async renderCompactByVariableGroup(
    group: CompactByVariableGroup,
    includeModalValue: boolean,
    includeDoubleCoded: boolean,
    includeComments: boolean,
    outputCommentsInsteadOfCodes: boolean,
    includeReplayUrl: boolean,
    anonymizeCoders: boolean,
    usePseudoCoders: boolean,
    globalCoderMapping: Map<string, string> | null,
    authToken: string,
    req: Request | undefined,
    serverUrl: string | undefined,
    workspaceId: number
  ): Promise<{ csv: string; rowCount: number }> {
    const codingEntries = Array.from(group.codings.entries())
      .sort(([a], [b]) => a.localeCompare(b));
    if (codingEntries.length === 0) {
      return { csv: '', rowCount: 0 };
    }

    const codes = codingEntries
      .map(([, coding]) => coding.code)
      .filter((code): code is number => code !== null && code !== undefined);
    const modal = includeModalValue ? calculateModalValue(codes) : null;
    const pseudoCoderMapping = anonymizeCoders && usePseudoCoders ?
      buildCoderNameMapping(codingEntries.map(([coderName]) => coderName), true) :
      null;
    const replayUrl = includeReplayUrl && (req || serverUrl) ?
      await this.generateReplayUrlWithPageLookup(
        req,
        group.login,
        group.personCode,
        group.personGroup,
        group.bookletName,
        group.unitName,
        group.variableId,
        workspaceId,
        authToken,
        serverUrl
      ) :
      '';
    let csv = '';

    codingEntries.forEach(([coderName, coding]) => {
      const displayCoderName = pseudoCoderMapping?.get(coderName) ||
        globalCoderMapping?.get(coderName) ||
        coderName;
      const codeValue = outputCommentsInsteadOfCodes ?
        coding.notes || '' :
        this.formatCodeWithIssueSuffix(coding.code, coding.codingIssueOption);
      const timestamp = coding.updatedAt ?
        new Date(coding.updatedAt).toLocaleString('de-DE').replace(',', '') :
        '';
      const rowFields = [
        this.escapeCsvField(group.unitName),
        this.escapeCsvField(group.variableId),
        this.escapeCsvField(group.login),
        this.escapeCsvField(group.personCode),
        this.escapeCsvField(group.personGroup),
        this.escapeCsvField(displayCoderName),
        this.escapeCsvField(codeValue)
      ];
      if (includeComments) rowFields.push(this.escapeCsvField(coding.notes || ''));
      rowFields.push(
        this.escapeCsvField(timestamp),
        this.escapeCsvField(this.getCodingIssueText(coding.codingIssueOption))
      );
      if (includeModalValue) {
        rowFields.push(
          this.escapeCsvField(modal?.modalValue ?? ''),
          this.escapeCsvField(modal?.deviationCount ?? ''),
          this.escapeCsvField(getModalTieLabel(modal)),
          this.escapeCsvField(formatModalCandidates(modal))
        );
      }
      if (includeDoubleCoded) rowFields.push(this.escapeCsvField(codes.length > 1 ? 'Ja' : 'Nein'));
      if (includeReplayUrl) rowFields.push(this.escapeCsvField(replayUrl));
      csv += `${rowFields.join(';')}\n`;
    });

    return { csv, rowCount: codingEntries.length };
  }

  private toIntegerOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private isLaterCoding(
    candidate: Date | string | null,
    existing: Date | string | null
  ): boolean {
    if (!candidate) return false;
    if (!existing) return true;
    return new Date(candidate).getTime() >= new Date(existing).getTime();
  }

  async exportCodingResultsDetailed(
    workspaceId: number,
    outputCommentsInsteadOfCodes = false,
    includeReplayUrl = false,
    anonymizeCoders = false,
    usePseudoCoders = false,
    authToken = '',
    req?: Request,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    serverUrl?: string
  ): Promise<Buffer> {
    this.logger.log(`Exporting detailed coding results for workspace ${workspaceId}${outputCommentsInsteadOfCodes ? ' with comments instead of codes' : ''}${includeReplayUrl ? ' with replay URLs' : ''}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);

    this.clearPageMapsCache();
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );
    if (checkCancellation) await checkCancellation();

    try {
      let manualCodingVariableSet: Set<string> | null = null;
      if (excludeAutoCoded) {
        manualCodingVariableSet = await this.getManualCodingVariableSet(workspaceId);
      }

      const isExcluded = await this.getExclusionChecker(workspaceId);

      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders && !usePseudoCoders) {
        const codersQuery = this.codingJobRepository.createQueryBuilder('cj')
          .innerJoin('cj.codingJobCoders', 'cjc')
          .innerJoin('cjc.user', 'user')
          .select('user.username', 'username')
          .where('cj.workspace_id = :workspaceId', { workspaceId });

        this.applyJobFilters(
          codersQuery,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds
        );

        const coders = await codersQuery
          .groupBy('user.username')
          .getRawMany();
        coderNameMapping = buildCoderNameMapping(coders.map(c => c.username), false);
      }

      const totalCountQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
        .innerJoin('cju.coding_job', 'cj')
        .leftJoin('cju.response', 'countResp')
        .where('cj.workspace_id = :workspaceId', { workspaceId });
      totalCountQuery.andWhere(
        '(countResp.status_v1 IS NULL OR countResp.status_v1 NOT IN (:...excludedStatuses))',
        { excludedStatuses: EXCLUDED_STATUSES }
      );

      this.applyJobFilters(
        totalCountQuery,
        normalizedJobDefinitionIds,
        normalizedCoderTrainingIds,
        normalizedCoderIds,
        'cju'
      );
      if (normalizedCoderTrainingIds.length === 0) {
        totalCountQuery.andWhere('cj.training_id IS NULL');
      }
      const totalCount = await totalCountQuery.getCount();

      const chunks: Buffer[] = [];
      const includeDiscussionResult = normalizedCoderTrainingIds.length > 0;

      const headerColumns = ['"Person Login"', '"Person Code"', '"Person Group"', '"Kodierer"', '"Unit"', '"Variable"', '"Kommentar"', '"Kodierzeitpunkt"', '"Code"', '"Code-Hinweis"'];
      if (includeReplayUrl) headerColumns.push('"Replay URL"');
      chunks.push(Buffer.from(`${headerColumns.join(';')}\n`, 'utf-8'));

      if (totalCount === 0 && hasScopedJobFilters) {
        throw new Error(this.getNoCodingResultsMessage(true));
      }

      const batchSize = 500;
      const pseudoCoderMappings = new Map<string, Map<string, string>>();
      const escapeCsvField = (field: string): string => `"${field?.toString().replace(/"/g, '""') || ''}"`;
      let exportedRowCount = 0;

      for (let i = 0; i < totalCount; i += batchSize) {
        if (checkCancellation) await checkCancellation();
        const unitsBatchQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
          .innerJoinAndSelect('cju.coding_job', 'cj')
          .leftJoinAndSelect('cj.codingJobCoders', 'cjc')
          .leftJoinAndSelect('cjc.user', 'user')
          .leftJoinAndSelect('cju.response', 'resp')
          .leftJoinAndSelect('resp.unit', 'unit')
          .leftJoinAndSelect('unit.booklet', 'booklet')
          .leftJoinAndSelect('booklet.person', 'person')
          .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo') // bookletinfo is used for replay URL
          .where('cj.workspace_id = :workspaceId', { workspaceId })
          .orderBy('cju.created_at', 'ASC')
          .skip(i)
          .take(batchSize);

        this.applyJobFilters(
          unitsBatchQuery,
          normalizedJobDefinitionIds,
          normalizedCoderTrainingIds,
          normalizedCoderIds,
          'cju'
        );
        if (normalizedCoderTrainingIds.length === 0) {
          unitsBatchQuery.andWhere('cj.training_id IS NULL');
        }
        unitsBatchQuery.andWhere(
          '(resp.status_v1 IS NULL OR resp.status_v1 NOT IN (:...excludedStatuses))',
          { excludedStatuses: EXCLUDED_STATUSES }
        );
        const unitsBatch = await unitsBatchQuery.getMany();

        let discussionResultMap = new Map<string, TrainingDiscussionExportResult>();
        if (includeDiscussionResult && unitsBatch.length > 0) {
          const trainingIdSet = new Set<number>();
          const responseIdSet = new Set<number>();
          for (const unit of unitsBatch) {
            const tId = unit.coding_job?.training_id;
            if (tId) trainingIdSet.add(tId);
            if (unit.response_id) responseIdSet.add(unit.response_id);
          }

          if (trainingIdSet.size > 0 && responseIdSet.size > 0) {
            discussionResultMap = await this.getTrainingDiscussionResultsMap(
              workspaceId,
              Array.from(trainingIdSet),
              Array.from(responseIdSet)
            );
          }
        }

        let batchCsv = '';

        // Ensure that all coder rows for the same case (training_id + response_id) are emitted first,
        // then a single coding manager row at the end of that case.
        const sortedUnitsBatch = [...unitsBatch].sort((a, b) => {
          const aTrainingId = a.coding_job?.training_id ?? 0;
          const bTrainingId = b.coding_job?.training_id ?? 0;
          if (aTrainingId !== bTrainingId) return aTrainingId - bTrainingId;
          if (a.response_id !== b.response_id) return a.response_id - b.response_id;
          if (a.variable_id !== b.variable_id) return a.variable_id.localeCompare(b.variable_id);
          const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          return aUpdated - bUpdated;
        });

        let currentCaseKey: string | null = null;
        let currentCaseRepresentative: CodingJobUnit | null = null;
        let emittedManagerForCurrentCase = false;

        const flushManagerRowIfNeeded = async (): Promise<boolean> => {
          if (!includeDiscussionResult) return false;
          if (!currentCaseRepresentative) return false;
          if (emittedManagerForCurrentCase) return false;

          const trainingId = currentCaseRepresentative.coding_job?.training_id;
          const responseId = currentCaseRepresentative.response_id;
          if (!trainingId || !responseId) return false;

          const discussion = discussionResultMap.get(`${trainingId}|${responseId}`);
          if (!discussion) return false;
          if (!discussion.managerUsername) return false;

          const person = currentCaseRepresentative.response?.unit?.booklet?.person;
          const personLogin = person?.login || '';
          const personCode = person?.code || '';
          const personGroup = person?.group || '';
          const unitName = currentCaseRepresentative.unit_name || currentCaseRepresentative.response?.unit?.name || '';
          const managerDisplayName = discussion.managerUsername;
          const discussionTimestamp = discussion.updatedAt ? new Date(discussion.updatedAt).toLocaleString('de-DE').replace(',', '') : '';
          const mappedDiscussionCode = mapCodeForExport(discussion.code);
          const discussionCodeValue = mappedDiscussionCode === null ? '' : mappedDiscussionCode.toString();
          const discussionNoteValue = discussion.notes || '';

          const discussionRowFields = [
            escapeCsvField(personLogin),
            escapeCsvField(personCode),
            escapeCsvField(personGroup),
            escapeCsvField(managerDisplayName),
            escapeCsvField(unitName),
            escapeCsvField(currentCaseRepresentative.variable_id),
            escapeCsvField(discussionNoteValue),
            escapeCsvField(discussionTimestamp),
            escapeCsvField(discussionCodeValue),
            escapeCsvField('')
          ];

          if (includeReplayUrl && (req || serverUrl)) {
            const bookletName = currentCaseRepresentative.response?.unit?.booklet?.bookletinfo?.name || '';
            const replayUnitName = currentCaseRepresentative.response?.unit?.name || unitName;
            const replayUrl = await this.generateReplayUrlWithPageLookup(req, personLogin, personCode, personGroup, bookletName, replayUnitName, currentCaseRepresentative.variable_id, workspaceId, authToken, serverUrl);
            discussionRowFields.push(escapeCsvField(replayUrl));
          }

          batchCsv += `${discussionRowFields.join(';')}\n`;
          emittedManagerForCurrentCase = true;
          return true;
        };

        for (const unit of sortedUnitsBatch) {
          if (unit.unit_name && isExcluded(unit.response?.unit?.booklet?.bookletinfo?.name || '', unit.unit_name)) continue;
          if (
            manualCodingVariableSet &&
            !manualCodingVariableSet.has(toManualCodingVariablePairKey(unit.unit_name, unit.variable_id))
          ) continue;
          if (unit.response?.status_v1 !== null && unit.response?.status_v1 !== undefined && EXCLUDED_STATUSES.includes(unit.response.status_v1)) continue;

          const trainingId = unit.coding_job?.training_id ?? 0;
          const caseKey = `${trainingId}|${unit.response_id}`;

          if (currentCaseKey !== null && caseKey !== currentCaseKey) {
            if (await flushManagerRowIfNeeded()) exportedRowCount += 1;
            currentCaseRepresentative = null;
            emittedManagerForCurrentCase = false;
          }

          currentCaseKey = caseKey;
          if (!currentCaseRepresentative) currentCaseRepresentative = unit;

          if (unit.code === null || unit.code === undefined) continue;

          const person = unit.response?.unit?.booklet?.person;
          const personLogin = person?.login || '';
          const personCode = person?.code || '';
          const personGroup = person?.group || '';
          const unitName = unit.unit_name || unit.response?.unit?.name || '';
          let coder = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';

          if (anonymizeCoders && coder) {
            if (usePseudoCoders) {
              const varPersonKey = `${unit.variable_id}_${personLogin}_${personCode}`;
              if (!pseudoCoderMappings.has(varPersonKey)) {
                pseudoCoderMappings.set(varPersonKey, new Map<string, string>());
              }
              const varPersonMap = pseudoCoderMappings.get(varPersonKey)!;
              if (!varPersonMap.has(coder)) {
                varPersonMap.set(coder, `K${varPersonMap.size + 1}`);
              }
              coder = varPersonMap.get(coder)!;
            } else {
              coder = coderNameMapping?.get(coder) || coder;
            }
          }

          const timestamp = unit.updated_at ? new Date(unit.updated_at).toLocaleString('de-DE').replace(',', '') : '';
          const mapped = await this.mapCodeAndScoreForExport(
            workspaceId,
            unit.code,
            null,
            unit.coding_job?.missings_profile_id
          );
          const codeValue = mapped.code === null ? '' : mapped.code.toString();

          let commentValue = unit.notes || '';
          if (!outputCommentsInsteadOfCodes && unit.coding_issue_option) {
            commentValue = this.getCodingIssueText(unit.coding_issue_option) || commentValue;
          }
          const codeIssueValue = this.getCodingIssueText(unit.coding_issue_option);

          const rowFields = [
            escapeCsvField(personLogin),
            escapeCsvField(personCode),
            escapeCsvField(personGroup),
            escapeCsvField(coder),
            escapeCsvField(unitName),
            escapeCsvField(unit.variable_id),
            escapeCsvField(commentValue),
            escapeCsvField(timestamp),
            escapeCsvField(codeValue),
            escapeCsvField(codeIssueValue)
          ];

          if (includeReplayUrl && (req || serverUrl)) {
            const bookletName = unit.response?.unit?.booklet?.bookletinfo?.name || '';
            const replayUnitName = unit.response?.unit?.name || unitName;
            const replayUrl = await this.generateReplayUrlWithPageLookup(req, personLogin, personCode, personGroup, bookletName, replayUnitName, unit.variable_id, workspaceId, authToken, serverUrl);
            rowFields.push(escapeCsvField(replayUrl));
          }

          batchCsv += `${rowFields.join(';')}\n`;
          exportedRowCount += 1;
        }

        // Flush last case in this batch
        if (await flushManagerRowIfNeeded()) exportedRowCount += 1;
        chunks.push(Buffer.from(batchCsv, 'utf-8'));
      }

      if (exportedRowCount === 0 && hasScopedJobFilters) {
        throw new Error(this.getNoCodingResultsMessage(true));
      }

      this.logger.log(`Exported detailed results for workspace ${workspaceId}`);
      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Error exporting detailed coding results: ${error.message}`, error.stack);
      throw new Error(`Could not export detailed coding results: ${error.message}`);
    }
  }

  async exportCodingTimesReport(
    workspaceId: number,
    anonymizeCoders = false,
    usePseudoCoders = false,
    excludeAutoCoded = false,
    checkCancellation?: () => Promise<void>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<Buffer> {
    this.logger.log(`Exporting coding times report for workspace ${workspaceId}${anonymizeCoders ? ' with anonymized coders' : ''}${usePseudoCoders ? ' using pseudo coders' : ''}${excludeAutoCoded ? ' (manual coding only)' : ''}`);
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    const hasScopedJobFilters = this.hasScopedJobFilters(
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds
    );

    // Check for cancellation before starting
    if (checkCancellation) await checkCancellation();

    let manualCodingVariableSet: Set<string> | null = null;
    if (excludeAutoCoded) {
      manualCodingVariableSet = await this.getManualCodingVariableSet(workspaceId);
    }

    const codingJobUnitsQuery = this.codingJobUnitRepository.createQueryBuilder('cju')
      .innerJoinAndSelect('cju.coding_job', 'cj')
      .leftJoinAndSelect('cj.codingJobCoders', 'cjc')
      .leftJoinAndSelect('cjc.user', 'user')
      .leftJoinAndSelect('cju.response', 'resp')
      .leftJoinAndSelect('resp.unit', 'unit')
      .leftJoinAndSelect('unit.booklet', 'booklet')
      .leftJoinAndSelect('booklet.bookletinfo', 'bookletinfo')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cju.code IS NOT NULL')
      .orderBy('cju.updated_at', 'ASC');
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    applyResolvedExclusionsToQuery(codingJobUnitsQuery, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name'
    });

    this.applyJobFilters(
      codingJobUnitsQuery,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds,
      'cju'
    );
    if (normalizedCoderTrainingIds.length === 0) {
      codingJobUnitsQuery.andWhere('cj.training_id IS NULL');
    }
    const codingJobUnitsRaw = await codingJobUnitsQuery.getMany();

    const isExcluded = await this.getExclusionChecker(workspaceId);

    const codingJobUnits = codingJobUnitsRaw.filter(
      unit => unit.response?.unit?.name && !isExcluded(unit.response.unit.booklet?.bookletinfo?.name || '', unit.response.unit.name)
    );

    this.logger.log(`Found ${codingJobUnits.length} coded coding job units for workspace ${workspaceId} after filtering ignored units`);

    try {
      let coderNameMapping: Map<string, string> | null = null;
      if (anonymizeCoders) {
        const allCoders = new Set<string>();
        for (const unit of codingJobUnits) {
          const coderName = unit.coding_job?.codingJobCoders?.[0]?.user?.username || '';
          if (coderName) {
            allCoders.add(coderName);
          }
        }
        coderNameMapping = buildCoderNameMapping(Array.from(allCoders), usePseudoCoders);
      }

      if (codingJobUnits.length > 0) {
        this.logger.log('Sample coded coding job unit:', {
          id: codingJobUnits[0].id,
          variable_id: codingJobUnits[0].variable_id,
          code: codingJobUnits[0].code,
          updated_at: codingJobUnits[0].updated_at,
          unit_name: codingJobUnits[0].response?.unit?.name,
          coders_count: codingJobUnits[0].coding_job?.codingJobCoders?.length,
          first_coder: codingJobUnits[0].coding_job?.codingJobCoders?.[0]?.user?.username
        });
      } else {
        this.logger.warn(`No coded coding job units found for workspace ${workspaceId}`);
      }

      if (codingJobUnits.length === 0) {
        if (hasScopedJobFilters) {
          throw new Error(this.getNoCodingResultsMessage(true));
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

        worksheet.columns = [
          { header: 'Unit', key: 'unit', width: 20 },
          { header: 'Variable', key: 'variable', width: 20 },
          { header: 'Gesamt', key: 'gesamt', width: 15 }
        ];

        worksheet.getRow(1).font = { bold: true };
        worksheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };

        worksheet.getColumn('unit').font = { bold: true };
        worksheet.getColumn('variable').font = { bold: true };

        this.logger.log('Generated empty coding times report (no coded units found)');
        const buffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
      }

      const variableUnitCoders = new Map<string, Set<string>>();
      const variableUnitCoderTimestamps = new Map<string, Map<string, Date[]>>();
      const variableUnitLabels = new Map<string, { unitName: string; variableId: string }>();

      for (const unit of codingJobUnits) {
        if (!unit.response?.unit?.name || !unit.updated_at) continue;

        const variableId = unit.variable_id;
        const unitName = unit.response.unit.name;
        const variableUnitKey = toManualCodingVariablePairKey(unitName, variableId);
        const timestamp = new Date(unit.updated_at);

        if (manualCodingVariableSet) {
          if (!manualCodingVariableSet.has(variableUnitKey)) {
            continue;
          }
        }

        if (!variableUnitCoders.has(variableUnitKey)) {
          variableUnitCoders.set(variableUnitKey, new Set());
          variableUnitLabels.set(variableUnitKey, { unitName, variableId });
        }

        if (!variableUnitCoderTimestamps.has(variableUnitKey)) {
          variableUnitCoderTimestamps.set(variableUnitKey, new Map<string, Date[]>());
        }

        for (const jobCoder of unit.coding_job?.codingJobCoders || []) {
          const coderName = jobCoder.user?.username || 'Unknown';
          variableUnitCoders.get(variableUnitKey)!.add(coderName);

          const coderTimestampsByVariableUnit = variableUnitCoderTimestamps.get(variableUnitKey)!;
          if (!coderTimestampsByVariableUnit.has(coderName)) {
            coderTimestampsByVariableUnit.set(coderName, []);
          }
          coderTimestampsByVariableUnit.get(coderName)!.push(timestamp);
        }
      }

      const coderList = Array.from(new Set(
        Array.from(variableUnitCoders.values()).flatMap(coders => Array.from(coders.values()))
      )).sort();

      if (variableUnitCoders.size === 0 && hasScopedJobFilters) {
        throw new Error(this.getNoCodingResultsMessage(true));
      }

      const displayCoderList = coderNameMapping ?
        coderList.map(coder => coderNameMapping.get(coder) || coder) :
        coderList;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Kodierzeiten-Bericht');

      worksheet.columns = [
        { header: 'Unit', key: 'unit', width: 20 },
        { header: 'Variable', key: 'variable', width: 20 },
        ...displayCoderList.map((displayCoder, index) => ({ header: displayCoder, key: `coder_${index}`, width: 15 })),
        { header: 'Gesamt', key: 'gesamt', width: 15 }
      ];

      const sortedVariableUnitKeys = Array.from(variableUnitCoders.keys()).sort();

      for (const variableUnitKey of sortedVariableUnitKeys) {
        const { unitName, variableId } = variableUnitLabels.get(variableUnitKey) || {
          unitName: variableUnitKey,
          variableId: ''
        };
        const assignedCoders = variableUnitCoders.get(variableUnitKey)!;

        const rowData: { [key: string]: string | number | null } = {
          unit: unitName,
          variable: variableId,
          gesamt: null
        };

        let totalTimeSum = 0;
        let totalValidCodings = 0;

        for (let i = 0; i < coderList.length; i++) {
          const coderName = coderList[i];
          const columnKey = `coder_${i}`;

          if (assignedCoders.has(coderName)) {
            const coderTimestamps = variableUnitCoderTimestamps
              .get(variableUnitKey)
              ?.get(coderName) || [];
            const avgTime = this.calculateAverageCodingTime(coderTimestamps);
            rowData[columnKey] = avgTime !== null ? Math.round(avgTime! * 100) / 100 : null;
            if (avgTime !== null) {
              totalTimeSum += avgTime;
              totalValidCodings += 1;
            }
          } else {
            rowData[columnKey] = null;
          }
        }

        rowData.gesamt = totalValidCodings > 0 ? Math.round((totalTimeSum / totalValidCodings) * 100) / 100 : null;

        worksheet.addRow(rowData);
      }

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      worksheet.getColumn('unit').font = { bold: true };
      worksheet.getColumn('variable').font = { bold: true };

      this.logger.log(`Generated coding times pivot table with ${sortedVariableUnitKeys.length} variable-unit combinations and ${coderList.length} coders`);

      const buffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      this.logger.error(`Error exporting coding times report: ${error.message}`, error.stack);
      throw new Error(`Could not export coding times report: ${error.message}`);
    }
  }

  private calculateAverageCodingTime(timestamps: Date[]): number | null {
    if (timestamps.length < 2) {
      return null;
    }

    const sortedTimestamps = [...timestamps].sort((a, b) => a.getTime() - b.getTime());

    const timeSpans: number[] = [];
    const MAX_GAP_MS = 10 * 60 * 1000; // 10 minutes in milliseconds

    for (let i = 1; i < sortedTimestamps.length; i++) {
      const timeSpan = sortedTimestamps[i].getTime() - sortedTimestamps[i - 1].getTime();

      if (timeSpan <= MAX_GAP_MS) {
        timeSpans.push(timeSpan);
      }
    }

    if (timeSpans.length === 0) {
      return null;
    }

    const totalTimeMs = timeSpans.reduce((sum, span) => sum + span, 0);
    const averageTimeMs = totalTimeMs / timeSpans.length;

    return averageTimeMs / 1000; // Convert to seconds
  }

  private async getTrainingDiscussionResultsMap(
    workspaceId: number,
    trainingIds?: number[],
    responseIds?: number[]
  ): Promise<Map<string, TrainingDiscussionExportResult>> {
    if (!trainingIds?.length) {
      return new Map();
    }

    if (responseIds && responseIds.length === 0) {
      return new Map();
    }

    const where: {
      workspace_id: number;
      training_id: number | FindOperator<number>;
      response_id?: number | FindOperator<number>;
    } = {
      workspace_id: workspaceId,
      training_id: In(trainingIds)
    };

    if (responseIds) {
      where.response_id = In(responseIds);
    }

    const discussionResults = await this.coderTrainingDiscussionResultRepository.find({ where });
    if (discussionResults.length === 0) {
      return new Map();
    }

    const managerUserIds = Array.from(
      new Set(
        discussionResults
          .map(result => result.manager_user_id)
          .filter((managerUserId): managerUserId is number => !!managerUserId)
      )
    );

    const managerUsernameById = new Map<number, string>();
    if (managerUserIds.length > 0) {
      const managers = await this.userRepository.findBy({ id: In(managerUserIds) });
      managers.forEach(manager => managerUsernameById.set(manager.id, manager.username));
    }

    return new Map(
      discussionResults.map(result => {
        const managerUsername = result.manager_user_id ?
          (managerUsernameById.get(result.manager_user_id) || result.manager_name || null) :
          (result.manager_name || null);

        return [`${result.training_id}|${result.response_id}`, {
          code: result.code,
          score: result.score ?? null,
          notes: result.notes ?? null,
          managerUsername,
          updatedAt: result.updated_at
        }];
      })
    );
  }

  private async getTrainingManagerUsernames(workspaceId: number, trainingIds?: number[]): Promise<string[]> {
    const discussionResultsMap = await this.getTrainingDiscussionResultsMap(workspaceId, trainingIds);
    return Array.from(
      new Set(
        Array.from(discussionResultsMap.values())
          .map(result => result.managerUsername)
          .filter((managerUsername): managerUsername is string => !!managerUsername)
      )
    ).sort();
  }

  private normalizeFilterIds(ids?: number[]): number[] {
    if (!ids?.length) {
      return [];
    }

    const normalized = ids
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id > 0);

    return Array.from(new Set(normalized));
  }

  private normalizeJobFilters(
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): { jobDefinitionIds: number[]; coderTrainingIds: number[]; coderIds: number[] } {
    return {
      jobDefinitionIds: this.normalizeFilterIds(jobDefinitionIds),
      coderTrainingIds: this.normalizeFilterIds(coderTrainingIds),
      coderIds: this.normalizeFilterIds(coderIds)
    };
  }

  private hasScopedJobFilters(
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): boolean {
    return !!(
      this.normalizeFilterIds(jobDefinitionIds).length ||
      this.normalizeFilterIds(coderTrainingIds).length ||
      this.normalizeFilterIds(coderIds).length
    );
  }

  private getNoCodingResultsMessage(hasScopedJobFilters: boolean): string {
    return hasScopedJobFilters ?
      'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter in diesem Workspace gefunden' :
      'Keine Kodierergebnisse für diesen Workspace gefunden';
  }

  private applyJobFilters(
    query: SelectQueryBuilder<unknown>,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[],
    codingJobUnitAlias?: string
  ): void {
    applyNonCodingIssueReviewJobFilter(
      query,
      'cj',
      'codingExportReviewJobType'
    );

    const normalizedJobDefinitionIds = this.normalizeFilterIds(jobDefinitionIds);
    const normalizedCoderTrainingIds = this.normalizeFilterIds(coderTrainingIds);
    const normalizedCoderIds = this.normalizeFilterIds(coderIds);

    const scopeClauses: string[] = [];
    const scopeParams: Record<string, number[]> = {};

    if (normalizedJobDefinitionIds.length > 0) {
      scopeClauses.push(this.getJobDefinitionScopeClause('cj', 'jobDefinitionIds', codingJobUnitAlias));
      scopeParams.jobDefinitionIds = normalizedJobDefinitionIds;
    }

    if (normalizedCoderTrainingIds.length > 0) {
      scopeClauses.push('cj.training_id IN (:...coderTrainingIds)');
      scopeParams.coderTrainingIds = normalizedCoderTrainingIds;
    }

    if (scopeClauses.length > 0) {
      query.andWhere(`(${scopeClauses.join(' OR ')})`, scopeParams);
    }

    if (normalizedCoderIds.length > 0) {
      // Use EXISTS subquery to filter by coder IDs in coding_job_coder table
      query.andWhere(`EXISTS (
        SELECT 1 FROM coding_job_coder filter_cjc
        WHERE filter_cjc.coding_job_id = cj.id
        AND filter_cjc.user_id IN (:...coderIds)
      )`, { coderIds: normalizedCoderIds });
    }
  }

  private getJobDefinitionScopeClause(
    codingJobAlias: string,
    jobDefinitionParamName: string,
    codingJobUnitAlias?: string
  ): string {
    const variableBundleJoin = codingJobUnitAlias ?
      `INNER JOIN variable_bundle scope_vb
        ON scope_vb.id = scope_cjvb.variable_bundle_id
        AND scope_vb.workspace_id = ${codingJobAlias}.workspace_id` :
      '';
    const bundleScopeClause = codingJobUnitAlias ?
      `AND COALESCE(scope_jd.assigned_variable_bundles, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', scope_cjvb.variable_bundle_id))
      AND COALESCE(scope_vb.variables, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object(
          'unitName', ${codingJobUnitAlias}.unit_name,
          'variableId', ${codingJobUnitAlias}.variable_id
        ))` :
      "AND COALESCE(scope_jd.assigned_variable_bundles, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('id', scope_cjvb.variable_bundle_id))";

    return `(${codingJobAlias}.job_definition_id IN (:...${jobDefinitionParamName}) OR (${codingJobAlias}.job_definition_id IS NULL AND EXISTS (
      SELECT 1
      FROM coding_job_variable_bundle scope_cjvb
      INNER JOIN job_definitions scope_jd
        ON scope_jd.id IN (:...${jobDefinitionParamName})
        AND scope_jd.workspace_id = ${codingJobAlias}.workspace_id
      ${variableBundleJoin}
      WHERE scope_cjvb.coding_job_id = ${codingJobAlias}.id
      ${bundleScopeClause}
    )))`;
  }

  private applySelectedCoderJoinFilter(
    query: SelectQueryBuilder<unknown>,
    coderIds?: number[]
  ): void {
    const normalizedCoderIds = this.normalizeFilterIds(coderIds);
    if (normalizedCoderIds.length === 0) return;

    query.andWhere('cjc.user_id IN (:...selectedCoderIds)', {
      selectedCoderIds: normalizedCoderIds
    });
  }
}
