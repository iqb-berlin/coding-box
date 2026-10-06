import {
  BadRequestException, Injectable, Logger, Optional
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository, In, Connection, EntityManager
} from 'typeorm';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CreateCodingJobDto } from '../../../admin/coding-job/dto/create-coding-job.dto';
import { UpdateCodingJobDto } from '../../../admin/coding-job/dto/update-coding-job.dto';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { CacheService } from '../../../cache/cache.service';
import { applyResolvedExclusionsToQuery, WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { getAggregationVariableKey } from './aggregation-metrics.util';
import { lockWorkspaceTestResultsMutationInTransaction } from '../shared/workspace-test-results-lock.util';
import { getCodingIncompleteVariablesCacheKeys, getCodingIncompleteVariablesCacheVersionKey } from './coding-incomplete-variables-cache-key.util';
import { MissingsProfilesService } from './missings-profiles.service';
import {
  TransferCodingCasesResult, SlimResponse, InternalCreateCodingJobDto, UPDATABLE_CODING_JOB_STATUSES
} from './coding-job.types';
import { CodingJobQueryService } from './coding-job-query.service';
import { CodingJobAggregationService } from './coding-job-aggregation.service';
import { CodingJobAccessService } from './coding-job-access.service';
import { CodingJobResponsesService } from './coding-job-responses.service';

@Injectable()
export class CodingJobMutationService {
  private readonly logger = new Logger(CodingJobMutationService.name);

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
    private readonly connection: Connection,
    private readonly cacheService: CacheService,
    private readonly workspaceExclusionService: WorkspaceExclusionService,
    private readonly query: CodingJobQueryService,
    private readonly aggregation: CodingJobAggregationService,
    private readonly access: CodingJobAccessService,
    private readonly responses: CodingJobResponsesService,
    @Optional()
    private readonly missingsProfilesService?: MissingsProfilesService,
    @Optional()
    @InjectRepository(CoderTrainingDiscussionResult)
    private readonly coderTrainingDiscussionResultRepository?: Repository<CoderTrainingDiscussionResult>
  ) {}

  async resolveMissingsProfileId(
    workspaceId: number,
    profileId?: number | null
  ): Promise<number | undefined> {
    if (this.missingsProfilesService) {
      return this.missingsProfilesService.resolveMissingsProfileId(
        workspaceId,
        profileId
      );
    }

    if (profileId === undefined || profileId === null || profileId === 0) {
      return undefined;
    }

    if (!Number.isInteger(profileId) || profileId < 1) {
      throw new BadRequestException(
        `Invalid missings profile id: ${profileId}`
      );
    }

    return profileId;
  }

  async codingJobHasCodingWork(codingJobId: number): Promise<boolean> {
    const count = await this.codingJobUnitRepository
      .createQueryBuilder('cju')
      .where('cju.coding_job_id = :codingJobId', { codingJobId })
      .andWhere(
        `(cju.code IS NOT NULL
          OR cju.score IS NOT NULL
          OR cju.is_open = true
          OR cju.notes IS NOT NULL
          OR cju.supervisor_comment IS NOT NULL
          OR cju.coding_issue_option IS NOT NULL)`
      )
      .getCount();

    return count > 0;
  }

  async codingJobHasTrainingDiscussions(
    codingJob: CodingJob
  ): Promise<boolean> {
    if (
      !codingJob.training_id ||
      !this.coderTrainingDiscussionResultRepository
    ) {
      return false;
    }

    const count = await this.coderTrainingDiscussionResultRepository.count({
      where: {
        workspace_id: codingJob.workspace_id,
        training_id: codingJob.training_id
      }
    });

    return count > 0;
  }

  async assertMissingsProfileCanChange(
    codingJob: CodingJob,
    nextMissingsProfileId: number | undefined
  ): Promise<void> {
    const currentMissingsProfileId = await this.resolveMissingsProfileId(
      codingJob.workspace_id,
      codingJob.missings_profile_id
    );

    if (currentMissingsProfileId === nextMissingsProfileId) {
      return;
    }

    if (['completed', 'results_applied'].includes(codingJob.status)) {
      throw new BadRequestException(
        `Cannot change missings profile for coding job ${codingJob.id} because it is ${codingJob.status}`
      );
    }

    if (await this.codingJobHasCodingWork(codingJob.id)) {
      throw new BadRequestException(
        `Cannot change missings profile for coding job ${codingJob.id} because coding work already exists`
      );
    }

    if (await this.codingJobHasTrainingDiscussions(codingJob)) {
      throw new BadRequestException(
        `Cannot change missings profile for coding job ${codingJob.id} because training discussions already exist`
      );
    }
  }

  async deleteCodingJobsByDefinition(
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<number> {
    const deletedJobs = await this.deleteCodingJobsByDefinitionInManager(
      undefined,
      workspaceId,
      jobDefinitionId
    );
    await this.invalidateIncompleteVariablesCache(workspaceId);
    return deletedJobs;
  }

  async deleteCodingJobsByDefinitionInManager(
    manager: EntityManager | undefined,
    workspaceId: number,
    jobDefinitionId: number
  ): Promise<number> {
    const repository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const result = await repository.delete({
      workspace_id: workspaceId,
      job_definition_id: jobDefinitionId
    });
    return result.affected || 0;
  }

  async createCodingJob(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto
  ): Promise<CodingJob> {
    const missingsProfileId = await this.resolveMissingsProfileId(
      workspaceId,
      createCodingJobDto.missings_profile_id
    );
    const normalizedCreateCodingJobDto = {
      ...createCodingJobDto,
      missings_profile_id: missingsProfileId
    };

    const createdCodingJob = await this.connection.transaction(
      async manager => {
        await lockWorkspaceTestResultsMutationInTransaction(
          manager,
          workspaceId
        );
        const codingJobRepo = manager.getRepository(CodingJob);
        const aggregationSettings =
          await this.aggregation.getCurrentAggregationSettingsSnapshot(workspaceId);
        const codingJob = codingJobRepo.create({
          workspace_id: workspaceId,
          name: normalizedCreateCodingJobDto.name,
          description: normalizedCreateCodingJobDto.description,
          status: normalizedCreateCodingJobDto.status || 'pending',
          showScore: normalizedCreateCodingJobDto.showScore ?? false,
          allowComments: normalizedCreateCodingJobDto.allowComments ?? true,
          suppressGeneralInstructions:
            normalizedCreateCodingJobDto.suppressGeneralInstructions ?? false,
          missings_profile_id: normalizedCreateCodingJobDto.missings_profile_id,
          aggregation_enabled: aggregationSettings.aggregationEnabled,
          aggregation_threshold: aggregationSettings.aggregationThreshold,
          response_matching_flags: aggregationSettings.responseMatchingFlags,
          aggregation_settings_version:
            aggregationSettings.aggregationSettingsVersion
        });

        const savedCodingJob = await codingJobRepo.save(codingJob);

        if (
          normalizedCreateCodingJobDto.assignedCoders &&
          normalizedCreateCodingJobDto.assignedCoders.length > 0
        ) {
          await this.assignCoders(
            savedCodingJob.id,
            normalizedCreateCodingJobDto.assignedCoders,
            manager,
            workspaceId
          );
        }

        if (
          normalizedCreateCodingJobDto.variables &&
          normalizedCreateCodingJobDto.variables.length > 0
        ) {
          await this.assignVariables(
            savedCodingJob.id,
            normalizedCreateCodingJobDto.variables,
            manager
          );
        }

        if (
          normalizedCreateCodingJobDto.variableBundleIds &&
          normalizedCreateCodingJobDto.variableBundleIds.length > 0
        ) {
          await this.assignVariableBundles(
            savedCodingJob.id,
            normalizedCreateCodingJobDto.variableBundleIds,
            manager
          );
        } else if (
          normalizedCreateCodingJobDto.variableBundles &&
          normalizedCreateCodingJobDto.variableBundles.length > 0
        ) {
          if (normalizedCreateCodingJobDto.variableBundles[0].id) {
            const bundleIds = normalizedCreateCodingJobDto.variableBundles
              .filter(bundle => bundle.id)
              .map(bundle => bundle.id);

            if (bundleIds.length > 0) {
              await this.assignVariableBundles(
                savedCodingJob.id,
                bundleIds,
                manager
              );
            }
          } else {
            const variables =
              normalizedCreateCodingJobDto.variableBundles.flatMap(
                bundle => bundle.variables || []
              );
            if (variables.length > 0) {
              await this.assignVariables(savedCodingJob.id, variables, manager);
            }
          }
        }
        await this.saveCodingJobUnits(
          savedCodingJob.id,
          normalizedCreateCodingJobDto.maxCodingCases,
          manager
        );

        return savedCodingJob;
      }
    );

    await this.invalidateIncompleteVariablesCache(workspaceId);
    return createdCodingJob;
  }

  async updateCodingJob(
    id: number,
    workspaceId: number,
    updateCodingJobDto: UpdateCodingJobDto
  ): Promise<CodingJob> {
    const codingJob = await this.query.getCodingJob(id, workspaceId);

    if (updateCodingJobDto.name !== undefined) {
      codingJob.codingJob.name = updateCodingJobDto.name;
    }
    if (updateCodingJobDto.description !== undefined) {
      codingJob.codingJob.description = updateCodingJobDto.description;
    }
    if (updateCodingJobDto.status !== undefined) {
      const targetStatus = updateCodingJobDto.status;
      if (!UPDATABLE_CODING_JOB_STATUSES.has(targetStatus)) {
        throw new BadRequestException(
          `Unsupported coding job status: ${targetStatus}`
        );
      }
      if (codingJob.codingJob.status === 'results_applied') {
        throw new BadRequestException(
          `Cannot change status of coding job ${id} because it has already been applied to results (status: results_applied)`
        );
      }
      if (
        codingJob.codingJob.status === 'review' &&
        targetStatus !== 'review'
      ) {
        throw new BadRequestException(
          `Cannot change status of coding job ${id} because it has been submitted for review`
        );
      }
      if (
        codingJob.codingJob.status === 'completed' &&
        !['active', 'completed', 'review'].includes(targetStatus)
      ) {
        throw new BadRequestException(
          `Cannot change status of completed coding job ${id}`
        );
      }
      if (
        targetStatus === 'review' &&
        codingJob.codingJob.status !== 'completed'
      ) {
        throw new BadRequestException(
          `Cannot submit coding job ${id} for review because it is not completed`
        );
      }
      if (
        codingJob.codingJob.status !== 'completed' &&
        targetStatus === 'completed'
      ) {
        await this.assertCodingJobCanBeCompleted(id);
      }
      codingJob.codingJob.status = targetStatus;
    }
    if (updateCodingJobDto.comment !== undefined) {
      codingJob.codingJob.comment = updateCodingJobDto.comment;
    }
    if (updateCodingJobDto.missingsProfileId !== undefined) {
      const nextMissingsProfileId = await this.resolveMissingsProfileId(
        workspaceId,
        updateCodingJobDto.missingsProfileId
      );
      await this.assertMissingsProfileCanChange(
        codingJob.codingJob,
        nextMissingsProfileId
      );
      codingJob.codingJob.missings_profile_id = nextMissingsProfileId;
    }
    if (updateCodingJobDto.showScore !== undefined) {
      codingJob.codingJob.showScore = updateCodingJobDto.showScore;
    }
    if (updateCodingJobDto.allowComments !== undefined) {
      codingJob.codingJob.allowComments = updateCodingJobDto.allowComments;
    }
    if (updateCodingJobDto.suppressGeneralInstructions !== undefined) {
      codingJob.codingJob.suppressGeneralInstructions =
        updateCodingJobDto.suppressGeneralInstructions;
    }

    if (updateCodingJobDto.assignedCoders !== undefined) {
      if (updateCodingJobDto.assignedCoders.length > 0) {
        await this.access.assertCodersCanCodeInWorkspace(
          updateCodingJobDto.assignedCoders,
          workspaceId
        );
      }
    }

    const savedCodingJob = await this.codingJobRepository.save(
      codingJob.codingJob
    );

    if (updateCodingJobDto.assignedCoders !== undefined) {
      if (updateCodingJobDto.assignedCoders.length > 0) {
        await this.assignCoders(
          id,
          updateCodingJobDto.assignedCoders,
          undefined,
          workspaceId
        );
      } else {
        await this.codingJobCoderRepository.delete({ coding_job_id: id });
      }
    }

    if (updateCodingJobDto.variables !== undefined) {
      await this.codingJobVariableRepository.delete({ coding_job_id: id });
      if (updateCodingJobDto.variables.length > 0) {
        await this.assignVariables(id, updateCodingJobDto.variables);
      }
    }

    if (updateCodingJobDto.variableBundleIds !== undefined) {
      await this.codingJobVariableBundleRepository.delete({
        coding_job_id: id
      });
      if (updateCodingJobDto.variableBundleIds.length > 0) {
        await this.assignVariableBundles(
          id,
          updateCodingJobDto.variableBundleIds
        );
      }
    } else if (updateCodingJobDto.variableBundles !== undefined) {
      await this.codingJobVariableBundleRepository.delete({
        coding_job_id: id
      });

      if (updateCodingJobDto.variableBundles.length > 0) {
        if (updateCodingJobDto.variableBundles[0].id) {
          const bundleIds = updateCodingJobDto.variableBundles
            .filter(bundle => bundle.id)
            .map(bundle => bundle.id);

          if (bundleIds.length > 0) {
            await this.assignVariableBundles(id, bundleIds);
          }
        } else {
          const variables = updateCodingJobDto.variableBundles.flatMap(
            bundle => bundle.variables || []
          );
          if (variables.length > 0) {
            await this.assignVariables(id, variables);
          }
        }
      }
    }

    return savedCodingJob;
  }

  async updateCodingJobDisplayOptionsByDefinitionId(
    workspaceId: number,
    jobDefinitionId: number,
    options: {
      showScore?: boolean;
      allowComments?: boolean;
      suppressGeneralInstructions?: boolean;
    },
    manager?: EntityManager
  ): Promise<number> {
    const updateValues: Partial<CodingJob> = {};

    if (options.showScore !== undefined) {
      updateValues.showScore = options.showScore;
    }
    if (options.allowComments !== undefined) {
      updateValues.allowComments = options.allowComments;
    }
    if (options.suppressGeneralInstructions !== undefined) {
      updateValues.suppressGeneralInstructions =
        options.suppressGeneralInstructions;
    }

    if (Object.keys(updateValues).length === 0) {
      return 0;
    }

    const repository = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const result = await repository.update(
      {
        workspace_id: workspaceId,
        job_definition_id: jobDefinitionId
      },
      updateValues
    );

    return result.affected || 0;
  }

  async deleteCodingJob(
    id: number,
    workspaceId: number
  ): Promise<{ success: boolean }> {
    const codingJob = await this.query.getCodingJob(id, workspaceId);

    await this.codingJobRepository.remove(codingJob.codingJob);

    // Invalidate the incomplete variables cache since coding job units were deleted
    await this.invalidateIncompleteVariablesCache(workspaceId);

    return { success: true };
  }

  async invalidateIncompleteVariablesCache(
    workspaceId: number
  ): Promise<void> {
    await this.cacheService.incr(
      getCodingIncompleteVariablesCacheVersionKey(workspaceId)
    );
    await Promise.all(
      getCodingIncompleteVariablesCacheKeys(workspaceId)
        .map(cacheKey => this.cacheService.delete(cacheKey))
    );
    this.logger.log(
      `Invalidated manual coding variables cache for workspace ${workspaceId}`
    );
  }

  async assignCoders(
    codingJobId: number,
    userIds: number[],
    manager?: EntityManager,
    workspaceId?: number
  ): Promise<CodingJobCoder[]> {
    this.assertAssignedCoderIdsAreUnique(userIds);
    await this.access.assertCodingJobCodersCanCode(
      codingJobId,
      userIds,
      manager,
      workspaceId
    );
    const repo = manager ?
      manager.getRepository(CodingJobCoder) :
      this.codingJobCoderRepository;
    await repo.delete({ coding_job_id: codingJobId });
    const coders = userIds.map(userId => repo.create({
      coding_job_id: codingJobId,
      user_id: userId
    })
    );

    return repo.save(coders);
  }

  assertAssignedCoderIdsAreUnique(userIds: number[]): void {
    const seenIds = new Set<number>();
    const duplicateIds = new Set<number>();

    userIds.forEach(userId => {
      if (seenIds.has(userId)) {
        duplicateIds.add(userId);
        return;
      }
      seenIds.add(userId);
    });

    if (duplicateIds.size > 0) {
      throw new BadRequestException(
        `Assigned coder IDs must be unique: ${Array.from(duplicateIds).join(', ')}`
      );
    }
  }

  async transferCodingCases(
    workspaceId: number,
    sourceCoderId: number,
    targetCoderId: number
  ): Promise<TransferCodingCasesResult> {
    if (sourceCoderId === targetCoderId) {
      throw new BadRequestException(
        'Source and target coder must be different'
      );
    }

    await this.access.assertCodersCanCodeInWorkspace([targetCoderId], workspaceId);

    return this.connection.transaction(async manager => {
      const codingJobCoderRepo = manager.getRepository(CodingJobCoder);
      const codingJobUnitRepo = manager.getRepository(CodingJobUnit);

      const sourceAssignments = await codingJobCoderRepo
        .createQueryBuilder('assignment')
        .innerJoin(CodingJob, 'job', 'job.id = assignment.coding_job_id')
        .where('assignment.user_id = :sourceCoderId', { sourceCoderId })
        .andWhere('job.workspace_id = :workspaceId', { workspaceId })
        .getMany();

      if (sourceAssignments.length === 0) {
        return {
          sourceCoderId,
          targetCoderId,
          affectedJobs: 0,
          updatedAssignments: 0,
          removedDuplicateAssignments: 0,
          transferredCases: 0
        };
      }

      const affectedJobIds = [
        ...new Set(
          sourceAssignments.map(assignment => assignment.coding_job_id)
        )
      ];

      const existingTargetAssignments = await codingJobCoderRepo.find({
        where: {
          coding_job_id: In(affectedJobIds),
          user_id: targetCoderId
        },
        select: ['coding_job_id']
      });

      const existingTargetJobIds = new Set(
        existingTargetAssignments.map(assignment => assignment.coding_job_id)
      );

      const updateAssignmentIds: number[] = [];
      const deleteAssignmentIds: number[] = [];

      sourceAssignments.forEach(assignment => {
        if (existingTargetJobIds.has(assignment.coding_job_id)) {
          deleteAssignmentIds.push(assignment.id);
          return;
        }
        updateAssignmentIds.push(assignment.id);
      });

      if (updateAssignmentIds.length > 0) {
        await codingJobCoderRepo
          .createQueryBuilder()
          .update(CodingJobCoder)
          .set({ user_id: targetCoderId })
          .whereInIds(updateAssignmentIds)
          .execute();
      }

      if (deleteAssignmentIds.length > 0) {
        await codingJobCoderRepo.delete(deleteAssignmentIds);
      }

      const transferredCasesQuery = codingJobUnitRepo
        .createQueryBuilder('cju')
        .where('cju.coding_job_id IN (:...affectedJobIds)', { affectedJobIds });
      const exclusions =
        await this.workspaceExclusionService.resolveExclusionsForQueries(
          workspaceId
        );
      applyResolvedExclusionsToQuery(transferredCasesQuery, exclusions, {
        unitNameExpression: 'cju.unit_name',
        bookletNameExpression: 'cju.booklet_name',
        parameterPrefix: 'transferCases'
      });
      const transferredCases = await transferredCasesQuery.getCount();

      return {
        sourceCoderId,
        targetCoderId,
        affectedJobs: affectedJobIds.length,
        updatedAssignments: updateAssignmentIds.length,
        removedDuplicateAssignments: deleteAssignmentIds.length,
        transferredCases
      };
    });
  }

  async assignVariables(
    codingJobId: number,
    variables: { unitName: string; variableId: string }[],
    manager?: EntityManager
  ): Promise<CodingJobVariable[]> {
    const repo = manager ?
      manager.getRepository(CodingJobVariable) :
      this.codingJobVariableRepository;
    const codingJobVariables = variables.map(variable => repo.create({
      coding_job_id: codingJobId,
      unit_name: variable.unitName,
      variable_id: variable.variableId
    })
    );

    return repo.save(codingJobVariables);
  }

  async assignVariableBundles(
    codingJobId: number,
    variableBundleIds: number[],
    manager?: EntityManager
  ): Promise<CodingJobVariableBundle[]> {
    const repo = manager ?
      manager.getRepository(CodingJobVariableBundle) :
      this.codingJobVariableBundleRepository;
    const variableBundles = variableBundleIds.map(variableBundleId => repo.create({
      coding_job_id: codingJobId,
      variable_bundle_id: variableBundleId
    })
    );

    return repo.save(variableBundles);
  }

  async saveCodingJobUnits(
    codingJobId: number,
    maxCodingCases?: number,
    manager?: EntityManager
  ): Promise<void> {
    let responses = await this.responses.getSlimResponsesForCodingJob(
      codingJobId,
      manager
    );

    if (responses.length === 0) {
      return;
    }

    // Get coding job to find workspace ID
    const codingJobRepo = manager ?
      manager.getRepository(CodingJob) :
      this.codingJobRepository;
    const codingJob = await codingJobRepo.findOne({
      where: { id: codingJobId }
    });
    if (!codingJob) {
      throw new Error(`Coding job ${codingJobId} not found`);
    }
    const workspaceId = codingJob.workspace_id;

    const aggregationSettings =
      await this.aggregation.getAggregationSettingsForCodingJob(codingJob);
    const aggregationThreshold = aggregationSettings.aggregationThreshold;

    // If aggregation is enabled, filter to unique cases using slim-compatible logic
    if (
      aggregationSettings.aggregationEnabled &&
      aggregationThreshold !== null &&
      aggregationThreshold >= 2
    ) {
      const originalCount = responses.length;
      responses = await this.aggregation.filterSlimResponsesForAggregation(
        workspaceId,
        responses,
        aggregationThreshold,
        aggregationSettings.responseMatchingFlags
      );
      this.logger.log(
        `Aggregation enabled (threshold: ${aggregationThreshold}). ` +
          `Reduced from ${originalCount} to ${responses.length} cases`
      );
    }

    // Apply maxCodingCases limit if specified
    if (
      maxCodingCases &&
      maxCodingCases > 0 &&
      responses.length > maxCodingCases
    ) {
      // Shuffle responses to ensure random distribution across variables (Fisher-Yates)
      for (let i = responses.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [responses[i], responses[j]] = [responses[j], responses[i]];
      }
      responses = responses.slice(0, maxCodingCases);
    }

    const repo = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const BATCH_SIZE = 500;
    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const chunk = responses.slice(i, i + BATCH_SIZE);
      const units = chunk.map(r => repo.create({
        coding_job_id: codingJobId,
        workspace_id: workspaceId,
        response_id: r.id,
        unit_name: r.unitName,
        unit_alias: r.unitAlias,
        variable_id: r.variableid,
        variable_anchor: r.variableid,
        booklet_name: r.bookletName,
        person_login: r.personLogin,
        person_code: r.personCode,
        person_group: r.personGroup,
        variable_bundle_id: r.variableBundleId || null
      })
      );
      await repo.save(units);
    }
  }

  async assertCodingJobCanBeCompleted(
    codingJobId: number
  ): Promise<void> {
    const progress = await this.query.getCodingJobProgress(codingJobId);
    const missingUnits = Math.max(
      0,
      progress.total - progress.coded - progress.open
    );

    if (progress.total === 0) {
      throw new BadRequestException(
        'Cannot complete a coding job without coding units'
      );
    }

    if (
      missingUnits > 0 ||
      progress.open > 0 ||
      progress.coded < progress.total
    ) {
      throw new BadRequestException(
        `Cannot complete coding job ${codingJobId}: ${missingUnits} units are uncoded and ${progress.open} units are open`
      );
    }
  }

  async createCodingJobWithUnitSubset(
    workspaceId: number,
    createCodingJobDto: CreateCodingJobDto,
    unitSubset: SlimResponse[]
  ): Promise<CodingJob> {
    const savedCodingJob = await this.connection.transaction(manager => this.createCodingJobWithUnitSubsetInManager(
      workspaceId,
      createCodingJobDto,
      unitSubset,
      manager
    )
    );

    await this.invalidateIncompleteVariablesCache(workspaceId);
    return savedCodingJob;
  }

  async createCodingJobWithUnitSubsetInManager(
    workspaceId: number,
    createCodingJobDto: InternalCreateCodingJobDto,
    unitSubset: SlimResponse[],
    manager: EntityManager
  ): Promise<CodingJob> {
    const codingJobRepo = manager.getRepository(CodingJob);
    const aggregationSettings =
      await this.aggregation.getCurrentAggregationSettingsSnapshot(workspaceId);
    const missingsProfileId = await this.resolveMissingsProfileId(
      workspaceId,
      createCodingJobDto.missings_profile_id
    );
    const codingJob = codingJobRepo.create({
      workspace_id: workspaceId,
      name: createCodingJobDto.name,
      description: createCodingJobDto.description,
      status: createCodingJobDto.status || 'pending',
      showScore: createCodingJobDto.showScore ?? false,
      allowComments: createCodingJobDto.allowComments ?? true,
      suppressGeneralInstructions:
        createCodingJobDto.suppressGeneralInstructions ?? false,
      missings_profile_id: missingsProfileId,
      job_definition_id: createCodingJobDto.jobDefinitionId,
      case_ordering_mode: createCodingJobDto.caseOrderingMode || 'continuous',
      aggregation_enabled: aggregationSettings.aggregationEnabled,
      aggregation_threshold: aggregationSettings.aggregationThreshold,
      response_matching_flags: aggregationSettings.responseMatchingFlags,
      aggregation_settings_version:
        aggregationSettings.aggregationSettingsVersion
    });

    const savedCodingJob = await codingJobRepo.save(codingJob);

    if (
      createCodingJobDto.assignedCoders &&
      createCodingJobDto.assignedCoders.length > 0
    ) {
      await this.assignCoders(
        savedCodingJob.id,
        createCodingJobDto.assignedCoders,
        manager,
        workspaceId
      );
    }

    if (
      createCodingJobDto.variables &&
      createCodingJobDto.variables.length > 0
    ) {
      await this.assignVariables(
        savedCodingJob.id,
        createCodingJobDto.variables,
        manager
      );
    }

    if (
      createCodingJobDto.variableBundleIds &&
      createCodingJobDto.variableBundleIds.length > 0
    ) {
      await this.assignVariableBundles(
        savedCodingJob.id,
        createCodingJobDto.variableBundleIds,
        manager
      );
    } else if (
      createCodingJobDto.variableBundles &&
      createCodingJobDto.variableBundles.length > 0
    ) {
      if (createCodingJobDto.variableBundles[0].id) {
        const bundleIds = createCodingJobDto.variableBundles
          .filter(bundle => bundle.id)
          .map(bundle => bundle.id);

        if (bundleIds.length > 0) {
          await this.assignVariableBundles(
            savedCodingJob.id,
            bundleIds,
            manager
          );
        }
      } else {
        const variables = createCodingJobDto.variableBundles.flatMap(
          bundle => bundle.variables || []
        );
        if (variables.length > 0) {
          await this.assignVariables(savedCodingJob.id, variables, manager);
        }
      }
    }

    const unitSubsetWithBundleIds =
      await this.attachVariableBundleIdsToResponses(
        createCodingJobDto,
        unitSubset,
        manager
      );

    await this.saveCodingJobUnitsSubset(
      savedCodingJob.id,
      workspaceId,
      unitSubsetWithBundleIds,
      manager
    );

    return savedCodingJob;
  }

  async attachVariableBundleIdsToResponses(
    createCodingJobDto: InternalCreateCodingJobDto,
    responses: SlimResponse[],
    manager: EntityManager
  ): Promise<SlimResponse[]> {
    if (responses.length === 0) {
      return responses;
    }

    const variableBundleIdByVariable = await this.getVariableBundleIdByVariable(
      createCodingJobDto,
      manager
    );
    if (variableBundleIdByVariable.size === 0) {
      return responses;
    }

    return responses.map(response => {
      if (response.variableBundleId) {
        return response;
      }

      const variableBundleId = variableBundleIdByVariable.get(
        getAggregationVariableKey(response.unitName, response.variableid)
      );
      return variableBundleId ? { ...response, variableBundleId } : response;
    });
  }

  async getVariableBundleIdByVariable(
    createCodingJobDto: InternalCreateCodingJobDto,
    manager: EntityManager
  ): Promise<Map<string, number>> {
    const bundleVariablesById = new Map<
    number,
    Array<{ unitName: string; variableId: string }>
    >();
    const bundleIds = new Set<number>();

    createCodingJobDto.variableBundleIds?.forEach(id => bundleIds.add(id));
    createCodingJobDto.variableBundles?.forEach(bundle => {
      if (!bundle.id) {
        return;
      }

      bundleIds.add(bundle.id);
      if (bundle.variables?.length) {
        bundleVariablesById.set(bundle.id, bundle.variables);
      }
    });

    if (bundleIds.size === 0) {
      return new Map();
    }

    const missingBundleIds = Array.from(bundleIds).filter(
      id => !bundleVariablesById.has(id)
    );
    if (missingBundleIds.length > 0) {
      const variableBundleRepo = manager.getRepository(VariableBundle);
      const variableBundles = await variableBundleRepo.find({
        where: { id: In(missingBundleIds) }
      });

      variableBundles.forEach(bundle => {
        bundleVariablesById.set(bundle.id, bundle.variables || []);
      });
    }

    const variableBundleIdByVariable = new Map<string, number>();
    bundleVariablesById.forEach((variables, bundleId) => {
      variables.forEach(variable => {
        variableBundleIdByVariable.set(
          getAggregationVariableKey(variable.unitName, variable.variableId),
          bundleId
        );
      });
    });

    return variableBundleIdByVariable;
  }

  async saveCodingJobUnitsSubset(
    codingJobId: number,
    workspaceId: number,
    responses: SlimResponse[],
    manager?: EntityManager
  ): Promise<void> {
    if (responses.length === 0) {
      return;
    }

    const unitRepo = manager ?
      manager.getRepository(CodingJobUnit) :
      this.codingJobUnitRepository;
    const BATCH_SIZE = 500;
    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const chunk = responses.slice(i, i + BATCH_SIZE);
      const units = chunk.map(r => unitRepo.create({
        coding_job_id: codingJobId,
        workspace_id: workspaceId,
        response_id: r.id,
        unit_name: r.unitName,
        unit_alias: r.unitAlias,
        variable_id: r.variableid,
        variable_anchor: r.variableid,
        booklet_name: r.bookletName,
        person_login: r.personLogin,
        person_code: r.personCode,
        person_group: r.personGroup,
        variable_bundle_id: r.variableBundleId || null
      })
      );
      await unitRepo.save(units);
    }
  }
}
