import {
  Repository
} from 'typeorm';
import { ChunkEntity } from '../../entities/chunk.entity';
import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../../entities/coder-training-coder.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import { CoderTraining } from '../../entities/coder-training.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { ResponseEntity } from '../../entities/response.entity';
import User from '../../entities/user.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import {
  WorkspaceExclusionService
} from '../workspace/workspace-exclusion.service';
import { WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';
import { CoderTrainingComparisonQueryService } from './coder-training-comparison-query.service';
import { CoderTrainingComparisonService } from './coder-training-comparison.service';
import { CoderTrainingDiscussionService } from './coder-training-discussion.service';
import { CoderTrainingDisplayService } from './coder-training-display.service';
import { CoderTrainingFreshnessService } from './coder-training-freshness.service';
import { CoderTrainingKappaService } from './coder-training-kappa.service';
import { CoderTrainingMutationService } from './coder-training-mutation.service';
import { CoderTrainingQueryService } from './coder-training-query.service';
import { CoderTrainingSelectionService } from './coder-training-selection.service';
import { CoderTrainingService } from './coder-training.service';
import { CodingJobService } from './coding-job.service';
import {
  CodingStatisticsService
} from './coding-statistics.service';
import {
  MissingsProfilesService
} from './missings-profiles.service';

export function createCoderTrainingService(codingJobRepository: Repository<CodingJob>,
  codingJobCoderRepository: Repository<CodingJobCoder>,
  codingJobVariableRepository: Repository<CodingJobVariable>,
  codingJobUnitRepository: Repository<CodingJobUnit>,
  coderTrainingRepository: Repository<CoderTraining>,
  coderTrainingVariableRepository: Repository<CoderTrainingVariable>,
  coderTrainingBundleRepository: Repository<CoderTrainingBundle>,
  coderTrainingCoderRepository: Repository<CoderTrainingCoder>,
  coderTrainingDiscussionResultRepository: Repository<CoderTrainingDiscussionResult>,
  codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
  userRepository: Repository<User>,
  responseRepository: Repository<ResponseEntity>,
  variableBundleRepository: Repository<VariableBundle>,
  chunkRepository: Repository<ChunkEntity>,
  codingJobService: CodingJobService,
  workspaceFilesService: WorkspaceFileMetadataReader,
  missingsProfilesService: MissingsProfilesService,
  workspaceExclusionService: WorkspaceExclusionService,
  codingStatisticsService: CodingStatisticsService): CoderTrainingService {
  const display = new CoderTrainingDisplayService(missingsProfilesService);
  const selection = new CoderTrainingSelectionService(codingJobUnitRepository, responseRepository, variableBundleRepository, chunkRepository, codingJobService, workspaceFilesService, workspaceExclusionService);
  const mutation = new CoderTrainingMutationService(codingJobUnitRepository, coderTrainingRepository, coderTrainingDiscussionResultRepository, codingJobService, missingsProfilesService, selection);
  const discussion = new CoderTrainingDiscussionService(coderTrainingRepository, codingJobService, missingsProfilesService, workspaceExclusionService, display);
  const comparisonQuery = new CoderTrainingComparisonQueryService(codingJobUnitRepository, coderTrainingDiscussionResultRepository, userRepository, display, discussion);
  const comparison = new CoderTrainingComparisonService(codingJobRepository, codingJobUnitRepository, coderTrainingRepository, coderTrainingDiscussionResultRepository, userRepository, workspaceExclusionService, display, comparisonQuery, discussion);
  const kappa = new CoderTrainingKappaService(codingJobRepository, codingJobUnitRepository, coderTrainingRepository, workspaceExclusionService, codingStatisticsService, display);
  const query = new CoderTrainingQueryService(coderTrainingRepository, workspaceExclusionService);
  const freshness = new CoderTrainingFreshnessService(codingJobRepository, codingJobUnitRepository, coderTrainingRepository, coderTrainingDiscussionResultRepository, workspaceExclusionService);
  const facade = new CoderTrainingService(selection, mutation, comparison, kappa, discussion, query, freshness);
  const providers = [display, selection, mutation, comparison, comparisonQuery, kappa, discussion, query, freshness];
  // Legacy behavioral fixtures probe private methods. Production uses explicit DI.
  const owners = new Map<string, object>();
  for (const provider of providers) {
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(provider))) {
      if (key !== 'constructor') owners.set(key, provider);
    }
  }
  return new Proxy(facade, {
    get(target, key) {
      const owner = (typeof key === 'string' ? owners.get(key) : undefined) || providers.find(provider => Reflect.has(provider, key));
      const value = Reflect.get(owner || target, key);
      return owner && typeof value === 'function' && !Reflect.get(value, '_isMockFunction') ? value.bind(owner) : value;
    },
    set(target, key, value) {
      const owner = typeof key === 'string' ? owners.get(key) : undefined;
      if (owner) return Reflect.set(owner, key, value);
      const matching = providers.filter(provider => Reflect.has(provider, key));
      if (matching.length) { matching.forEach(provider => Reflect.set(provider, key, value)); return true; }
      return Reflect.set(target, key, value);
    },
    getOwnPropertyDescriptor(target, key) {
      const owner = typeof key === 'string' ? owners.get(key) : undefined;
      if (owner) {
        return {
          configurable: true, enumerable: true, writable: true, value: Reflect.get(owner, key)
        };
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
}
