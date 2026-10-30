import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository
} from 'typeorm';
import { CoderTraining } from '../../entities/coder-training.entity';
import {
  WorkspaceExclusionService,
  isExcludedByResolvedExclusions
} from '../workspace/workspace-exclusion.service';
import { CoderTrainingWithJobs } from './coder-training.types';
import { getBundleVariableKeys, getTrainingVariablesByKey, makeTrainingVariableKey } from './coder-training.util';

@Injectable()
export class CoderTrainingQueryService {
  private readonly logger = new Logger('CoderTrainingService');

  constructor(
    @InjectRepository(CoderTraining)
    private coderTrainingRepository: Repository<CoderTraining>,
    private workspaceExclusionService: WorkspaceExclusionService
  ) {}

  async getCoderTrainings(workspaceId: number): Promise<CoderTrainingWithJobs[]> {
    this.logger.log(`Getting all coder trainings for workspace ${workspaceId}`);

    const trainings = await this.coderTrainingRepository.find({
      where: { workspace_id: workspaceId },
      relations: ['codingJobs', 'variables', 'bundles', 'bundles.bundle', 'coders'],
      order: { created_at: 'DESC' }
    });

    return trainings.map(training => {
      const bundleVariableKeys = getBundleVariableKeys(training.bundles || []);
      const trainingVariablesByKey = getTrainingVariablesByKey(training.variables || []);

      return {
        id: training.id,
        workspace_id: training.workspace_id,
        creatorUserId: training.creatorUserId ?? null,
        label: training.label,
        created_at: training.created_at,
        updated_at: training.updated_at,
        jobsCount: training.codingJobs?.length || 0,
        case_ordering_mode: training.case_ordering_mode,
        case_selection_mode: training.case_selection_mode,
        reference_training_ids: training.reference_training_ids ?? undefined,
        reference_mode: training.reference_mode ?? undefined,
        show_score: training.show_score,
        allow_comments: training.allow_comments,
        suppress_general_instructions: training.suppress_general_instructions,
        assigned_variables: training.variables
          ?.filter(v => !bundleVariableKeys.has(makeTrainingVariableKey(v.unit_name, v.variable_id)))
          .map(v => ({
            variableId: v.variable_id,
            unitName: v.unit_name,
            sampleCount: v.sample_count,
            ...(v.include_derive_error === true ? { includeDeriveError: true } : {})
          })),
        assigned_variable_bundles: training.bundles?.map(b => ({
          id: b.variable_bundle_id,
          name: b.bundle?.name || 'Unknown Bundle',
          sampleCount: b.sample_count,
          caseOrderingMode: b.case_ordering_mode,
          variables: b.bundle?.variables?.map(variable => {
            const savedVariable = trainingVariablesByKey.get(
              makeTrainingVariableKey(variable.unitName, variable.variableId)
            );
            return {
              ...variable,
              sampleCount: savedVariable?.sample_count ?? b.sample_count,
              ...(savedVariable?.include_derive_error === true ? { includeDeriveError: true } : {})
            };
          })
        })),
        assigned_coders: training.coders?.map(c => c.user_id)
      };
    });
  }

  async getCodingJobsForTraining(workspaceId: number, trainingId: number): Promise<Array<{
    id: number;
    name: string;
    description?: string;
    status: string;
    created_at: Date;
    coder: {
      userId: number;
      username: string;
    };
    unitsCount: number;
  }>> {
    this.logger.log(`Getting coding jobs for training ${trainingId} in workspace ${workspaceId}`);

    const training = await this.coderTrainingRepository.findOne({
      where: {
        id: trainingId,
        workspace_id: workspaceId
      },
      relations: ['codingJobs', 'codingJobs.codingJobCoders', 'codingJobs.codingJobCoders.user', 'codingJobs.codingJobUnits']
    });

    if (!training || !training.codingJobs) {
      return [];
    }

    const exclusions = await this.workspaceExclusionService.resolveExclusionsForQueries(workspaceId);
    return training.codingJobs.map(job => ({
      id: job.id,
      name: job.name,
      description: job.description,
      status: job.status,
      created_at: job.created_at,
      coder: job.codingJobCoders && job.codingJobCoders.length > 0 && job.codingJobCoders[0].user ? {
        userId: job.codingJobCoders[0].user.id,
        username: job.codingJobCoders[0].user.username
      } : {
        userId: 0,
        username: 'Unknown'
      },
      unitsCount: job.codingJobUnits?.filter(unit => !isExcludedByResolvedExclusions(
        exclusions,
        unit.booklet_name,
        unit.unit_name
      )).length || 0
    }));
  }
}
