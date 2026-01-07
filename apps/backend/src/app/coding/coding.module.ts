import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { CacheModule } from '../cache/cache.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

// Coding Entities
import { CodingJob } from './entities/coding-job.entity';
import { VocsService } from './services/vocs.service';
import { VoudService } from './services/voud.service';
import { FileUpload, ResponseEntity } from '../common';
import { CodingJobCoder } from './entities/coding-job-coder.entity';
import { CodingJobVariable } from './entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from './entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from './entities/coding-job-unit.entity';
import { JobDefinition } from './entities/job-definition.entity';
import { CoderTraining } from './entities/coder-training.entity';
import { VariableBundle } from './entities/variable-bundle.entity';
import { TestPersonCodingJob } from './entities/test-person-coding-job.entity';
// Coding Services
import { CodingJobService } from './services/coding-job.service';
import { WorkspaceCodingService } from './services/workspace-coding.service';
import { CodingStatisticsService } from './services/coding-statistics.service';
import { JobDefinitionService } from './services/job-definition.service';
import { CoderTrainingService } from './services/coder-training.service';
import { CodingListService } from './services/coding-list.service';
import { VariableAnalysisReplayService } from './services/variable-analysis-replay.service';
import { ExternalCodingImportService } from './services/external-coding-import.service';
import { CodingResultsService } from './services/coding-results.service';
import { CodingExportService } from './services/coding-export.service';
import { VariableBundleService } from './services/variable-bundle.service';
import { CodingFileCache } from './services/coding-file-cache.service';
import { CodingJobManager } from './services/coding-job-manager.service';
import { CodingProcessor } from './services/coding-processor.service';
import { BullJobManagementService } from './services/bull-job-management.service';
import { CodingIncompleteCacheSchedulerService } from './services/coding-incomplete-cache-scheduler.service';
import { CodingStatisticsCacheSchedulerService } from './services/coding-statistics-cache-scheduler.service';
import { CodingValidationService } from './services/coding-validation.service';
import { CodingSchemeService } from './services/coding-scheme.service';
import { CodingReplayService } from './services/coding-replay.service';
import { DoubleCodingService } from './services/double-coding.service';
import { CodingJobQueryService } from './services/coding-job-query.service';
import { CodingJobMutationService } from './services/coding-job-mutation.service';
import { CodingJobAssignmentService } from './services/coding-job-assignment.service';
import { ResponseDistributionService } from './services/response-distribution.service';
import { CodingJobFacade } from './services/coding-job-facade.service';

// Coding Controllers
import { CodingJobController } from './controllers/coding-job.controller';
import { CodingJobsController } from './controllers/coding-jobs.controller';
import { WorkspaceCodingController } from './controllers/workspace-coding.controller';

// Coding Processors (Bull Queue)
import { CodingStatisticsProcessor } from './processors/coding-statistics.processor';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';
import { ExportJobProcessor } from './processors/export-job.processor';

import { TestPersonCodingService } from './services/test-person-coding.service';
import { WorkspaceCodingFacade } from './services/workspace-coding-facade.service';
import { ExportValidationResultsService } from './services/export-validation-results.service';

// Export Services
import { ExportUrlService } from './services/export-url.service';
import { ExportFormattingService } from './services/export-formatting.service';
import { AggregatedExportService } from './services/aggregated-export.service';
import { CoderExportService } from './services/coder-export.service';
import { VariableExportService } from './services/variable-export.service';
import { DetailedExportService } from './services/detailed-export.service';
import { CodingTimesExportService } from './services/coding-times-export.service';
import { CodingExportFacade } from './services/coding-export-facade.service';

/**
 * CodingModule - Feature Module for Coding Functionality
 *
 * This module encapsulates all coding-related functionality:
 * - Coding jobs and their management
 * - Coding statistics and exports
 * - Variable analysis and bundles
 * - Coder training
 * - Job definitions and missings profiles
 *
 * Only essential services are exported for use by other modules.
 */
@Module({
  imports: [
    HttpModule,
    CacheModule,
    JobQueueModule,
    WorkspacesModule,
    BullModule.registerQueue({
      name: 'test-person-coding'
    }),
    BullModule.registerQueue({
      name: 'coding-statistics'
    }),
    BullModule.registerQueue({
      name: 'data-export'
    }),
    AuthModule,
    UsersModule,
    TypeOrmModule.forFeature([
      // Coding-specific entities
      CodingJob,
      CodingJobCoder,
      CodingJobVariable,
      CodingJobVariableBundle,
      CodingJobUnit,
      JobDefinition,
      CoderTraining,
      VariableBundle,
      TestPersonCodingJob,
      FileUpload,
      // Shared entities used by coding services
      ResponseEntity
    ])
  ],
  controllers: [
    CodingJobController,
    CodingJobsController,
    WorkspaceCodingController
  ],
  providers: [
    // Core services
    CodingJobService,
    WorkspaceCodingService,
    TestPersonCodingService,
    WorkspaceCodingFacade,
    CodingFileCache,
    CodingJobManager,
    CodingProcessor,
    BullJobManagementService,
    CodingStatisticsService,
    CodingResultsService,
    CodingExportService,
    CodingListService,
    VocsService,
    VoudService,
    CodingJobQueryService,
    CodingJobMutationService,
    CodingJobAssignmentService,
    ResponseDistributionService,
    CodingJobFacade,

    // Supporting services
    JobDefinitionService,
    CoderTrainingService,
    VariableAnalysisReplayService,
    VariableBundleService,
    ExternalCodingImportService,
    CodingValidationService,
    CodingSchemeService,
    CodingReplayService,
    DoubleCodingService,

    // Export services
    ExportUrlService,
    ExportFormattingService,
    AggregatedExportService,
    CoderExportService,
    VariableExportService,
    DetailedExportService,
    CodingTimesExportService,
    CodingExportFacade,
    ExportValidationResultsService,

    // Processors
    CodingStatisticsProcessor,
    TestPersonCodingProcessor,
    ExportJobProcessor,

    // Schedulers
    CodingIncompleteCacheSchedulerService,
    CodingStatisticsCacheSchedulerService
  ],
  exports: [
    // AdminModule/WorkspaceModule/WsgAdminModule need these
    WorkspaceCodingFacade,
    CodingJobService,
    BullJobManagementService,
    WorkspaceCodingService
  ]
})
export class CodingModule {}
