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
import { WorkspaceCoreService } from '../database/services/workspace-core.service';
import { WorkspaceFilesService } from '../database/services/workspace-files.service';
import { WorkspaceXmlSchemaValidationService } from '../database/services/workspace-xml-schema-validation.service';
import { WorkspaceFileStorageService } from '../database/services/workspace-file-storage.service';
import { WorkspaceFileParsingService } from '../database/services/workspace-file-parsing.service';
import { WorkspaceResponseValidationService } from '../database/services/workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from '../database/services/workspace-test-files-validation.service';
import { WorkspaceTestResultsService } from '../database/services/workspace-test-results.service';
import { WorkspaceUsersService } from '../database/services/workspace-users.service';
import { WorkspaceCodingService } from '../database/services/workspace-coding.service';
import { WorkspacePlayerService } from '../database/services/workspace-player.service';
import { TestcenterService } from '../database/services/testcenter.service';
import { UploadResultsService } from '../database/services/upload-results.service';
import { PersonService } from '../database/services/person.service';
import { UnitTagService } from '../database/services/unit-tag.service';
import { UnitNoteService } from '../database/services/unit-note.service';
import { ResourcePackageService } from '../database/services/resource-package.service';
import { JournalService } from '../database/services/journal.service';
import { VariableAnalysisService } from '../database/services/variable-analysis.service';
import { JobService } from '../database/services/job.service';
import { ValidationTaskService } from '../database/services/validation-task.service';
import { ReplayStatisticsService } from '../database/services/replay-statistics.service';
import { VariableAnalysisReplayService } from '../database/services/variable-analysis-replay.service';
import { ExportValidationResultsService } from '../database/services/export-validation-results.service';
import { BullJobManagementService } from '../database/services/bull-job-management.service';
import { ResponseManagementService } from '../database/services/response-management.service';
import { CodingListExportService } from '../database/services/coding-list-export.service';
import { CodingResultsExportService } from '../database/services/coding-results-export.service';
import { CodingTimesExportService } from '../database/services/coding-times-export.service';
import { CodingValidationService } from '../database/services/coding-validation.service';
import { CodingReviewService } from '../database/services/coding-review.service';
import { CodingAnalysisService } from '../database/services/coding-analysis.service';
import { CodingProgressService } from '../database/services/coding-progress.service';
import { CodingReplayService } from '../database/services/coding-replay.service';
import { CodingVersionService } from '../database/services/coding-version.service';
import { CodingJobOperationsService } from '../database/services/coding-job-operations.service';
import { CodebookGenerationService } from '../database/services/codebook-generation.service';
import { CodingResponseQueryService } from '../database/services/coding-response-query.service';
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
    CodingResponseQueryService
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
    CodingResponseQueryService
  ]
})
export class WorkspaceModule { }
