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
import { MissingsProfile } from '../database/entities/missings-profile.entity';
import { VariableBundle } from '../database/entities/variable-bundle.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import FileUpload from '../database/entities/file_upload.entity';
import { Setting } from '../database/entities/setting.entity';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';

import {
  CodingJobService,
  CodingListService,
  CodingFileCacheService,
  CodingResponseFilterService,
  CodingItemBuilderService,
  CodingListQueryService,
  CodingListStreamService,
  CodingStatisticsService,
  CodingResultsService,
  CodingExportService,
  CodingProcessService,
  CoderTrainingService,
  MissingsProfilesService,
  ExternalCodingImportService,
  CodingValidationService,
  CodingAnalysisService
} from '../database/services/coding';
import { JobDefinitionService } from '../database/services/jobs';
// eslint-disable-next-line import/no-cycle
import { JobQueueModule } from '../job-queue/job-queue.module';
// eslint-disable-next-line import/no-cycle
import { CacheModule } from '../cache/cache.module';
// eslint-disable-next-line import/no-cycle
import { WorkspaceModule } from '../workspace/workspace.module';

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
      MissingsProfile,
      VariableBundle,
      ResponseEntity,
      FileUpload,
      Setting,
      Persons,
      Unit,
      Booklet
    ]),
    forwardRef(() => JobQueueModule),
    forwardRef(() => CacheModule),
    forwardRef(() => WorkspaceModule)
  ],
  providers: [
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
    ExternalCodingImportService,
    CodingResultsService,
    CodingExportService,
    CodingProcessService,
    CodingValidationService,
    CodingAnalysisService
  ],
  exports: [
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
    ExternalCodingImportService,
    CodingResultsService,
    CodingExportService,
    CodingProcessService,
    CodingValidationService,
    CodingAnalysisService
  ]
})
export class CodingModule { }
