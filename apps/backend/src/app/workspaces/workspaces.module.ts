import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bull';
import { UsersModule } from '../users/users.module';
import { CacheModule } from '../cache/cache.module';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { FlatResponseFilterOptionsProcessor } from './processors/flat-response-filter-options.processor';
import { WorkspaceBullQueueService } from './services/workspace-bull-queue.service';
import { ResponseCacheSchedulerService } from './services/response-cache-scheduler.service';

// Entities from common module (shared across features)
import {
  Workspace, FileUpload, Persons, Unit, ResponseEntity, Job
} from '../common';

// Workspace-specific entities
import WorkspaceAdmin from './entities/workspace-admin.entity';
import WorkspaceUser from './entities/workspace_user.entity';
import { Booklet } from './entities/booklet.entity';
import { ChunkEntity } from './entities/chunk.entity';
import ResourcePackage from './entities/resource-package.entity';
import { Session } from './entities/session.entity';
import { BookletLog } from './entities/bookletLog.entity';
import { UnitLog } from './entities/unitLog.entity';
import { UnitLastState } from './entities/unitLastState.entity';
import { UnitTag } from './entities/unitTag.entity';
import { UnitNote } from './entities/unitNote.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { ValidationTask } from './entities/validation-task.entity';
import { Setting } from './entities/setting.entity';
import { ReplayStatistics } from './entities/replay-statistics.entity';
import Logs from './entities/logs.entity';
import { BookletInfo } from './entities/bookletInfo.entity';
import { VariableAnalysisJob } from './entities/variable-analysis-job.entity';
import { MissingsProfile } from './entities/missings-profile.entity';

// Services
import { WorkspaceCoreService } from './services/workspace-core.service';
import { WorkspaceFilesService } from './services/workspace-files.service';
import { WorkspaceXmlSchemaValidationService } from './services/workspace-xml-schema-validation.service';
import { WorkspaceFileStorageService } from './services/workspace-file-storage.service';
import { WorkspaceFileParsingService } from './services/workspace-file-parsing.service';
import { WorkspaceResponseValidationService } from './services/workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from './services/workspace-test-files-validation.service';
import { WorkspaceTestResultsService } from './services/workspace-test-results.service';
import { WorkspaceUsersService } from './services/workspace-users.service';
import { WorkspacePlayerService } from './services/workspace-player.service';
import { TestcenterService } from './services/testcenter.service';
import { UploadResultsService } from './services/upload-results.service';
import { PersonService } from './services/person.service';
import { UnitTagService } from './services/unit-tag.service';
import { UnitNoteService } from './services/unit-note.service';
import { ResourcePackageService } from './services/resource-package.service';
import { JournalService } from './services/journal.service';
import { JobService } from './services/job.service';
import { ValidationTaskService } from './services/validation-task.service';
import { ReplayStatisticsService } from './services/replay-statistics.service';
import { BookletInfoService } from './services/booklet-info.service';
import { UnitInfoService } from './services/unit-info.service';
import { VariableAnalysisService } from './services/variable-analysis.service';
import { MissingsProfilesService } from './services/missings-profiles.service';

import { WorkspaceEventsService } from './services/workspace-events.service';
import { WorkspacesFacadeService } from './services/workspaces-facade.service';
import { WorkspacesAdminFacade } from './services/workspaces-admin-facade.service';

// Refactored Test Results Services
import { WorkspaceTestResultsOverviewService } from './services/workspace-test-results-overview.service';
import { WorkspaceTestResultsQueryService } from './services/workspace-test-results-query.service';
import { DuplicateResponseService } from './services/duplicate-response.service';
import { FlatResponseService } from './services/flat-response.service';
import { ResponseExportService } from './services/response-export.service';
import { WorkspaceTestResultsFacade } from './services/workspace-test-results-facade.service';
import { FileQueryService } from './services/file-query.service';
import { FileDownloadService } from './services/file-download.service';
import { FileValidationService } from './services/file-validation.service';
import { FileUploadService } from './services/file-upload.service';
import { WorkspaceFilesFacade } from './services/workspace-files-facade.service';
import { XmlFileHandler } from './services/handlers/xml-file.handler';
import { HtmlFileHandler } from './services/handlers/html-file.handler';
import { OctetStreamFileHandler } from './services/handlers/octet-stream-file.handler';

@Module({
  imports: [
    HttpModule,
    CacheModule,
    UsersModule,
    JobQueueModule,
    BullModule.registerQueue({
      name: 'flat-response-filter-options'
    }),
    TypeOrmModule.forFeature([
      Workspace,
      WorkspaceAdmin,
      FileUpload,
      WorkspaceUser,
      Persons,
      Unit,
      Booklet,
      ResponseEntity,
      ChunkEntity,
      ResourcePackage,
      Session,
      BookletLog,
      UnitLog,
      UnitLastState,
      UnitTag,
      UnitNote,
      JournalEntry,
      ValidationTask,
      Setting,
      ReplayStatistics,
      Logs,
      BookletInfo,
      VariableAnalysisJob,
      MissingsProfile,
      Job
    ])
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
    WorkspacePlayerService,
    TestcenterService,
    UploadResultsService,
    PersonService,
    UnitTagService,
    UnitNoteService,
    ResourcePackageService,
    JournalService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService,
    BookletInfoService,
    UnitInfoService,
    VariableAnalysisService,
    MissingsProfilesService,

    WorkspaceEventsService,
    WorkspacesFacadeService,
    FlatResponseFilterOptionsProcessor,
    WorkspaceBullQueueService,
    ResponseCacheSchedulerService,
    // Refactored Test Results Services
    WorkspaceTestResultsOverviewService,
    WorkspaceTestResultsQueryService,
    DuplicateResponseService,
    FlatResponseService,
    ResponseExportService,
    WorkspaceTestResultsFacade,
    FileQueryService,
    FileDownloadService,
    FileValidationService,
    FileUploadService,
    WorkspaceFilesFacade,
    XmlFileHandler,
    HtmlFileHandler,
    OctetStreamFileHandler,
    WorkspacesAdminFacade
  ],
  exports: [
    WorkspacesFacadeService,
    WorkspaceBullQueueService,
    WorkspaceFilesFacade,
    WorkspaceTestResultsFacade,
    WorkspacesAdminFacade,
    WorkspaceCoreService,
    VariableAnalysisService,
    MissingsProfilesService,
    WorkspaceEventsService,
    WorkspaceTestResultsService,
    PersonService,
    JournalService
  ]
})
export class WorkspacesModule {}
