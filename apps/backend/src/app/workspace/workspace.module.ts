import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import Workspace from '../database/entities/workspace.entity';
import WorkspaceAdmin from '../database/entities/workspace-admin.entity';
import FileUpload from '../database/entities/file_upload.entity';
import WorkspaceUser from '../database/entities/workspace_user.entity';
import ResourcePackage from '../database/entities/resource-package.entity';
import Logs from '../database/entities/logs.entity';
import Persons from '../database/entities/persons.entity';
import { BookletLog } from '../database/entities/bookletLog.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';
import { BookletInfo } from '../database/entities/bookletInfo.entity';
import { UnitLog } from '../database/entities/unitLog.entity';
import { UnitLastState } from '../database/entities/unitLastState.entity';
import { ChunkEntity } from '../database/entities/chunk.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import { Session } from '../database/entities/session.entity';
import { UnitTag } from '../database/entities/unitTag.entity';
import { UnitNote } from '../database/entities/unitNote.entity';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { Job } from '../database/entities/job.entity';
import { VariableAnalysisJob } from '../database/entities/variable-analysis-job.entity';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { Setting } from '../database/entities/setting.entity';
import { ReplayStatistics } from '../database/entities/replay-statistics.entity';
import { VariableBundle } from '../database/entities/variable-bundle.entity';
import User from '../database/entities/user.entity';
import { CodingJob } from '../database/entities/coding-job.entity';
import { CodingJobUnit } from '../database/entities/coding-job-unit.entity';
import { CodingJobVariable } from '../database/entities/coding-job-variable.entity';
import { JobDefinition } from '../database/entities/job-definition.entity';
import {
  WorkspaceCoreService,
  WorkspaceFilesService,
  WorkspaceXmlSchemaValidationService,
  WorkspaceFileStorageService,
  WorkspaceFileParsingService,
  WorkspaceCodingService,
  WorkspacePlayerService,
  WorkspaceUsersService,
  ResourcePackageService,
  UnitInfoService,
  UnitTagService,
  UnitNoteService,
  BookletInfoService
} from '../database/services/workspace';
import {
  WorkspaceTestResultsService,
  TestcenterService,
  UploadResultsService,
  PersonService,
  ResponseManagementService,
  VariableAnalysisService,
  VariableAnalysisReplayService,
  ReplayStatisticsService
} from '../database/services/test-results';
import {
  WorkspaceResponseValidationService,
  WorkspaceTestFilesValidationService,
  ExportValidationResultsService,
  ValidationTaskService
} from '../database/services/validation';
import {
  CodingListExportService,
  CodingResultsExportService,
  CodingTimesExportService,
  CodingValidationService,
  CodingReviewService,
  CodingAnalysisService,
  CodingProgressService,
  CodingReplayService,
  CodingVersionService,
  CodingJobOperationsService,
  CodebookGenerationService,
  CodingResponseQueryService
} from '../database/services/coding';
import {
  JobService,
  BullJobManagementService
} from '../database/services/jobs';
import { JournalService } from '../database/services/shared';
// eslint-disable-next-line import/no-cycle
import { JobQueueModule } from '../job-queue/job-queue.module';
// eslint-disable-next-line import/no-cycle
import { CacheModule } from '../cache/cache.module';
// eslint-disable-next-line import/no-cycle
import { CodingModule } from '../coding/coding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workspace,
      WorkspaceAdmin,
      FileUpload,
      Logs,
      ResponseEntity,
      WorkspaceUser,
      ResourcePackage,
      Persons,
      Booklet,
      BookletInfo,
      Unit,
      ChunkEntity,
      BookletLog,
      UnitLog,
      UnitLastState,
      Session,
      UnitTag,
      UnitNote,
      JournalEntry,
      Job,
      VariableAnalysisJob,
      ValidationTask,
      Setting,
      ReplayStatistics,
      VariableBundle,
      User,
      CodingJob,
      CodingJobUnit,
      CodingJobVariable,
      JobDefinition
    ]),
    HttpModule,
    forwardRef(() => JobQueueModule),
    forwardRef(() => CacheModule),
    forwardRef(() => CodingModule)
  ],
  providers: [
    WorkspaceCoreService,
    WorkspaceFilesService,
    WorkspaceXmlSchemaValidationService,
    WorkspaceFileStorageService,
    WorkspaceFileParsingService,
    WorkspaceResponseValidationService,
    WorkspaceTestFilesValidationService,
    WorkspaceTestResultsService,
    WorkspaceUsersService,
    WorkspaceCodingService,
    WorkspacePlayerService,
    TestcenterService,
    UploadResultsService,
    PersonService,
    JwtService,
    UnitTagService,
    UnitNoteService,
    ResourcePackageService,
    JournalService,
    VariableAnalysisService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService,
    VariableAnalysisReplayService,
    ExportValidationResultsService,
    BullJobManagementService,
    ResponseManagementService,
    CodingListExportService,
    CodingResultsExportService,
    CodingTimesExportService,
    CodingValidationService,
    CodingReviewService,
    CodingAnalysisService,
    CodingProgressService,
    CodingReplayService,
    CodingVersionService,
    CodingJobOperationsService,
    CodebookGenerationService,
    CodingResponseQueryService,
    UnitInfoService,
    BookletInfoService
  ],
  exports: [
    WorkspaceCoreService,
    WorkspaceFilesService,
    WorkspaceTestResultsService,
    WorkspaceUsersService,
    WorkspaceCodingService,
    WorkspacePlayerService,
    TestcenterService,
    UploadResultsService,
    ResourcePackageService,
    PersonService,
    UnitTagService,
    UnitNoteService,
    JournalService,
    VariableAnalysisService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService,
    VariableAnalysisReplayService,
    ExportValidationResultsService,
    BullJobManagementService,
    ResponseManagementService,
    CodingListExportService,
    CodingResultsExportService,
    CodingTimesExportService,
    CodingValidationService,
    CodingReviewService,
    CodingAnalysisService,
    CodingProgressService,
    CodingReplayService,
    CodingVersionService,
    CodingJobOperationsService,
    CodebookGenerationService,
    CodingResponseQueryService,
    UnitInfoService,
    BookletInfoService
  ]
})
export class WorkspaceModule { }
