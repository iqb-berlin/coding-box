import { Repository, Connection } from 'typeorm';
import { createFacadeTestProxy } from '../shared/facade-test.factory';
import { CodingJobService } from './coding-job.service';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobCoder } from '../../entities/coding-job-coder.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../../entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CoderTrainingDiscussionResult } from '../../entities/coder-training-discussion-result.entity';
import { VariableBundle } from '../../entities/variable-bundle.entity';
import { ResponseEntity } from '../../entities/response.entity';
import FileUpload from '../../entities/file_upload.entity';
import { Setting } from '../../entities/setting.entity';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { UsersService } from '../users';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';
import { MissingsProfilesService } from './missings-profiles.service';
import { CodingAggregationPeerService } from './coding-aggregation-peer.service';
import { RuntimeConfigService } from '../../../config/runtime-config.service';
import { CodingJobMutationService } from './coding-job-mutation.service';
import { CodingJobResponsesService } from './coding-job-responses.service';
import { CodingJobAccessService } from './coding-job-access.service';
import { CodingJobQueryService } from './coding-job-query.service';
import { CodingJobDistributionService } from './coding-job-distribution.service';
import { CodingJobStatusService } from './coding-job-status.service';
import { CodingJobProgressService } from './coding-job-progress.service';
import { CodingJobSchemeService } from './coding-job-scheme.service';
import { CodingJobReplayService } from './coding-job-replay.service';
import { CodingJobAggregationService } from './coding-job-aggregation.service';

export function createCodingJobService(codingJobRepository: Repository<CodingJob>,
  codingJobCoderRepository: Repository<CodingJobCoder>,
  codingJobVariableRepository: Repository<CodingJobVariable>,
  codingJobVariableBundleRepository: Repository<CodingJobVariableBundle>,
  codingJobUnitRepository: Repository<CodingJobUnit>,
  variableBundleRepository: Repository<VariableBundle>,
  responseRepository: Repository<ResponseEntity>,
  fileUploadRepository: Repository<FileUpload>,
  settingRepository: Repository<Setting>,
  connection: Connection,
  cacheService: CacheService,
  workspaceFilesService: WorkspaceFilesService,
  workspaceExclusionService: WorkspaceExclusionService,
  usersService: UsersService,
  codingAggregationPeerService: CodingAggregationPeerService,
  codingFreshnessService?: CodingFreshnessService,
  codingFileCacheService?: CodingFileCacheService,
  missingsProfilesService?: MissingsProfilesService,
  coderTrainingDiscussionResultRepository?: Repository<CoderTrainingDiscussionResult>,
  replayAnchorService?: CodingReplayAnchorService,
  runtimeConfig?: RuntimeConfigService): CodingJobService {
  const derivedVariableReader = workspaceFilesService;
  const query = new CodingJobQueryService(codingJobRepository, codingJobCoderRepository, codingJobVariableRepository, codingJobVariableBundleRepository, codingJobUnitRepository, variableBundleRepository, workspaceExclusionService, codingFreshnessService);
  const aggregation = new CodingJobAggregationService(settingRepository, derivedVariableReader);
  const access = new CodingJobAccessService(codingJobRepository, codingJobCoderRepository, settingRepository, usersService);
  const responses = new CodingJobResponsesService(codingJobRepository, codingJobVariableRepository, codingJobVariableBundleRepository, codingJobUnitRepository, responseRepository, workspaceExclusionService, codingAggregationPeerService, query, missingsProfilesService);
  const mutation = new CodingJobMutationService(codingJobRepository, codingJobCoderRepository, codingJobVariableRepository, codingJobVariableBundleRepository, codingJobUnitRepository, connection, cacheService, workspaceExclusionService, access, aggregation, query, responses, missingsProfilesService, coderTrainingDiscussionResultRepository);
  const distribution = new CodingJobDistributionService(codingJobRepository, codingJobUnitRepository, connection, derivedVariableReader, access, aggregation, mutation, query, responses);
  const scheme = new CodingJobSchemeService(fileUploadRepository, codingFileCacheService, replayAnchorService, runtimeConfig);
  const progress = new CodingJobProgressService(codingJobRepository, codingJobUnitRepository, connection, workspaceExclusionService, access, mutation, query, scheme);
  const replay = new CodingJobReplayService(codingJobRepository, codingJobVariableBundleRepository, codingJobUnitRepository, variableBundleRepository, responseRepository, workspaceExclusionService, query, scheme);
  const status = new CodingJobStatusService(access, mutation, query);
  const facade = new CodingJobService(access, aggregation, distribution, mutation, progress, query, replay, responses, scheme, status);
  const providers = {
    mutation, responses, access, query, distribution, status, progress, scheme, replay, aggregation
  };
  return createFacadeTestProxy(facade, Object.values(providers));
}
