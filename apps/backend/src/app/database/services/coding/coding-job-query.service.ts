import {
  BadRequestException, Injectable, NotFoundException, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, Not, IsNull, EntityManager, SelectQueryBuilder, Brackets, ILike
} from 'typeorm';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { applyResolvedExclusionsToQuery, isExcludedByResolvedExclusions, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { formatCodingTestPersonFromUnit, generateCodingProgressKey } from './coding-progress-key.util';
import { CodingJobFreshnessImpactDto } from '../../../../../../../api-dto/coding/job-refresh.dto';
import { applyNonCodingIssueReviewJobFilter, CODING_JOB_TYPE_CODING_ISSUE_REVIEW, isCodingIssueReviewJobType } from './coding-job-type.util';
import {
  CodingJobIssueSummary, CodingJobListFilters, CodingJobCountRow, JOB_DEFINITION_DELETE_READY_STATUSES
} from './coding-job.types';

@Injectable()
export class CodingJobQueryService {
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobCoder)
    private readonly codingJobCoderRepository: Repository<CodingJobCoder>,
    @InjectRepository(CodingJobVariable)
    private readonly codingJobVariableRepository: Repository<CodingJobVariable>,
    @InjectRepository(CodingJobVariableBundle)
    private readonly codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    @InjectRepository(VariableBundle)
    private readonly variableBundleRepository: Repository<VariableBundle>,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    @Optional() private readonly codingFreshnessService?: CodingFreshnessService
  ) {}

  async applyCodingJobUnitExclusions<T>(
    queryBuilder: SelectQueryBuilder<T>,
    workspaceId: number,
    parameterPrefix: string
  ): Promise<void> {
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    applyResolvedExclusionsToQuery(queryBuilder, exclusions, {
      unitNameExpression: 'cju.unit_name',
      bookletNameExpression: 'cju.booklet_name',
      parameterPrefix
    });
  }

  async getVisibleCodingJobUnits(
    codingJobId: number,
    workspaceId: number
  ): Promise<CodingJobUnit[]> {
    const codingJobUnits = await this.codingJobUnitRepository.find({
      where: { coding_job_id: codingJobId }
    });
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        workspaceId
      );
    return codingJobUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );
  }

  isCodingIssueReviewJob(
    codingJob: Pick<CodingJob, 'job_type'> | null | undefined
  ): boolean {
    return isCodingIssueReviewJobType(codingJob?.job_type);
  }

  applyNonCodingIssueReviewJobFilter<T>(
    queryBuilder: SelectQueryBuilder<T>,
    jobAlias: string,
    parameterName: string
  ): void {
    applyNonCodingIssueReviewJobFilter(queryBuilder, jobAlias, parameterName);
  }

  withoutCodingIssueReviewJobWhere(
    baseWhere: Record<string, unknown>
  ): Record<string, unknown>[] {
    return [
      { ...baseWhere, job_type: IsNull() },
      {
        ...baseWhere,
        job_type: Not(CODING_JOB_TYPE_CODING_ISSUE_REVIEW)
      }
    ];
  }

  getCodingJobUnitProgressKey(unit: CodingJobUnit): string {
    return generateCodingProgressKey(
      formatCodingTestPersonFromUnit(unit),
      unit.unit_name,
      unit.variable_id
    );
  }

  codingJobUnitRequiresIssueReview(unit: CodingJobUnit): boolean {
    return unit.coding_issue_option === -1 ||
      unit.coding_issue_option === -2 ||
      unit.code === -1 ||
      unit.code === -2;
  }

  codingJobUnitResolvesIssueReview(unit: CodingJobUnit): boolean {
    return !unit.is_open &&
      unit.code !== null &&
      !this.codingJobUnitRequiresIssueReview(unit);
  }

  codingJobUnitCanOverlayIssueReview(unit: CodingJobUnit): boolean {
    return unit.is_open || unit.code !== null;
  }

  isUniqueConstraintViolation(error: unknown): boolean {
    const queryError = error as {
      code?: string;
      driverError?: { code?: string };
    };

    return queryError.code === '23505' ||
      queryError.driverError?.code === '23505';
  }

  codingJobUnitHasRegularCode(unit: CodingJobUnit): boolean {
    return unit.code !== null && unit.code >= 0;
  }

  assertCodingIssueReviewSourceUnit(unit: CodingJobUnit): void {
    if (!this.codingJobUnitRequiresIssueReview(unit)) {
      throw new BadRequestException(
        'Coding issue review can only be saved for units that require review'
      );
    }
  }

  assertCodingIssueReviewSourceJobStatus(
    sourceCodingJob: Pick<CodingJob, 'status'>
  ): void {
    if (sourceCodingJob.status !== 'review') {
      throw new BadRequestException(
        'Coding issue review can only be saved for coding jobs submitted for review'
      );
    }
  }

  async getCodingIssueReviewJobsForSource(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id'>
  ): Promise<CodingJob[]> {
    return (await this.codingJobRepository.find({
      where: {
        workspace_id: sourceCodingJob.workspace_id,
        job_type: CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
        source_coding_job_id: sourceCodingJob.id
      },
      relations: ['codingJobCoders']
    })) ?? [];
  }

  async getCodingIssueReviewUnitsForSource(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id'>
  ): Promise<CodingJobUnit[]> {
    const reviewJobs =
      await this.getCodingIssueReviewJobsForSource(sourceCodingJob);
    const reviewJobIds = reviewJobs.map(job => job.id);

    if (reviewJobIds.length === 0) {
      return [];
    }

    const reviewUnits = (await this.codingJobUnitRepository.find({
      where: { coding_job_id: In(reviewJobIds) },
      order: {
        updated_at: 'ASC',
        id: 'ASC'
      }
    })) ?? [];
    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        sourceCodingJob.workspace_id
      );

    return reviewUnits.filter(
      unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )
    );
  }

  async applyCodingIssueReviewOverlays(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id' | 'job_type'>,
    sourceUnits: CodingJobUnit[]
  ): Promise<CodingJobUnit[]> {
    if (this.isCodingIssueReviewJob(sourceCodingJob)) {
      return sourceUnits;
    }

    const sourceIssueKeys = new Set(
      sourceUnits
        .filter(unit => this.codingJobUnitRequiresIssueReview(unit))
        .map(unit => this.getCodingJobUnitProgressKey(unit))
    );

    if (sourceIssueKeys.size === 0) {
      return sourceUnits;
    }

    const reviewUnits =
      await this.getCodingIssueReviewUnitsForSource(sourceCodingJob);
    const reviewUnitsByKey = new Map(
      reviewUnits
        .filter(unit => (
          this.codingJobUnitCanOverlayIssueReview(unit) &&
          sourceIssueKeys.has(this.getCodingJobUnitProgressKey(unit))
        ))
        .map(unit => [this.getCodingJobUnitProgressKey(unit), unit])
    );

    if (reviewUnitsByKey.size === 0) {
      return sourceUnits;
    }

    return sourceUnits.map(unit => {
      if (!this.codingJobUnitRequiresIssueReview(unit)) {
        return unit;
      }

      const reviewUnit = reviewUnitsByKey.get(
        this.getCodingJobUnitProgressKey(unit)
      );
      if (!reviewUnit) {
        return unit;
      }

      if (!reviewUnit.is_open) {
        return reviewUnit;
      }

      return {
        ...reviewUnit,
        code: unit.code,
        score: unit.score,
        coding_issue_option: unit.coding_issue_option
      } as CodingJobUnit;
    });
  }

  async getEffectiveVisibleCodingJobUnits(
    codingJob: Pick<CodingJob, 'id' | 'workspace_id' | 'job_type'>
  ): Promise<CodingJobUnit[]> {
    const codingJobUnits = await this.getVisibleCodingJobUnits(
      codingJob.id,
      codingJob.workspace_id
    );

    return this.applyCodingIssueReviewOverlays(codingJob, codingJobUnits);
  }

  async getCodingIssueReviewResponseIdsByReviewUnit(
    codingJobId: number,
    matchesReviewUnit: (unit: CodingJobUnit) => boolean
  ): Promise<number[]> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId },
      select: ['id', 'workspace_id', 'job_type']
    });

    if (!codingJob || this.isCodingIssueReviewJob(codingJob)) {
      return [];
    }

    const sourceUnits = await this.getVisibleCodingJobUnits(
      codingJob.id,
      codingJob.workspace_id
    );
    const issueUnits = sourceUnits.filter(unit => (
      this.codingJobUnitRequiresIssueReview(unit)
    ));

    if (issueUnits.length === 0) {
      return [];
    }

    const issueKeys = new Set(
      issueUnits.map(unit => this.getCodingJobUnitProgressKey(unit))
    );
    const reviewUnits =
      await this.getCodingIssueReviewUnitsForSource(codingJob);
    const reviewUnitsByKey = new Map(
      reviewUnits
        .filter(unit => (
          this.codingJobUnitCanOverlayIssueReview(unit) &&
          issueKeys.has(this.getCodingJobUnitProgressKey(unit))
        ))
        .map(unit => [this.getCodingJobUnitProgressKey(unit), unit])
    );
    const responseIds = Array.from(reviewUnitsByKey.values())
      .filter(matchesReviewUnit)
      .map(unit => unit.response_id);

    return Array.from(new Set(responseIds));
  }

  async getResolvedCodingIssueReviewResponseIds(
    codingJobId: number
  ): Promise<number[]> {
    return this.getCodingIssueReviewResponseIdsByReviewUnit(
      codingJobId,
      unit => this.codingJobUnitResolvesIssueReview(unit)
    );
  }

  async getOpenCodingIssueReviewResponseIds(
    codingJobId: number
  ): Promise<number[]> {
    return this.getCodingIssueReviewResponseIdsByReviewUnit(
      codingJobId,
      unit => unit.is_open
    );
  }

  async getCodingJobProgress(
    jobId: number,
    manager?: EntityManager
  ): Promise<{ progress: number; coded: number; total: number; open: number }> {
    const codingJobRepository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const codingJobUnitRepository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const codingJob = await codingJobRepository.findOne({
      where: { id: jobId },
      select: ['id', 'workspace_id']
    });

    if (!codingJob) {
      return {
        progress: 0,
        coded: 0,
        total: 0,
        open: 0
      };
    }

    const totalUnitsQuery = codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId });
    await this.applyCodingJobUnitExclusions(
      totalUnitsQuery,
      codingJob.workspace_id,
      'codingJobProgressTotal'
    );
    const totalUnits = await totalUnitsQuery.getCount();

    if (totalUnits === 0) {
      return {
        progress: 0,
        coded: 0,
        total: 0,
        open: 0
      };
    }

    const codedUnitsQuery = codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId })
      .andWhere('cju.code IS NOT NULL');
    await this.applyCodingJobUnitExclusions(
      codedUnitsQuery,
      codingJob.workspace_id,
      'codingJobProgressCoded'
    );

    const openUnitsQuery = codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :jobId', { jobId })
      .andWhere('cju.is_open = :isOpen', { isOpen: true });
    await this.applyCodingJobUnitExclusions(
      openUnitsQuery,
      codingJob.workspace_id,
      'codingJobProgressOpen'
    );

    const [codedUnits, openUnits] = await Promise.all([
      codedUnitsQuery.getCount(),
      openUnitsQuery.getCount()
    ]);

    const progress =
      totalUnits > 0 ?
        Math.round((Math.min(totalUnits, codedUnits) / totalUnits) * 100) :
        0;

    return {
      progress,
      coded: codedUnits,
      total: totalUnits,
      open: openUnits
    };
  }

  async getCodingJobProgressByJobIds(
    jobIds: number[],
    workspaceId: number
  ): Promise<
    Map<
    number,
    { progress: number; coded: number; total: number; open: number }
    >
    > {
    const progressByJobId = new Map<
    number,
    { progress: number; coded: number; total: number; open: number }
    >();
    jobIds.forEach(jobId => progressByJobId.set(jobId, {
      progress: 0,
      coded: 0,
      total: 0,
      open: 0
    })
    );

    if (jobIds.length === 0) {
      return progressByJobId;
    }

    const progressQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('cju.coding_job_id', 'jobId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('COUNT(*) FILTER (WHERE cju.code IS NOT NULL)', 'coded')
      .addSelect('COUNT(*) FILTER (WHERE cju.is_open = true)', 'open')
      .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
      .groupBy('cju.coding_job_id');
    await this.applyCodingJobUnitExclusions(
      progressQuery,
      workspaceId,
      'codingJobsProgress'
    );

    const progressRows = await progressQuery.getRawMany<{
      jobId: string | number;
      total: string | number;
      coded: string | number;
      open: string | number;
    }>();

    progressRows.forEach(row => {
      const jobId = Number(row.jobId);
      const total = Number(row.total || 0);
      const coded = Number(row.coded || 0);
      const open = Number(row.open || 0);
      progressByJobId.set(jobId, {
        progress:
          total > 0 ? Math.round((Math.min(total, coded) / total) * 100) : 0,
        coded,
        total,
        open
      });
    });

    return progressByJobId;
  }

  async getAssignedCodingJobIds(
    workspaceId: number,
    userId: number
  ): Promise<number[]> {
    const rowsQuery = this.codingJobCoderRepository
      .createQueryBuilder('coder')
      .select('coder.coding_job_id', 'codingJobId')
      .innerJoin('coder.coding_job', 'coding_job')
      .where('coder.user_id = :userId', { userId })
      .andWhere('coding_job.workspace_id = :workspaceId', { workspaceId });
    this.applyNonCodingIssueReviewJobFilter(
      rowsQuery,
      'coding_job',
      'assignedCodingJobsReviewMarker'
    );
    const rows = await rowsQuery
      .getRawMany<{ codingJobId: string | number }>();

    return Array.from(
      new Set(rows.map(row => Number(row.codingJobId)))
    ).filter(jobId => Number.isFinite(jobId));
  }

  intersectJobIdSets(jobIdSets: number[][]): number[] | undefined {
    if (jobIdSets.length === 0) {
      return undefined;
    }

    const intersection = jobIdSets
      .map(jobIds => new Set(jobIds))
      .reduce(
        (currentIntersection, jobIds) => new Set([...currentIntersection].filter(jobId => jobIds.has(jobId)))
      );

    return [...intersection];
  }

  normalizeJobNameFilter(jobName?: string): string | undefined {
    const normalized = jobName?.trim();
    return normalized || undefined;
  }

  getCodingJobListOrder(
    filters: CodingJobListFilters
  ): Record<string, 'ASC' | 'DESC'> {
    const direction = filters.sortDirection === 'asc' ? 'ASC' : 'DESC';

    switch (filters.sortBy) {
      case 'name':
        return { name: direction };
      case 'description':
        return { description: direction };
      case 'status':
        return { status: direction };
      case 'updatedAt':
        return { updated_at: direction };
      case 'createdAt':
      default:
        return { created_at: direction };
    }
  }

  applyCodingJobListFiltersToOpenUnitsQuery<T>(
    queryBuilder: SelectQueryBuilder<T>,
    filters: CodingJobListFilters,
    filteredJobIds?: number[]
  ): void {
    if (filteredJobIds) {
      queryBuilder.andWhere('coding_job.id IN (:...filteredJobIds)', {
        filteredJobIds
      });
    }
    if (filters.status) {
      queryBuilder.andWhere('coding_job.status = :status', {
        status: filters.status
      });
    } else if (filters.excludeStatus) {
      queryBuilder.andWhere('coding_job.status != :excludeStatus', {
        excludeStatus: filters.excludeStatus
      });
    }
    const normalizedJobName = this.normalizeJobNameFilter(filters.jobName);
    if (normalizedJobName) {
      queryBuilder.andWhere('coding_job.name ILIKE :jobName', {
        jobName: `%${normalizedJobName}%`
      });
    }
    if (filters.scope === 'training') {
      queryBuilder.andWhere('coding_job.training_id IS NOT NULL');
    } else if (filters.scope === 'productive') {
      queryBuilder.andWhere('coding_job.training_id IS NULL');
    }
    if (filters.trainingId === 'none') {
      queryBuilder.andWhere('coding_job.training_id IS NULL');
    } else if (typeof filters.trainingId === 'number') {
      queryBuilder.andWhere('coding_job.training_id = :trainingId', {
        trainingId: filters.trainingId
      });
    }
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'codingJobOpenUnitsReviewMarker'
    );
  }

  async getCodingJobIssueSummariesByJobIds(
    jobIds: number[],
    workspaceId: number
  ): Promise<Map<number, CodingJobIssueSummary>> {
    const summaries = new Map<number, CodingJobIssueSummary>();
    jobIds.forEach(jobId => summaries.set(jobId, {
      total: 0,
      open: 0,
      codeAssignmentUncertain: 0,
      newCodeNeeded: 0
    })
    );

    if (jobIds.length === 0) {
      return summaries;
    }

    const visibleIssueUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id IN (:...jobIds)', { jobIds })
      .andWhere(new Brackets(qb => {
        qb.where('cju.is_open = true')
          .orWhere(
            `(
              cju.is_open = false AND
              (
                cju.coding_issue_option IN (:...issueReviewCodes) OR
                cju.code IN (:...issueReviewCodes)
              )
            )`,
            { issueReviewCodes: [-1, -2] }
          );
      }));
    await this.applyCodingJobUnitExclusions(
      visibleIssueUnitsQuery,
      workspaceId,
      'codingJobsIssueSummary'
    );

    const sourceUnits = await visibleIssueUnitsQuery.getMany();
    const sourceIssueUnitsByJobId = new Map<number, CodingJobUnit[]>();
    const sourceIssueKeysByJobId = new Map<number, Set<string>>();

    sourceUnits.forEach(unit => {
      const summary = summaries.get(unit.coding_job_id);
      if (!summary) {
        return;
      }

      if (unit.is_open) {
        summary.open += 1;
        return;
      }

      if (!this.codingJobUnitRequiresIssueReview(unit)) {
        return;
      }

      const sourceIssueUnits =
        sourceIssueUnitsByJobId.get(unit.coding_job_id) ?? [];
      sourceIssueUnits.push(unit);
      sourceIssueUnitsByJobId.set(unit.coding_job_id, sourceIssueUnits);

      const sourceIssueKeys =
        sourceIssueKeysByJobId.get(unit.coding_job_id) ?? new Set<string>();
      sourceIssueKeys.add(this.getCodingJobUnitProgressKey(unit));
      sourceIssueKeysByJobId.set(unit.coding_job_id, sourceIssueKeys);
    });

    if (sourceIssueUnitsByJobId.size === 0) {
      return summaries;
    }

    const sourceIssueJobIds = Array.from(sourceIssueUnitsByJobId.keys());
    const reviewJobs = (await this.codingJobRepository.find({
      where: {
        workspace_id: workspaceId,
        job_type: CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
        source_coding_job_id: In(sourceIssueJobIds)
      },
      select: ['id', 'source_coding_job_id']
    })) ?? [];
    const reviewJobSourceJobIds = new Map<number, number>();
    reviewJobs.forEach(job => {
      if (job.source_coding_job_id !== null &&
          job.source_coding_job_id !== undefined
      ) {
        reviewJobSourceJobIds.set(job.id, job.source_coding_job_id);
      }
    });

    const reviewUnitsBySourceJobAndKey = new Map<string, CodingJobUnit>();
    const reviewJobIds = Array.from(reviewJobSourceJobIds.keys());

    if (reviewJobIds.length > 0) {
      const reviewUnits = (await this.codingJobUnitRepository.find({
        where: { coding_job_id: In(reviewJobIds) },
        order: {
          updated_at: 'ASC',
          id: 'ASC'
        }
      })) ?? [];
      const exclusions =
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId
        );

      reviewUnits.forEach(unit => {
        const sourceJobId = reviewJobSourceJobIds.get(unit.coding_job_id);
        if (!sourceJobId) {
          return;
        }

        if (isExcludedByResolvedExclusions(
          exclusions,
          unit.booklet_name,
          unit.unit_name
        )) {
          return;
        }

        const progressKey = this.getCodingJobUnitProgressKey(unit);
        if (!sourceIssueKeysByJobId.get(sourceJobId)?.has(progressKey)) {
          return;
        }

        if (this.codingJobUnitCanOverlayIssueReview(unit)) {
          reviewUnitsBySourceJobAndKey.set(
            `${sourceJobId}:${progressKey}`,
            unit
          );
        }
      });
    }

    sourceIssueUnitsByJobId.forEach((sourceIssueUnits, jobId) => {
      const summary = summaries.get(jobId);
      if (!summary) {
        return;
      }

      sourceIssueUnits.forEach(sourceUnit => {
        const progressKey = this.getCodingJobUnitProgressKey(sourceUnit);
        const effectiveUnit =
          reviewUnitsBySourceJobAndKey.get(`${jobId}:${progressKey}`) ??
          sourceUnit;
        const issueOption =
          effectiveUnit.is_open ?
            sourceUnit.coding_issue_option ?? sourceUnit.code :
            effectiveUnit.coding_issue_option ?? effectiveUnit.code;

        if (effectiveUnit.is_open) {
          summary.open += 1;
        }

        if (issueOption === -1) {
          summary.codeAssignmentUncertain += 1;
        } else if (issueOption === -2) {
          summary.newCodeNeeded += 1;
        }
      });

      summary.total = summary.codeAssignmentUncertain + summary.newCodeNeeded;
    });

    return summaries;
  }

  async getCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> {
    const uniqueDefinitionIds = Array.from(
      new Set(
        definitionIds.filter(definitionId => Number.isFinite(definitionId))
      )
    );

    if (uniqueDefinitionIds.length === 0) {
      return new Map();
    }

    const queryBuilder = this.codingJobRepository
      .createQueryBuilder('coding_job')
      .select('coding_job.job_definition_id', 'jobDefinitionId')
      .addSelect('COUNT(coding_job.id)', 'jobsCount')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id IN (:...definitionIds)', {
        definitionIds: uniqueDefinitionIds
      })
      .groupBy('coding_job.job_definition_id');
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'codingJobCountsReviewMarker'
    );
    const rows: CodingJobCountRow[] = await queryBuilder.getRawMany();

    return new Map(
      rows.map(row => [Number(row.jobDefinitionId), Number(row.jobsCount)])
    );
  }

  async getBlockingCodingJobCountsByDefinitionIds(
    workspaceId: number,
    definitionIds: number[]
  ): Promise<Map<number, number>> {
    const uniqueDefinitionIds = Array.from(
      new Set(
        definitionIds.filter(definitionId => Number.isFinite(definitionId))
      )
    );

    if (uniqueDefinitionIds.length === 0) {
      return new Map();
    }

    const queryBuilder = this.codingJobRepository
      .createQueryBuilder('coding_job')
      .select('coding_job.job_definition_id', 'jobDefinitionId')
      .addSelect('COUNT(coding_job.id)', 'jobsCount')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('coding_job.job_definition_id IN (:...definitionIds)', {
        definitionIds: uniqueDefinitionIds
      })
      .andWhere('coding_job.status NOT IN (:...deleteReadyStatuses)', {
        deleteReadyStatuses: JOB_DEFINITION_DELETE_READY_STATUSES
      })
      .groupBy('coding_job.job_definition_id');
    this.applyNonCodingIssueReviewJobFilter(
      queryBuilder,
      'coding_job',
      'blockingCodingJobCountsReviewMarker'
    );
    const rows: CodingJobCountRow[] = await queryBuilder.getRawMany();

    return new Map(
      rows.map(row => [Number(row.jobDefinitionId), Number(row.jobsCount)])
    );
  }

  async getCodingJobFreshnessImpact(
    workspaceId: number,
    codingJobId: number
  ): Promise<CodingJobFreshnessImpactDto> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId, workspace_id: workspaceId }
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${codingJobId} not found`
      );
    }

    const countsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .select('COUNT(DISTINCT cju.response_id)', 'totalResponses')
      .addSelect(
        'COUNT(DISTINCT CASE WHEN cju.code IS NOT NULL OR cju.score IS NOT NULL THEN cju.response_id END)',
        'codedResponses'
      )
      .addSelect(
        'COUNT(DISTINCT CASE WHEN cju.is_open = true THEN cju.response_id END)',
        'openResponses'
      )
      .where('cju.coding_job_id = :codingJobId', { codingJobId });

    await this.applyCodingJobUnitExclusions(
      countsQuery,
      workspaceId,
      'codingJobFreshnessImpact'
    );
    const counts = await countsQuery.getRawOne<{
      totalResponses?: string | number;
      codedResponses?: string | number;
      openResponses?: string | number;
    }>();

    return {
      codingJobId,
      freshnessStatus: codingJob.freshness_status || 'current',
      freshnessReason: codingJob.freshness_reason || null,
      freshnessUpdatedAt: codingJob.freshness_updated_at?.toISOString() || null,
      affectedUnits: Number(codingJob.freshness_affected_units || 0),
      affectedResponses: Number(codingJob.freshness_affected_responses || 0),
      totalResponses: Number(counts?.totalResponses || 0),
      codedResponses: Number(counts?.codedResponses || 0),
      openResponses: Number(counts?.openResponses || 0)
    };
  }

  async getCodingJob(
    id: number,
    workspaceId?: number
  ): Promise<{
      codingJob: CodingJob & { durationSeconds?: number };
      assignedCoders: number[];
      variables: { unitName: string; variableId: string }[];
      variableBundles: VariableBundle[];
    }> {
    const whereClause: { id: number; workspace_id?: number } = { id };

    if (workspaceId !== undefined) {
      whereClause.workspace_id = workspaceId;
    }

    const codingJob = await this.codingJobRepository.findOne({
      where: whereClause,
      relations: ['training']
    });
    if (!codingJob) {
      if (workspaceId !== undefined) {
        throw new NotFoundException(
          `Coding job with ID ${id} not found in workspace ${workspaceId}`
        );
      } else {
        throw new NotFoundException(`Coding job with ID ${id} not found`);
      }
    }

    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    let variables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    const codingJobVariableBundles =
      await this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: id }
      });
    const variableBundleIds = codingJobVariableBundles.map(
      bundle => bundle.variable_bundle_id
    );
    const variableBundles = await this.variableBundleRepository.find({
      where: { id: In(variableBundleIds) }
    });

    // Include variables from bundles
    const bundleVariables = variableBundles.flatMap(
      bundle => bundle.variables || []
    );
    variables = [...variables, ...bundleVariables];

    return {
      codingJob,
      assignedCoders,
      variables,
      variableBundles
    };
  }

  async getCodingJobByIdForWorkspace(
    id: number,
    workspaceId: number,
    manager?: EntityManager
  ): Promise<CodingJob> {
    const codingJob = await this.getCodingJobRepository(manager).findOne({
      where: { id, workspace_id: workspaceId },
      relations: ['training']
    });

    if (!codingJob) {
      throw new NotFoundException(
        `Coding job with ID ${id} not found in workspace ${workspaceId}`
      );
    }

    return codingJob;
  }

  getCodingJobRepository(
    manager?: EntityManager
  ): Repository<CodingJob> {
    return manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
  }

  async getCodingJobsByCoder(coderId: number): Promise<CodingJob[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { user_id: coderId },
      relations: ['coding_job']
    });

    return codingJobCoders
      .map(cjc => cjc.coding_job)
      .filter(codingJob => !this.isCodingIssueReviewJob(codingJob));
  }

  async getCodersByJobId(jobId: number): Promise<number[]> {
    const codingJobCoders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: jobId }
    });

    return codingJobCoders.map(cjc => cjc.user_id);
  }

  async getCodingJobById(id: number): Promise<
  CodingJob & {
    assignedCoders?: number[];
    assignedVariables?: { unitName: string; variableId: string }[];
    assignedVariableBundles?: {
      name: string;
      variables: { unitName: string; variableId: string }[];
    }[];
    variables?: { unitName: string; variableId: string }[];
    variableBundles?: {
      name: string;
      variables: { unitName: string; variableId: string }[];
    }[];
  }
  > {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id },
      relations: ['training']
    });

    if (!codingJob) {
      throw new NotFoundException(`Coding job with ID ${id} not found`);
    }

    const coders = await this.codingJobCoderRepository.find({
      where: { coding_job_id: id }
    });
    const assignedCoders = coders.map(coder => coder.user_id);

    const codingJobVariables = await this.codingJobVariableRepository.find({
      where: { coding_job_id: id }
    });
    const assignedVariables = codingJobVariables.map(variable => ({
      unitName: variable.unit_name,
      variableId: variable.variable_id
    }));

    const codingJobVariableBundles =
      await this.codingJobVariableBundleRepository.find({
        where: { coding_job_id: id },
        relations: ['variable_bundle']
      });

    const assignedVariableBundles = codingJobVariableBundles
      .filter(bundle => bundle.variable_bundle)
      .map(bundle => ({
        name: bundle.variable_bundle.name,
        variables: bundle.variable_bundle.variables || []
      }));

    return {
      ...codingJob,
      assignedCoders,
      assignedVariables,
      assignedVariableBundles
    };
  }

  async hasCodingIssues(codingJobId: number): Promise<boolean> {
    const codingJob = await this.codingJobRepository.findOne({
      where: { id: codingJobId },
      select: ['id', 'workspace_id', 'job_type']
    });
    if (!codingJob) {
      return false;
    }

    const codingJobUnits = await this.getEffectiveVisibleCodingJobUnits(
      codingJob
    );

    return codingJobUnits.some(
      unit => this.codingJobUnitRequiresIssueReview(unit)
    );
  }

  async getVariableCasesInJobs(
    workspaceId: number
  ): Promise<Map<string, number>> {
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
    this.applyNonCodingIssueReviewJobFilter(
      query,
      'coding_job',
      'variableCasesReviewMarker'
    );
    await this.applyCodingJobUnitExclusions(
      query,
      workspaceId,
      'codingJobVariableCasesInJobs'
    );
    const rawResults = await query.getRawMany();

    const casesInJobsMap = new Map<string, number>();

    rawResults.forEach(row => {
      const key = `${row.unitName}::${row.variableId}`;
      casesInJobsMap.set(key, parseInt(row.casesInJobs, 10));
    });

    return casesInJobsMap;
  }

  async getCodingJobs(
    workspaceId: number,
    page: number = 1,
    limit?: number,
    assignedToUserId?: number,
    filters: CodingJobListFilters = {}
  ): Promise<{
      data: (CodingJob & {
        assignedCoders?: number[];
        assignedVariables?: { unitName: string; variableId: string }[];
        assignedVariableBundles?: {
          name: string;
          variables: { unitName: string; variableId: string }[];
        }[];
        progress?: number;
        codedUnits?: number;
        totalUnits?: number;
        openUnits?: number;
        hasIssues?: boolean;
        issueSummary?: CodingJobIssueSummary;
      })[];
      total: number;
      totalOpenUnits?: number;
      page: number;
      limit?: number;
    }> {
    const validPage = page > 0 ? page : 1;
    const shouldPaginate = limit !== undefined && limit > 0;
    const skip = shouldPaginate ? (validPage - 1) * limit : undefined;
    const take = shouldPaginate ? limit : undefined;
    const jobIdFilters: number[][] = [];
    if (assignedToUserId) {
      jobIdFilters.push(
        await this.getAssignedCodingJobIds(workspaceId, assignedToUserId)
      );
    }
    if (filters.coderId) {
      jobIdFilters.push(
        await this.getAssignedCodingJobIds(workspaceId, filters.coderId)
      );
    }
    const filteredJobIds = this.intersectJobIdSets(jobIdFilters);

    if (filteredJobIds && filteredJobIds.length === 0) {
      return {
        data: [],
        total: 0,
        totalOpenUnits: 0,
        page: validPage,
        limit
      };
    }

    await this.codingFreshnessService?.reconcileAppliedManualCodingJobs(
      workspaceId,
      'RESET',
      'current'
    );

    const jobWhere: Record<string, unknown> = { workspace_id: workspaceId };
    if (filteredJobIds) {
      jobWhere.id = In(filteredJobIds);
    }
    if (filters.status) {
      jobWhere.status = filters.status;
    } else if (filters.excludeStatus) {
      jobWhere.status = Not(filters.excludeStatus);
    }
    const normalizedJobName = this.normalizeJobNameFilter(filters.jobName);
    if (normalizedJobName) {
      jobWhere.name = ILike(`%${normalizedJobName}%`);
    }
    if (filters.scope === 'training') {
      jobWhere.training_id = Not(IsNull());
    } else if (filters.scope === 'productive') {
      jobWhere.training_id = IsNull();
    }
    if (filters.trainingId === 'none') {
      jobWhere.training_id = IsNull();
    } else if (typeof filters.trainingId === 'number') {
      jobWhere.training_id = filters.trainingId;
    }

    const visibleJobWhere = this.withoutCodingIssueReviewJobWhere(jobWhere);

    const total = await this.codingJobRepository.count({
      where: visibleJobWhere
    });

    const jobs = await this.codingJobRepository.find({
      where: visibleJobWhere,
      relations: ['training'],
      order: this.getCodingJobListOrder(filters),
      skip,
      take
    });

    const jobIds = jobs.map(job => job.id);

    const [
      allCoders,
      allVariables,
      variableBundleEntities,
      progressByJobId,
      issueSummaryByJobId
    ] =
      jobIds.length > 0 ?
        await Promise.all([
          this.codingJobCoderRepository.find({
            where: { coding_job_id: In(jobIds) }
          }),
          this.codingJobVariableRepository.find({
            where: { coding_job_id: In(jobIds) }
          }),
          this.codingJobVariableBundleRepository.find({
            where: { coding_job_id: In(jobIds) },
            relations: ['variable_bundle']
          }),
          this.getCodingJobProgressByJobIds(jobIds, workspaceId),
          filters.includeIssueSummary ?
            this.getCodingJobIssueSummariesByJobIds(jobIds, workspaceId) :
            Promise.resolve(new Map<number, CodingJobIssueSummary>())
        ]) :
        [
          [],
          [],
          [],
          new Map<
          number,
          { progress: number; coded: number; total: number; open: number }
          >(),
          new Map<number, CodingJobIssueSummary>()
        ];

    const codersByJobId = new Map<number, number[]>();
    allCoders.forEach(coder => {
      if (!codersByJobId.has(coder.coding_job_id)) {
        codersByJobId.set(coder.coding_job_id, []);
      }
      codersByJobId.get(coder.coding_job_id)!.push(coder.user_id);
    });

    const variablesByJobId = new Map<
    number,
    { unitName: string; variableId: string }[]
    >();
    allVariables.forEach(variable => {
      if (!variablesByJobId.has(variable.coding_job_id)) {
        variablesByJobId.set(variable.coding_job_id, []);
      }
      variablesByJobId.get(variable.coding_job_id)!.push({
        unitName: variable.unit_name,
        variableId: variable.variable_id
      });
    });

    const variableBundlesByJobId = new Map<
    number,
    { name: string; variables: { unitName: string; variableId: string }[] }[]
    >();
    variableBundleEntities.forEach(bundleAssignment => {
      if (!variableBundlesByJobId.has(bundleAssignment.coding_job_id)) {
        variableBundlesByJobId.set(bundleAssignment.coding_job_id, []);
      }
      if (bundleAssignment.variable_bundle?.name) {
        variableBundlesByJobId.get(bundleAssignment.coding_job_id)!.push({
          name: bundleAssignment.variable_bundle.name,
          variables: bundleAssignment.variable_bundle.variables || []
        });
      }
    });

    const data = jobs.map(job => {
      const progress = progressByJobId.get(job.id);
      const issueSummary = issueSummaryByJobId.get(job.id);
      return {
        ...job,
        assignedCoders: codersByJobId.get(job.id) || [],
        assignedVariables: variablesByJobId.get(job.id) || [],
        assignedVariableBundles: variableBundlesByJobId.get(job.id) || [],
        progress: progress?.progress || 0,
        codedUnits: progress?.coded || 0,
        totalUnits: progress?.total || 0,
        openUnits: progress?.open || 0,
        ...(issueSummary ?
          { issueSummary, hasIssues: issueSummary.total > 0 } :
          {})
      };
    });

    const totalOpenUnitsQuery = this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .leftJoin('cju.coding_job', 'coding_job')
      .where('coding_job.workspace_id = :workspaceId', { workspaceId })
      .andWhere('cju.is_open = :isOpen', { isOpen: true });
    this.applyCodingJobListFiltersToOpenUnitsQuery(
      totalOpenUnitsQuery,
      filters,
      filteredJobIds
    );
    await this.applyCodingJobUnitExclusions(
      totalOpenUnitsQuery,
      workspaceId,
      'codingJobsOpenUnits'
    );
    const totalOpenUnits = await totalOpenUnitsQuery.getCount();

    return {
      data,
      total,
      totalOpenUnits,
      page: validPage,
      limit
    };
  }
}
