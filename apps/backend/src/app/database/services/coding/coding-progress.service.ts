import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets, In, Repository
} from 'typeorm';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { JobDefinition } from '../../entities/job-definition.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { Setting } from '../../entities/setting.entity';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import {
  applyResolvedExclusionsToQuery,
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';

type ResponseMatchingFlag =
  | 'NO_AGGREGATION'
  | 'IGNORE_CASE'
  | 'IGNORE_WHITESPACE';

interface CoverageResponse {
  responseId: number;
  unitName: string;
  variableId: string;
  value: string | null;
  codeV2: number | null;
  statusV2: number | null;
}

interface EffectiveCaseCoverage {
  effectiveTotalCasesToCode: number;
  effectiveCasesInJobs: number;
  effectiveUnassignedCases: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
}

interface EffectiveCaseProgress {
  effectiveTotalCasesToCode: number;
  effectiveCompletedCases: number;
  aggregationActive: boolean;
  aggregationThreshold: number | null;
  aggregatedDuplicateCases: number;
}

@Injectable()
export class CodingProgressService {
  private readonly logger = new Logger(CodingProgressService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(JobDefinition)
    private jobDefinitionRepository: Repository<JobDefinition>,
    @InjectRepository(VariableBundle)
    private variableBundleRepository: Repository<VariableBundle>,
    @InjectRepository(Setting)
    private settingRepository: Repository<Setting>,
    private workspaceFilesService: WorkspaceFilesService,
    private workspaceExclusionService: WorkspaceExclusionService
  ) { }

  async getCodingProgressOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    completedCases: number;
    completionPercentage: number;
    rawTotalCasesToCode: number;
    rawCompletedCases: number;
    rawCompletionPercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
  }> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const rawTotalCasesQuery = this.responseRepository
      .createQueryBuilder('response')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }));
    applyResolvedExclusionsToQuery(rawTotalCasesQuery, exclusions);
    const rawTotalCasesToCode = await rawTotalCasesQuery.getCount();

    const completedResponseIds = await this.getCompletedCoverageResponseIds(workspaceId);
    const completedCases = completedResponseIds.size;
    const rawCompletionPercentage =
      rawTotalCasesToCode > 0 ? (completedCases / rawTotalCasesToCode) * 100 : 0;
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      completedResponseIds
    );
    const completionPercentage =
      effectiveProgress.effectiveTotalCasesToCode > 0 ?
        (effectiveProgress.effectiveCompletedCases / effectiveProgress.effectiveTotalCasesToCode) * 100 :
        0;

    return {
      totalCasesToCode: effectiveProgress.effectiveTotalCasesToCode,
      completedCases: effectiveProgress.effectiveCompletedCases,
      completionPercentage,
      rawTotalCasesToCode,
      rawCompletedCases: completedCases,
      rawCompletionPercentage,
      aggregationActive: effectiveProgress.aggregationActive,
      aggregationThreshold: effectiveProgress.aggregationThreshold,
      aggregatedDuplicateCases: effectiveProgress.aggregatedDuplicateCases
    };
  }

  async getAppliedResultsOverview(workspaceId: number): Promise<{
    totalIncompleteResponses: number;
    appliedResponses: number;
    remainingResponses: number;
    completionPercentage: number;
    rawTotalIncompleteResponses: number;
    rawAppliedResponses: number;
    rawCompletionPercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
  }> {
    const responses = await this.getCoverageResponses(workspaceId);
    const appliedResponseIds = new Set(
      responses
        .filter(response => this.isAppliedResultResponse(response))
        .map(response => response.responseId)
    );
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      appliedResponseIds,
      responses
    );
    const completionPercentage =
      effectiveProgress.effectiveTotalCasesToCode > 0 ?
        (effectiveProgress.effectiveCompletedCases / effectiveProgress.effectiveTotalCasesToCode) * 100 :
        0;
    const rawCompletionPercentage =
      responses.length > 0 ? (appliedResponseIds.size / responses.length) * 100 : 0;

    return {
      totalIncompleteResponses: effectiveProgress.effectiveTotalCasesToCode,
      appliedResponses: effectiveProgress.effectiveCompletedCases,
      remainingResponses: Math.max(
        0,
        effectiveProgress.effectiveTotalCasesToCode - effectiveProgress.effectiveCompletedCases
      ),
      completionPercentage,
      rawTotalIncompleteResponses: responses.length,
      rawAppliedResponses: appliedResponseIds.size,
      rawCompletionPercentage,
      aggregationActive: effectiveProgress.aggregationActive,
      aggregationThreshold: effectiveProgress.aggregationThreshold,
      aggregatedDuplicateCases: effectiveProgress.aggregatedDuplicateCases
    };
  }

  async getCaseCoverageOverview(workspaceId: number): Promise<{
    totalCasesToCode: number;
    effectiveTotalCasesToCode: number;
    casesInJobs: number;
    effectiveCasesInJobs: number;
    doubleCodedCases: number;
    singleCodedCases: number;
    unassignedCases: number;
    effectiveUnassignedCases: number;
    coveragePercentage: number;
    rawCoveragePercentage: number;
    aggregationActive: boolean;
    aggregationThreshold: number | null;
    aggregatedDuplicateCases: number;
  }> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const totalCasesQuery = this.responseRepository
      .createQueryBuilder('response')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      // Exclude pre-processed responses (not in manual coding pool)
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }));
    applyResolvedExclusionsToQuery(totalCasesQuery, exclusions);
    const totalCasesToCode = await totalCasesQuery.getCount();

    const casesInJobsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      // Exclude pre-processed responses (not in manual coding pool)
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }));
    applyResolvedExclusionsToQuery(casesInJobsQuery, exclusions, { parameterPrefix: 'caseCoverageJobs' });
    const casesInJobs = await casesInJobsQuery.getCount();

    const uniqueCasesInJobsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      // Exclude pre-processed responses (not in manual coding pool)
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }))
      .select('COUNT(DISTINCT cju.response_id)', 'count');
    applyResolvedExclusionsToQuery(uniqueCasesInJobsQuery, exclusions, { parameterPrefix: 'caseCoverageUniqueJobs' });
    const uniqueCasesInJobsResult = await uniqueCasesInJobsQuery.getRawOne();

    const uniqueCasesInJobs = parseInt(
      uniqueCasesInJobsResult?.count || '0',
      10
    );

    const doubleCodedCases = casesInJobs - uniqueCasesInJobs;

    const singleCodedCases = uniqueCasesInJobs;
    const unassignedCases = totalCasesToCode - uniqueCasesInJobs;
    const rawCoveragePercentage =
      totalCasesToCode > 0 ? (uniqueCasesInJobs / totalCasesToCode) * 100 : 0;
    const effectiveCoverage = await this.getEffectiveCaseCoverage(workspaceId);
    const coveragePercentage =
      effectiveCoverage.effectiveTotalCasesToCode > 0 ?
        (effectiveCoverage.effectiveCasesInJobs / effectiveCoverage.effectiveTotalCasesToCode) * 100 :
        0;

    return {
      totalCasesToCode,
      effectiveTotalCasesToCode: effectiveCoverage.effectiveTotalCasesToCode,
      casesInJobs,
      effectiveCasesInJobs: effectiveCoverage.effectiveCasesInJobs,
      doubleCodedCases,
      singleCodedCases,
      unassignedCases,
      effectiveUnassignedCases: effectiveCoverage.effectiveUnassignedCases,
      coveragePercentage,
      rawCoveragePercentage,
      aggregationActive: effectiveCoverage.aggregationActive,
      aggregationThreshold: effectiveCoverage.aggregationThreshold,
      aggregatedDuplicateCases: effectiveCoverage.aggregatedDuplicateCases
    };
  }

  private async getEffectiveCaseCoverage(workspaceId: number): Promise<EffectiveCaseCoverage> {
    const responses = await this.getCoverageResponses(workspaceId);
    const assignedResponseIds = await this.getAssignedCoverageResponseIds(workspaceId);
    const effectiveProgress = await this.getEffectiveCaseProgress(
      workspaceId,
      assignedResponseIds,
      responses
    );

    return {
      effectiveTotalCasesToCode: effectiveProgress.effectiveTotalCasesToCode,
      effectiveCasesInJobs: effectiveProgress.effectiveCompletedCases,
      effectiveUnassignedCases:
        effectiveProgress.effectiveTotalCasesToCode - effectiveProgress.effectiveCompletedCases,
      aggregationActive: effectiveProgress.aggregationActive,
      aggregationThreshold: effectiveProgress.aggregationThreshold,
      aggregatedDuplicateCases: effectiveProgress.aggregatedDuplicateCases
    };
  }

  private async getEffectiveCaseProgress(
    workspaceId: number,
    completedResponseIds: Set<number>,
    providedResponses?: CoverageResponse[]
  ): Promise<EffectiveCaseProgress> {
    const responses = providedResponses || await this.getCoverageResponses(workspaceId);
    const aggregationThreshold = await this.getAggregationThreshold(workspaceId);
    const matchingFlags = await this.getResponseMatchingMode(workspaceId);
    const aggregationActive =
      aggregationThreshold !== null && !matchingFlags.includes('NO_AGGREGATION');

    if (!aggregationActive) {
      const effectiveCompletedCases = responses
        .filter(response => completedResponseIds.has(response.responseId))
        .length;

      return {
        effectiveTotalCasesToCode: responses.length,
        effectiveCompletedCases,
        aggregationActive,
        aggregationThreshold,
        aggregatedDuplicateCases: 0
      };
    }

    const derivedVariableMap = await this.getDerivedVariableMap(workspaceId);
    const groupedResponses = new Map<string, CoverageResponse[]>();

    for (const response of responses) {
      const variableKey = `${response.unitName.toUpperCase()}::${response.variableId}`;
      const isDerivedVariable = derivedVariableMap.get(response.unitName.toUpperCase())?.has(response.variableId) ?? false;
      const groupKey = isDerivedVariable ?
        `${variableKey}::${response.responseId}` :
        `${variableKey}::${this.normalizeValue(response.value, matchingFlags)}`;
      const group = groupedResponses.get(groupKey) || [];
      group.push(response);
      groupedResponses.set(groupKey, group);
    }

    let effectiveTotalCasesToCode = 0;
    let effectiveCasesInJobs = 0;
    let aggregatedDuplicateCases = 0;

    groupedResponses.forEach(group => {
      if (aggregationThreshold !== null && group.length >= aggregationThreshold) {
        effectiveTotalCasesToCode += 1;
        if (group.some(response => completedResponseIds.has(response.responseId))) {
          effectiveCasesInJobs += 1;
        }
        aggregatedDuplicateCases += group.length - 1;
      } else {
        effectiveTotalCasesToCode += group.length;
        effectiveCasesInJobs += group
          .filter(response => completedResponseIds.has(response.responseId))
          .length;
      }
    });

    return {
      effectiveTotalCasesToCode,
      effectiveCompletedCases: effectiveCasesInJobs,
      aggregationActive,
      aggregationThreshold,
      aggregatedDuplicateCases
    };
  }

  private async getCoverageResponses(workspaceId: number): Promise<CoverageResponse[]> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.responseRepository
      .createQueryBuilder('response')
      .select('response.id', 'responseId')
      .addSelect('response.value', 'value')
      .addSelect('response.code_v2', 'codeV2')
      .addSelect('response.status_v2', 'statusV2')
      .addSelect('response.variableid', 'variableId')
      .addSelect('unit.name', 'unitName')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('(response.code_v2 IS NULL OR (response.code_v2 != -111 AND response.code_v2 != -98))')
      .orderBy('response.id', 'ASC');
    applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: 'coverageResponses' });
    const raw = await query.getRawMany();

    return raw.map(row => ({
      responseId: Number(row.responseId),
      value: row.value ?? null,
      codeV2: row.codeV2 === null || row.codeV2 === undefined ? null : Number(row.codeV2),
      statusV2: row.statusV2 === null || row.statusV2 === undefined ? null : Number(row.statusV2),
      variableId: row.variableId,
      unitName: row.unitName
    }));
  }

  private async getCompletedCoverageResponseIds(workspaceId: number): Promise<Set<number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .innerJoin('cju.coding_job', 'coding_job')
      .innerJoin('cju.response', 'response')
      .innerJoin('response.unit', 'unit')
      .innerJoin('unit.booklet', 'booklet')
      .innerJoin('booklet.bookletinfo', 'bookletinfo')
      .innerJoin('booklet.person', 'person')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere('cju.code IS NOT NULL')
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .select('DISTINCT cju.response_id', 'responseId');
    applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: 'completedCoverage' });
    const raw = await query.getRawMany();

    return new Set(raw.map(row => Number(row.responseId)));
  }

  private isAppliedResultResponse(response: CoverageResponse): boolean {
    const appliedStatuses = [
      statusStringToNumber('CODING_COMPLETE'),
      statusStringToNumber('INVALID'),
      statusStringToNumber('CODING_ERROR')
    ];

    return (
      response.statusV2 !== null &&
      appliedStatuses.includes(response.statusV2) &&
      (response.codeV2 === null || response.codeV2 >= 0)
    );
  }

  private async getAssignedCoverageResponseIds(workspaceId: number): Promise<Set<number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('DISTINCT cju.response_id', 'responseId')
      .innerJoin('cju.response', 'response')
      .leftJoin('cju.coding_job', 'coding_job')
      .leftJoin('response.unit', 'unit')
      .leftJoin('unit.booklet', 'booklet')
      .leftJoin('booklet.bookletinfo', 'bookletinfo')
      .leftJoin('booklet.person', 'person')
      .where('response.status_v1 IN (:...statuses)', {
        statuses: [
          statusStringToNumber('CODING_INCOMPLETE'),
          statusStringToNumber('INTENDED_INCOMPLETE')
        ]
      })
      .andWhere('person.workspace_id = :workspaceId', { workspaceId })
      .andWhere('person.consider = :consider', { consider: true })
      .andWhere('coding_job.training_id IS NULL')
      .andWhere(new Brackets(qb => {
        qb.where('response.code_v2 IS NULL')
          .orWhere(subQuery => {
            const exists = subQuery
              .subQuery()
              .select('1')
              .from('coding_job_unit', 'cju')
              .where('cju.response_id = response.id')
              .getQuery();
            return `EXISTS (${exists})`;
          });
      }));
    applyResolvedExclusionsToQuery(query, exclusions, { parameterPrefix: 'assignedCoverage' });
    const raw = await query.getRawMany();

    return new Set(raw.map(row => Number(row.responseId)));
  }

  private async getAggregationThreshold(workspaceId: number): Promise<number | null> {
    const setting = await this.settingRepository.findOne({
      where: { key: `workspace-${workspaceId}-duplicate-aggregation-threshold` }
    });

    if (!setting) {
      return 2;
    }

    if (setting.content === 'disabled' || setting.content === '0') {
      return null;
    }

    const parsedThreshold = parseInt(setting.content, 10);
    return Number.isNaN(parsedThreshold) ? 2 : parsedThreshold;
  }

  private async getResponseMatchingMode(workspaceId: number): Promise<ResponseMatchingFlag[]> {
    const setting = await this.settingRepository.findOne({
      where: { key: `workspace-${workspaceId}-response-matching-mode` }
    });

    if (!setting) {
      return [];
    }

    try {
      const parsed = JSON.parse(setting.content);
      return Array.isArray(parsed.flags) ? parsed.flags : [];
    } catch {
      return [];
    }
  }

  private normalizeValue(value: string | null, flags: ResponseMatchingFlag[]): string {
    let normalized = value ?? '';

    if (flags.includes('IGNORE_CASE')) {
      normalized = normalized.toLowerCase();
    }

    if (flags.includes('IGNORE_WHITESPACE')) {
      normalized = normalized.replace(/\s+/g, '');
    }

    return normalized;
  }

  private async getDerivedVariableMap(workspaceId: number): Promise<Map<string, Set<string>>> {
    try {
      return await this.workspaceFilesService.getDerivedVariableMap(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not load derived variable map for workspace ${workspaceId}: ${message}`);
      return new Map<string, Set<string>>();
    }
  }

  async getVariableCoverageOverview(workspaceId: number): Promise<{
    totalVariables: number;
    coveredVariables: number;
    coveredByDraft: number;
    coveredByPendingReview: number;
    coveredByApproved: number;
    conflictedVariables: number;
    missingVariables: number;
    partiallyAbgedeckteVariablen: number;
    fullyAbgedeckteVariablen: number;
    coveragePercentage: number;
    variableCaseCounts: {
      unitName: string;
      variableId: string;
      caseCount: number;
    }[];
    coverageByStatus: {
      draft: string[];
      pending_review: string[];
      approved: string[];
      conflicted: Array<{
        variableKey: string;
        conflictingDefinitions: Array<{
          id: number;
          status: string;
        }>;
      }>;
    };
  }> {
    try {
      this.logger.log(
        `Getting variable coverage overview for workspace ${workspaceId} (CODING_INCOMPLETE variables only)`
      );

      const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
      const incompleteVariablesQuery = this.responseRepository
        .createQueryBuilder('response')
        .select('unit.name', 'unitName')
        .addSelect('response.variableid', 'variableId')
        .addSelect('COUNT(response.id)', 'caseCount')
        .leftJoin('response.unit', 'unit')
        .leftJoin('unit.booklet', 'booklet')
        .leftJoin('booklet.bookletinfo', 'bookletinfo')
        .leftJoin('booklet.person', 'person')
        .where('response.status_v1 IN (:...statuses)', {
          statuses: [
            statusStringToNumber('CODING_INCOMPLETE'),
            statusStringToNumber('INTENDED_INCOMPLETE')
          ]
        })
        .andWhere('person.workspace_id = :workspaceId', { workspaceId })
        .andWhere('person.consider = :consider', { consider: true })
        // Exclude pre-processed responses (not in manual coding pool)
        .andWhere(new Brackets(qb => {
          qb.where('response.code_v2 IS NULL')
            .orWhere(subQuery => {
              const exists = subQuery
                .subQuery()
                .select('1')
                .from('coding_job_unit', 'cju')
                .where('cju.response_id = response.id')
                .getQuery();
              return `EXISTS (${exists})`;
            });
        }))
        .groupBy('unit.name')
        .addGroupBy('response.variableid');
      applyResolvedExclusionsToQuery(incompleteVariablesQuery, exclusions, { parameterPrefix: 'variableCoverage' });
      const incompleteVariablesResult = await incompleteVariablesQuery.getRawMany();

      const variablesNeedingCoding = new Set<string>();
      const variableCaseCounts: {
        unitName: string;
        variableId: string;
        caseCount: number;
      }[] = [];

      incompleteVariablesResult.forEach(row => {
        const variableKey = `${row.unitName}:${row.variableId}`;
        variablesNeedingCoding.add(variableKey);
        variableCaseCounts.push({
          unitName: row.unitName,
          variableId: row.variableId,
          caseCount: parseInt(row.caseCount, 10)
        });
      });

      const jobDefinitions = await this.jobDefinitionRepository.find({
        where: { workspace_id: workspaceId }
      });

      const coveredVariables = new Set<string>();
      const coverageByStatus = {
        draft: new Set<string>(),
        pending_review: new Set<string>(),
        approved: new Set<string>()
      };

      const variableToDefinitions = new Map<
      string,
      Array<{ id: number; status: string }>
      >();

      for (const definition of jobDefinitions) {
        const definitionVariables = new Set<string>();

        if (definition.assigned_variables) {
          definition.assigned_variables.forEach(variable => {
            const variableKey = `${variable.unitName}:${variable.variableId}`;
            if (variablesNeedingCoding.has(variableKey)) {
              definitionVariables.add(variableKey);
            }
          });
        }

        if (definition.assigned_variable_bundles) {
          const bundleIds = definition.assigned_variable_bundles.map(
            bundle => bundle.id
          );
          const variableBundles = await this.variableBundleRepository.find({
            where: { id: In(bundleIds) }
          });

          variableBundles.forEach(bundle => {
            if (bundle.variables) {
              bundle.variables.forEach(variable => {
                const variableKey = `${variable.unitName}:${variable.variableId}`;
                if (variablesNeedingCoding.has(variableKey)) {
                  definitionVariables.add(variableKey);
                }
              });
            }
          });
        }

        definitionVariables.forEach(variableKey => {
          coveredVariables.add(variableKey);
          coverageByStatus[definition.status].add(variableKey);

          if (!variableToDefinitions.has(variableKey)) {
            variableToDefinitions.set(variableKey, []);
          }
          variableToDefinitions.get(variableKey)!.push({
            id: definition.id,
            status: definition.status
          });
        });
      }

      // Get cases in jobs map for conflict detection
      const casesInJobsMap = await this.getVariableCasesInJobs(workspaceId);

      const conflictedVariables = new Map<
      string,
      Array<{ id: number; status: string }>
      >();
      variableToDefinitions.forEach((definitions, variableKey) => {
        if (definitions.length > 1) {
          // Only report as conflict if there aren't enough available cases
          const [unitName, variableId] = variableKey.split(':');
          const variableCaseInfo = variableCaseCounts.find(
            v => v.unitName === unitName && v.variableId === variableId
          );

          if (variableCaseInfo) {
            const casesInJobs =
              casesInJobsMap.get(
                `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
              ) || 0;
            const availableCases = variableCaseInfo.caseCount - casesInJobs;

            // Only mark as conflict if there are no available cases left
            if (availableCases <= 0) {
              conflictedVariables.set(variableKey, definitions);
            }
          }
        }
      });

      const missingVariables = new Set<string>();
      const partiallyAbgedeckteVariablen = new Set<string>();
      const fullyAbgedeckteVariablen = new Set<string>();

      variablesNeedingCoding.forEach(variableKey => {
        if (!coveredVariables.has(variableKey)) {
          missingVariables.add(variableKey);
          return;
        }

        // Check if variable is fully or partially covered based on cases in jobs
        const variableCaseInfo = variableCaseCounts.find(
          v => `${v.unitName}:${v.variableId}` === variableKey
        );

        if (variableCaseInfo) {
          const casesInJobs =
            casesInJobsMap.get(
              `${variableCaseInfo.unitName}::${variableCaseInfo.variableId}`
            ) || 0;

          if (casesInJobs >= variableCaseInfo.caseCount) {
            fullyAbgedeckteVariablen.add(variableKey);
          } else if (casesInJobs > 0) {
            partiallyAbgedeckteVariablen.add(variableKey);
          }
        }
      });

      const totalVariables = variablesNeedingCoding.size;
      const coveredCount = coveredVariables.size;
      const draftCount = coverageByStatus.draft.size;
      const pendingReviewCount = coverageByStatus.pending_review.size;
      const approvedCount = coverageByStatus.approved.size;
      const conflictCount = conflictedVariables.size;
      const missingCount = missingVariables.size;
      const partiallyAbgedeckteCount = partiallyAbgedeckteVariablen.size;
      const fullyAbgedeckteCount = fullyAbgedeckteVariablen.size;
      const coveragePercentage =
        totalVariables > 0 ? (coveredCount / totalVariables) * 100 : 0;

      this.logger.log(
        `Variable coverage for workspace ${workspaceId}: ${coveredCount}/${totalVariables} CODING_INCOMPLETE variables covered (${coveragePercentage.toFixed(
          1
        )}%) - Draft: ${draftCount}, Pending: ${pendingReviewCount}, Approved: ${approvedCount}, Conflicted: ${conflictCount}, Fully covered: ${fullyAbgedeckteCount}, Partially covered: ${partiallyAbgedeckteCount}`
      );

      return {
        totalVariables,
        coveredVariables: coveredCount,
        coveredByDraft: draftCount,
        coveredByPendingReview: pendingReviewCount,
        coveredByApproved: approvedCount,
        conflictedVariables: conflictCount,
        missingVariables: missingCount,
        partiallyAbgedeckteVariablen: partiallyAbgedeckteCount,
        fullyAbgedeckteVariablen: fullyAbgedeckteCount,
        coveragePercentage,
        variableCaseCounts,
        coverageByStatus: {
          draft: Array.from(coverageByStatus.draft),
          pending_review: Array.from(coverageByStatus.pending_review),
          approved: Array.from(coverageByStatus.approved),
          conflicted: Array.from(conflictedVariables.entries()).map(
            ([variableKey, definitions]) => ({
              variableKey,
              conflictingDefinitions: definitions
            })
          )
        }
      };
    } catch (error) {
      this.logger.error(
        `Error getting variable coverage overview: ${error.message}`,
        error.stack
      );
      throw new Error(
        'Could not get variable coverage overview. Please check the database connection.'
      );
    }
  }

  private async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    const query = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .addSelect('COUNT(DISTINCT cju.response_id)', 'casesInJobs')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.training_id IS NULL')
      .groupBy('cju.unit_name')
      .addGroupBy('cju.variable_id');
    applyResolvedExclusionsToQuery(query, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix: 'variableCasesInJobs'
    });
    const rawResults = await query.getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }
}
