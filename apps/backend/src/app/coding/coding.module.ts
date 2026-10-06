import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodingJob } from '../database/entities/coding-job.entity';
import { CodingJobCoder } from '../database/entities/coding-job-coder.entity';
import { CodingJobVariable } from '../database/entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../database/entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../database/entities/coding-job-unit.entity';
import { JobDefinition } from '../database/entities/job-definition.entity';
import { CoderTraining } from '../database/entities/coder-training.entity';
import { CoderTrainingVariable } from '../database/entities/coder-training-variable.entity';
import { CoderTrainingBundle } from '../database/entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../database/entities/coder-training-coder.entity';
import { CoderTrainingDiscussionResult } from '../database/entities/coder-training-discussion-result.entity';
import { MissingsProfile } from '../database/entities/missings-profile.entity';
import { VariableBundle } from '../database/entities/variable-bundle.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import FileUpload from '../database/entities/file_upload.entity';
import { Setting } from '../database/entities/setting.entity';
import User from '../database/entities/user.entity';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';
import { ChunkEntity } from '../database/entities/chunk.entity';
import { CodingUnitFreshness } from '../database/entities/coding-unit-freshness.entity';
import { CodingAggregationPeerService } from '../database/services/coding/coding-aggregation-peer.service';
import { CodingJobService } from '../database/services/coding/coding-job.service';
import { CodingListService } from '../database/services/coding/coding-list.service';
import { CodingFileCacheService } from '../database/services/coding/coding-file-cache.service';
import { CodingResponseFilterService } from '../database/services/coding/coding-response-filter.service';
import { CodingItemBuilderService } from '../database/services/coding/coding-item-builder.service';
import { CodingListQueryService } from '../database/services/coding/coding-list-query.service';
import { CodingListStreamService } from '../database/services/coding/coding-list-stream.service';
import { CodingStatisticsService } from '../database/services/coding/coding-statistics.service';
import { CodingResultsService } from '../database/services/coding/coding-results.service';
import { EmptyResponseSelectionService } from '../database/services/coding/empty-response-selection.service';
import { CodingExportService } from '../database/services/coding/coding-export.service';
import { CodingProcessService } from '../database/services/coding/coding-process.service';
import { CodingReplayAnchorService } from '../database/services/coding/coding-replay-anchor.service';
import { CoderTrainingService } from '../database/services/coding/coder-training.service';
import { CoderTrainingResultsApplyService } from '../database/services/coding/coder-training-results-apply.service';
import { MissingsProfilesService } from '../database/services/coding/missings-profiles.service';
import { ExternalCodingImportService } from '../database/services/coding/external-coding-import.service';
import { CodingValidationService } from '../database/services/coding/coding-validation.service';
import { CodingAnalysisService } from '../database/services/coding/coding-analysis.service';
import { CodingFreshnessService } from '../database/services/coding/coding-freshness.service';
import { AutoCodingRunGuardService } from '../database/services/coding/auto-coding-run-guard.service';
import { CodingReadinessService } from '../database/services/coding/coding-readiness.service';
import { CodingItemMatrixExportService } from '../database/services/coding/coding-item-matrix-export.service';
import { ItemDatasetMetadataService } from '../database/services/coding/item-dataset-metadata.service';
import { CodingPsychometricExportService } from '../database/services/coding/coding-psychometric-export.service';
import { PsychometricMetadataResolver } from '../database/services/coding/psychometric-metadata-resolver.service';
import { PsychometricResponseReader } from '../database/services/coding/psychometric-response-reader.service';
import { PsychometricAnalysisEngine } from '../database/services/coding/psychometric-analysis-engine';
import { PsychometricExportWriter } from '../database/services/coding/psychometric-export-writer.service';
import { CODING_PROCESS_CACHE_INVALIDATOR } from '../database/services/coding/coding-process-cache-invalidator.token';
import { CODING_READINESS_CACHE_INVALIDATOR } from '../database/services/coding/coding-readiness-cache-invalidator.token';
import { JobDefinitionService } from '../database/services/jobs';
import { JobQueueClientModule } from '../job-queue/job-queue-client.module';
import { CacheClientModule } from '../cache/cache-client.module';
// eslint-disable-next-line import/no-cycle
import { WorkspaceModule } from '../workspace/workspace.module';
import { UserModule } from '../user/user.module';
import { CodingJobMutationService } from '../database/services/coding/coding-job-mutation.service';
import { CodingJobResponsesService } from '../database/services/coding/coding-job-responses.service';
import { CodingJobAccessService } from '../database/services/coding/coding-job-access.service';
import { CodingJobQueryService } from '../database/services/coding/coding-job-query.service';
import { CodingJobDistributionService } from '../database/services/coding/coding-job-distribution.service';
import { CodingJobStatusService } from '../database/services/coding/coding-job-status.service';
import { CodingJobProgressService } from '../database/services/coding/coding-job-progress.service';
import { CodingJobSchemeService } from '../database/services/coding/coding-job-scheme.service';
import { CodingJobReplayService } from '../database/services/coding/coding-job-replay.service';
import { CodingJobAggregationService } from '../database/services/coding/coding-job-aggregation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CodingJob,
      CodingJobCoder,
      CodingJobVariable,
      CodingJobVariableBundle,
      CodingJobUnit,
      JobDefinition,
      CoderTraining,
      CoderTrainingVariable,
      CoderTrainingBundle,
      CoderTrainingCoder,
      CoderTrainingDiscussionResult,
      MissingsProfile,
      VariableBundle,
      ResponseEntity,
      User,
      FileUpload,
      Setting,
      Persons,
      Unit,
      Booklet,
      ChunkEntity,
      CodingUnitFreshness
    ]),
    JobQueueClientModule,
    CacheClientModule,
    forwardRef(() => WorkspaceModule),
    UserModule
  ],
  providers: [
    CodingJobMutationService,
    CodingJobResponsesService,
    CodingJobAccessService,
    CodingJobQueryService,
    CodingJobDistributionService,
    CodingJobStatusService,
    CodingJobProgressService,
    CodingJobSchemeService,
    CodingJobReplayService,
    CodingJobAggregationService,

    CodingAggregationPeerService,
    CodingJobService,
    JobDefinitionService,
    CodingStatisticsService,
    MissingsProfilesService,
    CodingFileCacheService,
    CodingResponseFilterService,
    CodingItemBuilderService,
    CodingListQueryService,
    CodingListStreamService,
    CodingListService,
    CoderTrainingService,
    CoderTrainingResultsApplyService,
    ExternalCodingImportService,
    EmptyResponseSelectionService,
    CodingResultsService,
    CodingExportService,
    CodingProcessService,
    CodingReplayAnchorService,
    CodingValidationService,
    CodingAnalysisService,
    CodingFreshnessService,
    AutoCodingRunGuardService,
    CodingReadinessService,
    ItemDatasetMetadataService,
    CodingItemMatrixExportService,
    PsychometricMetadataResolver,
    PsychometricResponseReader,
    PsychometricAnalysisEngine,
    PsychometricExportWriter,
    CodingPsychometricExportService,
    {
      provide: CODING_PROCESS_CACHE_INVALIDATOR,
      useExisting: CodingProcessService
    },
    {
      provide: CODING_READINESS_CACHE_INVALIDATOR,
      useExisting: CodingReadinessService
    }
  ],
  exports: [
    CodingAggregationPeerService,
    CodingJobService,
    JobDefinitionService,
    CodingStatisticsService,
    MissingsProfilesService,
    CodingFileCacheService,
    CodingResponseFilterService,
    CodingItemBuilderService,
    CodingListQueryService,
    CodingListStreamService,
    CodingListService,
    CoderTrainingService,
    CoderTrainingResultsApplyService,
    ExternalCodingImportService,
    EmptyResponseSelectionService,
    CodingResultsService,
    CodingExportService,
    CodingProcessService,
    CodingReplayAnchorService,
    CodingValidationService,
    CodingAnalysisService,
    CodingFreshnessService,
    AutoCodingRunGuardService,
    CodingReadinessService,
    ItemDatasetMetadataService,
    CodingItemMatrixExportService,
    PsychometricMetadataResolver,
    CodingPsychometricExportService,
    CODING_PROCESS_CACHE_INVALIDATOR,
    CODING_READINESS_CACHE_INVALIDATOR
  ]
})
export class CodingModule {}
