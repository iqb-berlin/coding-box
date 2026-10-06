import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, Connection, EntityManager, FindOneOptions
} from 'typeorm';
import { SaveCodingProgressDto } from '../../../admin/coding-job/dto/save-coding-progress.dto';
import { SaveCodingNotesDto } from '../../../admin/coding-job/dto/save-coding-notes.dto';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { isExcludedByResolvedExclusions, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { parseCodingTestPerson } from './coding-progress-key.util';
import { CODING_JOB_TYPE_CODING_ISSUE_REVIEW } from './coding-job-type.util';
import { CodingJobSchemeService } from './coding-job-scheme.service';
import { CodingJobQueryService } from './coding-job-query.service';

@Injectable()
export class CodingJobProgressService {
  constructor(
    @InjectRepository(CodingJob)
    private readonly codingJobRepository: Repository<CodingJob>,
    @InjectRepository(CodingJobUnit)
    private readonly codingJobUnitRepository: Repository<CodingJobUnit>,
    private readonly connection: Connection,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly scheme: CodingJobSchemeService,
    private readonly query: CodingJobQueryService
  ) {}

  async saveCodingProgress(
    codingJobId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> {
    return this.connection.transaction(async manager => {
      const codingJobRepository = manager.getRepository(CodingJob);
      const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
      const codingJob = await codingJobRepository.findOne({
        where: { id: codingJobId }
      });

      if (!codingJob) {
        throw new NotFoundException(
          `Coding job with ID ${codingJobId} not found`
        );
      }

      if (['review', 'results_applied'].includes(codingJob.status)) {
        throw new BadRequestException(
          `Cannot save progress for a coding job with status ${codingJob.status}`
        );
      }

      const codingJobUnit = await this.getCodingJobUnitForEntry(
        codingJob,
        progress,
        'Coding job unit not found for progress entry',
        manager,
        true
      );

      const selectedCode = await this.scheme.validateProgressSelectedCode(
        progress,
        codingJobUnit,
        codingJob.workspace_id,
        codingJob.allowComments !== false
      );

      this.applyProgressToCodingJobUnit(
        codingJobUnit,
        progress,
        selectedCode
      );

      await codingJobUnitRepository.save(codingJobUnit);

      await this.checkAndUpdateCodingJobCompletion(codingJobId, manager);

      return codingJob;
    });
  }

  applyProgressToCodingJobUnit(
    codingJobUnit: CodingJobUnit,
    progress: SaveCodingProgressDto,
    selectedCode: NonNullable<SaveCodingProgressDto['selectedCode']> | null
  ): void {
    if (progress.isOpen === true) {
      codingJobUnit.is_open = true;
      codingJobUnit.code = null;
      codingJobUnit.score = null;
      codingJobUnit.coding_issue_option = null;
    } else if (selectedCode === null) {
      codingJobUnit.code = null;
      codingJobUnit.score = null;
      codingJobUnit.coding_issue_option = null;
      codingJobUnit.is_open = false;
    } else {
      codingJobUnit.code = selectedCode.id;
      codingJobUnit.is_open = false;
      const score = selectedCode.score;
      if (score !== undefined && score !== null) {
        codingJobUnit.score = score;
      } else {
        codingJobUnit.score = null;
      }
      codingJobUnit.coding_issue_option =
        selectedCode.codingIssueOption ?? null;
    }

    if (progress.notes !== undefined) {
      codingJobUnit.notes = progress.notes || null;
    }
  }

  clearNewCodeNeededProgressWithoutNotes(
    codingJobUnit: CodingJobUnit
  ): boolean {
    if (codingJobUnit.notes) return false;
    if (
      codingJobUnit.coding_issue_option === -2 &&
      codingJobUnit.code !== null &&
      codingJobUnit.code >= 0
    ) {
      codingJobUnit.coding_issue_option = null;
      return false;
    }
    if (codingJobUnit.code !== -2 && codingJobUnit.coding_issue_option !== -2) {
      return false;
    }

    codingJobUnit.code = null;
    codingJobUnit.score = null;
    codingJobUnit.coding_issue_option = null;
    codingJobUnit.is_open = false;
    return true;
  }

  async reopenCodingJobAfterProgressCleared(
    codingJob: CodingJob,
    manager?: EntityManager
  ): Promise<void> {
    if (!['completed', 'open'].includes(codingJob.status)) return;
    const codingJobRepository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    await codingJobRepository.update(codingJob.id, { status: 'active' });
  }

  getCodingJobUnitWhereForEntry(
    codingJobId: number,
    entry: Pick<SaveCodingProgressDto, 'testPerson' | 'unitId' | 'variableId'>
  ): Partial<CodingJobUnit> {
    const {
      login: personLogin,
      code: personCode,
      group: personGroup,
      booklet: bookletName
    } = parseCodingTestPerson(entry.testPerson);

    const whereCondition: Partial<CodingJobUnit> = {
      coding_job_id: codingJobId,
      unit_name: entry.unitId,
      variable_id: entry.variableId,
      person_login: personLogin,
      person_code: personCode,
      booklet_name: bookletName
    };

    if (personGroup !== undefined) {
      whereCondition.person_group = personGroup;
    }

    return whereCondition;
  }

  async getCodingJobUnitForEntry(
    codingJob: Pick<CodingJob, 'id' | 'workspace_id'>,
    entry: Pick<SaveCodingProgressDto, 'testPerson' | 'unitId' | 'variableId'>,
    notFoundMessage: string,
    manager?: EntityManager,
    lockRows = false
  ): Promise<CodingJobUnit> {
    const codingJobUnitRepository = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const findOptions: FindOneOptions<CodingJobUnit> = {
      where: this.getCodingJobUnitWhereForEntry(codingJob.id, entry)
    };

    if (lockRows) {
      findOptions.lock = { mode: 'pessimistic_write' };
    }

    const codingJobUnit = await codingJobUnitRepository.findOne(findOptions);

    if (!codingJobUnit) {
      throw new NotFoundException(notFoundMessage);
    }

    const exclusions =
      await this.workspaceExclusionService.resolveExclusionsForQueries(
        codingJob.workspace_id
      );
    if (
      isExcludedByResolvedExclusions(
        exclusions,
        codingJobUnit.booklet_name,
        codingJobUnit.unit_name
      )
    ) {
      throw new NotFoundException(notFoundMessage);
    }

    return codingJobUnit;
  }

  async getOrCreateCodingIssueReviewJob(
    sourceCodingJob: CodingJob,
    reviewerUserId: number
  ): Promise<CodingJob> {
    const existingReviewJob =
      await this.getCodingIssueReviewJobForReviewer(
        sourceCodingJob,
        reviewerUserId
      );

    if (existingReviewJob) {
      return existingReviewJob;
    }

    try {
      return await this.connection.transaction(async manager => {
        const codingJobRepository = manager.getRepository(CodingJob);
        const codingJobCoderRepository = manager.getRepository(CodingJobCoder);
        const reviewJob = codingJobRepository.create({
          workspace_id: sourceCodingJob.workspace_id,
          name: `${sourceCodingJob.name} - Kodierungshinweisprüfung`,
          description: sourceCodingJob.description,
          comment: null,
          job_type: CODING_JOB_TYPE_CODING_ISSUE_REVIEW,
          source_coding_job_id: sourceCodingJob.id,
          reviewer_user_id: reviewerUserId,
          status: 'completed',
          showScore: sourceCodingJob.showScore,
          allowComments: sourceCodingJob.allowComments,
          suppressGeneralInstructions: sourceCodingJob.suppressGeneralInstructions,
          training_id: sourceCodingJob.training_id,
          missings_profile_id: sourceCodingJob.missings_profile_id,
          job_definition_id: sourceCodingJob.job_definition_id,
          case_ordering_mode: sourceCodingJob.case_ordering_mode,
          aggregation_enabled: sourceCodingJob.aggregation_enabled,
          aggregation_threshold: sourceCodingJob.aggregation_threshold,
          response_matching_flags: sourceCodingJob.response_matching_flags,
          aggregation_settings_version: sourceCodingJob.aggregation_settings_version,
          freshness_status: sourceCodingJob.freshness_status || 'current',
          freshness_reason: sourceCodingJob.freshness_reason || null,
          freshness_affected_units: 0,
          freshness_affected_responses: 0
        });
        const savedReviewJob = await codingJobRepository.save(reviewJob);
        const savedCoder = await codingJobCoderRepository.save(
          codingJobCoderRepository.create({
            coding_job_id: savedReviewJob.id,
            user_id: reviewerUserId
          })
        );

        return {
          ...savedReviewJob,
          codingJobCoders: [savedCoder]
        } as CodingJob;
      });
    } catch (error) {
      if (this.query.isUniqueConstraintViolation(error)) {
        const concurrentReviewJob =
          await this.getCodingIssueReviewJobForReviewer(
            sourceCodingJob,
            reviewerUserId
          );

        if (concurrentReviewJob) {
          return concurrentReviewJob;
        }
      }

      throw error;
    }
  }

  async getCodingIssueReviewJobForReviewer(
    sourceCodingJob: Pick<CodingJob, 'id' | 'workspace_id'>,
    reviewerUserId: number
  ): Promise<CodingJob | undefined> {
    const existingReviewJobs =
      await this.query.getCodingIssueReviewJobsForSource(sourceCodingJob);

    return existingReviewJobs.find(job => (
      job.reviewer_user_id === reviewerUserId ||
      job.codingJobCoders?.some(coder => coder.user_id === reviewerUserId)
    ));
  }

  getCodingIssueReviewUnitWhere(
    reviewJobId: number,
    sourceUnit: CodingJobUnit
  ): Partial<CodingJobUnit> {
    return {
      coding_job_id: reviewJobId,
      response_id: sourceUnit.response_id,
      unit_name: sourceUnit.unit_name,
      variable_id: sourceUnit.variable_id,
      person_login: sourceUnit.person_login,
      person_code: sourceUnit.person_code,
      person_group: sourceUnit.person_group,
      booklet_name: sourceUnit.booklet_name
    };
  }

  async findCodingIssueReviewUnit(
    sourceUnit: CodingJobUnit,
    reviewJob: CodingJob
  ): Promise<CodingJobUnit | null> {
    return this.codingJobUnitRepository.findOne({
      where: this.getCodingIssueReviewUnitWhere(reviewJob.id, sourceUnit)
    });
  }

  async getOrCreateCodingIssueReviewUnit(
    sourceCodingJob: CodingJob,
    sourceUnit: CodingJobUnit,
    reviewJob: CodingJob
  ): Promise<CodingJobUnit> {
    const existingReviewUnit = await this.findCodingIssueReviewUnit(
      sourceUnit,
      reviewJob
    );

    if (existingReviewUnit) {
      return existingReviewUnit;
    }

    return this.codingJobUnitRepository.create({
      coding_job_id: reviewJob.id,
      workspace_id: sourceCodingJob.workspace_id,
      response_id: sourceUnit.response_id,
      unit_name: sourceUnit.unit_name,
      unit_alias: sourceUnit.unit_alias,
      variable_id: sourceUnit.variable_id,
      variable_anchor: sourceUnit.variable_anchor,
      variable_bundle_id: sourceUnit.variable_bundle_id,
      booklet_name: sourceUnit.booklet_name,
      person_login: sourceUnit.person_login,
      person_code: sourceUnit.person_code,
      person_group: sourceUnit.person_group,
      code: null,
      score: null,
      is_open: false,
      notes: sourceUnit.notes,
      supervisor_comment: null,
      coding_issue_option: null
    });
  }

  async saveCodingIssueReviewProgress(
    sourceCodingJobId: number,
    reviewerUserId: number,
    progress: SaveCodingProgressDto
  ): Promise<CodingJob> {
    const sourceCodingJob = await this.codingJobRepository.findOne({
      where: { id: sourceCodingJobId }
    });

    if (!sourceCodingJob) {
      throw new NotFoundException(
        `Coding job with ID ${sourceCodingJobId} not found`
      );
    }

    if (sourceCodingJob.status === 'results_applied') {
      throw new BadRequestException(
        'Cannot save progress for a coding job whose results have already been applied'
      );
    }
    this.query.assertCodingIssueReviewSourceJobStatus(sourceCodingJob);

    const sourceUnit = await this.getCodingJobUnitForEntry(
      sourceCodingJob,
      progress,
      'Coding job unit not found for progress entry'
    );
    this.query.assertCodingIssueReviewSourceUnit(sourceUnit);

    const selectedCode = await this.scheme.validateProgressSelectedCode(
      progress,
      sourceUnit,
      sourceCodingJob.workspace_id,
      sourceCodingJob.allowComments !== false
    );

    if (progress.isOpen !== true && selectedCode === null) {
      const existingReviewJob =
        await this.getCodingIssueReviewJobForReviewer(
          sourceCodingJob,
          reviewerUserId
        );
      const existingReviewUnit = existingReviewJob ?
        await this.findCodingIssueReviewUnit(sourceUnit, existingReviewJob) :
        null;

      if (!existingReviewUnit) {
        return sourceCodingJob;
      }

      this.applyProgressToCodingJobUnit(existingReviewUnit, progress, selectedCode);
      await this.codingJobUnitRepository.save(existingReviewUnit);

      return sourceCodingJob;
    }

    const reviewJob = await this.getOrCreateCodingIssueReviewJob(
      sourceCodingJob,
      reviewerUserId
    );
    const reviewUnit = await this.getOrCreateCodingIssueReviewUnit(
      sourceCodingJob,
      sourceUnit,
      reviewJob
    );

    this.applyProgressToCodingJobUnit(reviewUnit, progress, selectedCode);
    await this.codingJobUnitRepository.save(reviewUnit);

    return sourceCodingJob;
  }

  async saveCodingNotes(
    codingJobId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> {
    return this.connection.transaction(async manager => {
      const codingJobRepository = manager.getRepository(CodingJob);
      const codingJobUnitRepository = manager.getRepository(CodingJobUnit);
      const codingJob = await codingJobRepository.findOne({
        where: { id: codingJobId }
      });

      if (!codingJob) {
        throw new NotFoundException(
          `Coding job with ID ${codingJobId} not found`
        );
      }

      if (['review', 'results_applied'].includes(codingJob.status)) {
        throw new BadRequestException(
          `Cannot save notes for a coding job with status ${codingJob.status}`
        );
      }

      const codingJobUnit = await this.getCodingJobUnitForEntry(
        codingJob,
        notesDto,
        'Coding job unit not found for notes entry',
        manager,
        true
      );

      codingJobUnit.notes = notesDto.notes?.trim() || null;
      const clearedProgress = this.clearNewCodeNeededProgressWithoutNotes(codingJobUnit);
      await codingJobUnitRepository.save(codingJobUnit);
      if (clearedProgress) {
        await this.reopenCodingJobAfterProgressCleared(codingJob, manager);
      }

      return codingJob;
    });
  }

  async saveCodingIssueReviewNotes(
    sourceCodingJobId: number,
    reviewerUserId: number,
    notesDto: SaveCodingNotesDto
  ): Promise<CodingJob> {
    const sourceCodingJob = await this.codingJobRepository.findOne({
      where: { id: sourceCodingJobId }
    });

    if (!sourceCodingJob) {
      throw new NotFoundException(
        `Coding job with ID ${sourceCodingJobId} not found`
      );
    }

    if (sourceCodingJob.status === 'results_applied') {
      throw new BadRequestException(
        'Cannot save notes for a coding job whose results have already been applied'
      );
    }
    this.query.assertCodingIssueReviewSourceJobStatus(sourceCodingJob);

    const sourceUnit = await this.getCodingJobUnitForEntry(
      sourceCodingJob,
      notesDto,
      'Coding job unit not found for notes entry'
    );
    this.query.assertCodingIssueReviewSourceUnit(sourceUnit);

    const reviewJob = await this.getCodingIssueReviewJobForReviewer(
      sourceCodingJob,
      reviewerUserId
    );
    const reviewUnit = reviewJob ?
      await this.findCodingIssueReviewUnit(sourceUnit, reviewJob) :
      null;

    if (!reviewUnit) {
      if (!this.query.codingJobUnitHasRegularCode(sourceUnit)) {
        return sourceCodingJob;
      }

      const effectiveReviewJob = reviewJob ??
        await this.getOrCreateCodingIssueReviewJob(
          sourceCodingJob,
          reviewerUserId
        );
      const createdReviewUnit = await this.getOrCreateCodingIssueReviewUnit(
        sourceCodingJob,
        sourceUnit,
        effectiveReviewJob
      );
      createdReviewUnit.code = sourceUnit.code;
      createdReviewUnit.score = sourceUnit.score;
      createdReviewUnit.is_open = false;
      createdReviewUnit.coding_issue_option = null;
      createdReviewUnit.notes = notesDto.notes?.trim() || null;
      this.clearNewCodeNeededProgressWithoutNotes(createdReviewUnit);
      await this.codingJobUnitRepository.save(createdReviewUnit);

      return sourceCodingJob;
    }

    reviewUnit.notes = notesDto.notes?.trim() || null;
    this.clearNewCodeNeededProgressWithoutNotes(reviewUnit);
    await this.codingJobUnitRepository.save(reviewUnit);

    return sourceCodingJob;
  }

  async checkAndUpdateCodingJobCompletion(
    codingJobId: number,
    manager?: EntityManager
  ): Promise<void> {
    const progress = await this.query.getCodingJobProgress(codingJobId, manager);

    if (
      progress.total > 0 &&
      progress.coded + progress.open >= progress.total
    ) {
      const newStatus = progress.open > 0 ? 'open' : 'completed';
      const codingJobRepository = manager ?
        manager.getRepository(CodingJob) :
        this.codingJobRepository;
      await codingJobRepository.update(codingJobId, { status: newStatus });
    }
  }
}
