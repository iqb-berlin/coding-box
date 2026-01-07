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
import { ExportValidationResultsService } from './services/export-validation-results.service';
import { WorkspaceEventsService } from './services/workspace-events.service';
import { WorkspacesFacadeService } from './services/workspaces-facade.service';

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
    ExportValidationResultsService,
    WorkspaceEventsService,
    WorkspacesFacadeService,
    FlatResponseFilterOptionsProcessor,
    WorkspaceBullQueueService,
    ResponseCacheSchedulerService
  ],
  exports: [
    WorkspaceCoreService,
    WorkspaceFilesService,
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
    ExportValidationResultsService,
    WorkspaceEventsService,
    WorkspacesFacadeService,
    WorkspaceBullQueueService
  ]
})
export class WorkspacesModule {}
