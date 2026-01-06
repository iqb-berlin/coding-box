import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
// eslint-disable-next-line import/no-cycle
import { JobQueueModule } from '../job-queue/job-queue.module';
import { CacheModule } from '../cache/cache.module';
// eslint-disable-next-line import/no-cycle
import { WorkspacesModule } from '../workspaces/workspaces.module';

// Entities
import { CodingJob } from '../database/entities/coding-job.entity';
import { CodingJobCoder } from '../database/entities/coding-job-coder.entity';
import { CodingJobVariable } from '../database/entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../database/entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../database/entities/coding-job-unit.entity';
import { JobDefinition } from '../database/entities/job-definition.entity';
import { MissingsProfile } from '../database/entities/missings-profile.entity';
import { CoderTraining } from '../database/entities/coder-training.entity';
import { VariableBundle } from '../database/entities/variable-bundle.entity';
import { VariableAnalysisJob } from '../database/entities/variable-analysis-job.entity';

// Shared Entities needed by Coding Services
import FileUpload from '../database/entities/file_upload.entity';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import { Job } from '../database/entities/job.entity'; // For generic job access?

// Services
import { CodingJobService } from '../database/services/coding-job.service';
import { WorkspaceCodingService } from '../database/services/workspace-coding.service';
import { CodingStatisticsService } from '../database/services/coding-statistics.service';
import { MissingsProfilesService } from '../database/services/missings-profiles.service';
import { JobDefinitionService } from '../database/services/job-definition.service';
import { CoderTrainingService } from '../database/services/coder-training.service';
import { CodingListService } from '../database/services/coding-list.service';
import { VariableAnalysisReplayService } from '../database/services/variable-analysis-replay.service';
import { ExternalCodingImportService } from '../database/services/external-coding-import.service';
import { BullJobManagementService } from '../database/services/bull-job-management.service';
import { CodingResultsService } from '../database/services/coding-results.service';
import { CodingExportService } from '../database/services/coding-export.service';
import { VariableBundleService } from '../database/services/variable-bundle.service';
import { VariableAnalysisService } from '../database/services/variable-analysis.service';

@Module({
  imports: [
    HttpModule,
    CacheModule,
    forwardRef(() => JobQueueModule),
    forwardRef(() => WorkspacesModule),
    TypeOrmModule.forFeature([
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
      // Shared entities often used in coding
      FileUpload,
      Persons,
      Unit,
      Booklet,
      ResponseEntity,
      Job
    ])
  ],
  providers: [
    CodingJobService,
    WorkspaceCodingService,
    CodingStatisticsService,
    MissingsProfilesService,
    JobDefinitionService,
    CoderTrainingService,
    CodingListService,
    VariableAnalysisReplayService,
    ExternalCodingImportService,
    BullJobManagementService,
    CodingResultsService,
    CodingExportService,
    VariableBundleService,
    VariableAnalysisService
  ],
  exports: [
    CodingJobService,
    WorkspaceCodingService,
    CodingStatisticsService,
    MissingsProfilesService,
    JobDefinitionService,
    CoderTrainingService,
    CodingListService,
    VariableAnalysisReplayService,
    ExternalCodingImportService,
    BullJobManagementService,
    CodingResultsService,
    CodingExportService,
    VariableBundleService,
    VariableAnalysisService,
    TypeOrmModule
  ]
})
export class CodingModule {}
