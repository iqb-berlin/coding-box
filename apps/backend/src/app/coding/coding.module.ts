import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
// eslint-disable-next-line import/no-cycle
import { JobQueueModule } from '../job-queue/job-queue.module';
// eslint-disable-next-line import/no-cycle
import { CacheModule } from '../cache/cache.module';
// eslint-disable-next-line import/no-cycle
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

// Coding Entities
import { CodingJob } from './entities/coding-job.entity';
import { CodingJobCoder } from './entities/coding-job-coder.entity';
import { CodingJobVariable } from './entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from './entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from './entities/coding-job-unit.entity';
import { JobDefinition } from './entities/job-definition.entity';
import { MissingsProfile } from './entities/missings-profile.entity';
import { CoderTraining } from './entities/coder-training.entity';
import { VariableBundle } from './entities/variable-bundle.entity';
import { VariableAnalysisJob } from './entities/variable-analysis-job.entity';
import { TestPersonCodingJob } from './entities/test-person-coding-job.entity';

// Shared Entities needed by Coding Services (from other modules)
import FileUpload from '../workspaces/entities/file_upload.entity';
import Persons from '../workspaces/entities/persons.entity';
import { Unit } from '../workspaces/entities/unit.entity';
import { Booklet } from '../workspaces/entities/booklet.entity';
import { ResponseEntity } from '../workspaces/entities/response.entity';
import { Job } from '../workspaces/entities/job.entity';

// Coding Services
import { CodingJobService } from './services/coding-job.service';
import { WorkspaceCodingService } from './services/workspace-coding.service';
import { CodingStatisticsService } from './services/coding-statistics.service';
import { MissingsProfilesService } from './services/missings-profiles.service';
import { JobDefinitionService } from './services/job-definition.service';
import { CoderTrainingService } from './services/coder-training.service';
import { CodingListService } from './services/coding-list.service';
import { VariableAnalysisReplayService } from './services/variable-analysis-replay.service';
import { ExternalCodingImportService } from './services/external-coding-import.service';
import { CodingResultsService } from './services/coding-results.service';
import { CodingExportService } from './services/coding-export.service';
import { VariableBundleService } from './services/variable-bundle.service';
import { VariableAnalysisService } from './services/variable-analysis.service';
import { CodingFileCache } from './services/coding-file-cache.service';
import { CodingJobManager } from './services/coding-job-manager.service';
import { CodingProcessor } from './services/coding-processor.service';
import { BullJobManagementService } from './services/bull-job-management.service';

// Coding Controllers
import { CodingJobController } from './controllers/coding-job.controller';
import { CodingJobsController } from './controllers/coding-jobs.controller';
import { WorkspaceCodingController } from './controllers/workspace-coding.controller';

// Coding Processors (Bull Queue)
import { CodingStatisticsProcessor } from './processors/coding-statistics.processor';
import { TestPersonCodingProcessor } from './processors/test-person-coding.processor';

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
    forwardRef(() => CacheModule),
    forwardRef(() => JobQueueModule),
    forwardRef(() => WorkspacesModule),
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
      MissingsProfile,
      CoderTraining,
      VariableBundle,
      VariableAnalysisJob,
      TestPersonCodingJob,
      // Shared entities used by coding services
      FileUpload,
      Persons,
      Unit,
      Booklet,
      ResponseEntity,
      Job
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
    CodingFileCache,
    CodingJobManager,
    CodingProcessor,
    BullJobManagementService,
    CodingStatisticsService,
    CodingResultsService,
    CodingExportService,
    CodingListService,

    // Supporting services
    MissingsProfilesService,
    JobDefinitionService,
    CoderTrainingService,
    VariableAnalysisReplayService,
    VariableAnalysisService,
    VariableBundleService,
    ExternalCodingImportService,

    // Processors
    CodingStatisticsProcessor,
    TestPersonCodingProcessor
  ],
  exports: [
    // Only export services that are distinctively needed by other modules
    // CacheModule needs these for cache invalidation
    CodingStatisticsService,
    WorkspaceCodingService,

    // AdminModule/WorkspaceModule may need these
    CodingJobService,
    CodingExportService,
    CodingListService,
    VariableAnalysisService,
    MissingsProfilesService,

    // Keep TypeOrmModule export for potential forFeature usage elsewhere
    TypeOrmModule
  ]
})
export class CodingModule {}
