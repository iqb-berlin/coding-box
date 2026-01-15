import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodingJob } from '../database/entities/coding-job.entity';
import { CodingJobCoder } from '../database/entities/coding-job-coder.entity';
import { CodingJobVariable } from '../database/entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from '../database/entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from '../database/entities/coding-job-unit.entity';
import { JobDefinition } from '../database/entities/job-definition.entity';
import { CoderTraining } from '../database/entities/coder-training.entity';
import { MissingsProfile } from '../database/entities/missings-profile.entity';
import { VariableBundle } from '../database/entities/variable-bundle.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import FileUpload from '../database/entities/file_upload.entity';
import { Setting } from '../database/entities/setting.entity';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';

import { CodingJobService } from '../database/services/coding-job.service';
import { CodingListService } from '../database/services/coding-list.service';
import { CodingStatisticsService } from '../database/services/coding-statistics.service';
import { CodingResultsService } from '../database/services/coding-results.service';
import { CodingExportService } from '../database/services/coding-export.service';
import { CodingProcessService } from '../database/services/coding-process.service';
import { CoderTrainingService } from '../database/services/coder-training.service';
import { JobDefinitionService } from '../database/services/job-definition.service';
import { MissingsProfilesService } from '../database/services/missings-profiles.service';
import { ExternalCodingImportService } from '../database/services/external-coding-import.service';
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
    CodingListService,
    CoderTrainingService,
    ExternalCodingImportService,
    CodingResultsService,
    CodingExportService,
    CodingProcessService
  ],
  exports: [
    CodingJobService,
    JobDefinitionService,
    CodingStatisticsService,
    MissingsProfilesService,
    CodingListService,
    CoderTrainingService,
    ExternalCodingImportService,
    CodingResultsService,
    CodingExportService,
    CodingProcessService
  ]
})
export class CodingModule { }
