import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In, Repository, SelectQueryBuilder, FindOperator, ObjectLiteral
} from 'typeorm';
import { CodingListService } from './coding-list.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import User from '../../entities/user.entity';
import { applyResolvedExclusionsToQuery, isExcludedByResolvedExclusions, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { createManualCodingVariablePairKeySet, createManualCodingVariableReferences, ManualCodingVariableReference } from '../../utils/manual-coding-candidate.util';
import { applyNonCodingIssueReviewJobFilter } from './coding-job-type.util';
import { ByVariableCombination, TrainingDiscussionExportResult } from './coding-export.types';

@Injectable()
export class CodingExportQueryService {
  private readonly logger = new Logger(CodingExportQueryService.name);

  constructor(
    @InjectRepository(ResponseEntity)
    private responseRepository: Repository<ResponseEntity>,
    @InjectRepository(CodingJobUnit)
    private codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(CoderTrainingDiscussionResult)
    private coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private codingListService: CodingListService,
    private workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async getExclusionChecker(workspaceId: number): Promise<(bookletName: string, unitName: string) => boolean> {
    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    return (bookletName: string, unitName: string) => !unitName || isExcludedByResolvedExclusions(exclusions, bookletName, unitName);
  }

  private async getManualCodingVariableReferences(
    workspaceId: number,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<ManualCodingVariableReference[]> {
    const {
      jobDefinitionIds: normalizedJobDefinitionIds,
      coderTrainingIds: normalizedCoderTrainingIds,
      coderIds: normalizedCoderIds
    } = this.normalizeJobFilters(jobDefinitionIds, coderTrainingIds, coderIds);
    const codingListVariables = await this.codingListService.getCodingListVariables(workspaceId);
    const manualJobVariables = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.unit_name', 'unitName')
      .addSelect('cju.variable_id', 'variableId')
      .innerJoin('cju.coding_job', 'cj')
      .where('cj.workspace_id = :workspaceId', { workspaceId })
      .distinct(true);
    this.applyJobFilters(
      manualJobVariables,
      normalizedJobDefinitionIds,
      normalizedCoderTrainingIds,
      normalizedCoderIds,
      'cju'
    );
    if (normalizedCoderTrainingIds.length === 0) {
      manualJobVariables.andWhere('cj.training_id IS NULL');
    }

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

  async getManualCodingVariableSet(
    workspaceId: number,
    jobDefinitionIds?: number[],
    coderTrainingIds?: number[],
    coderIds?: number[]
  ): Promise<Set<string>> {
    const manualCodingVariables = await this.getManualCodingVariableReferences(
      workspaceId,
      jobDefinitionIds,
      coderTrainingIds,
      coderIds
    );
    return createManualCodingVariablePairKeySet(manualCodingVariables);
  }

  async getByVariableCombinations(
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
        jobUnitVariableResultsQuery as SelectQueryBuilder<ObjectLiteral>,
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
        unitVariableResultsQuery as SelectQueryBuilder<ObjectLiteral>,
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

  async getTrainingDiscussionResultsMap(
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

  async getTrainingManagerUsernames(workspaceId: number, trainingIds?: number[]): Promise<string[]> {
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

  normalizeJobFilters(
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

  hasScopedJobFilters(
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

  getNoCodingResultsMessage(hasScopedJobFilters: boolean): string {
    return hasScopedJobFilters ?
      'Keine Kodierergebnisse für den gewählten Job-/Training-/Kodierer-Filter in diesem Workspace gefunden' :
      'Keine Kodierergebnisse für diesen Workspace gefunden';
  }

  applyJobFilters(
    query: SelectQueryBuilder<ObjectLiteral>,
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

  applySelectedCoderJoinFilter(
    query: SelectQueryBuilder<ObjectLiteral>,
    coderIds?: number[]
  ): void {
    const normalizedCoderIds = this.normalizeFilterIds(coderIds);
    if (normalizedCoderIds.length === 0) return;

    query.andWhere('cjc.user_id IN (:...selectedCoderIds)', {
      selectedCoderIds: normalizedCoderIds
    });
  }
}
