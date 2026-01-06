import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { UsersModule } from '../users/users.module';
// eslint-disable-next-line import/no-cycle
import { CodingModule } from '../coding/coding.module';
// eslint-disable-next-line import/no-cycle
import { CacheModule } from '../cache/cache.module';
// eslint-disable-next-line import/no-cycle
import { JobQueueModule } from '../job-queue/job-queue.module';

// Entities
import Workspace from '../database/entities/workspace.entity';
import WorkspaceAdmin from '../database/entities/workspace-admin.entity';
import FileUpload from '../database/entities/file_upload.entity';
import WorkspaceUser from '../database/entities/workspace_user.entity';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
import { Booklet } from '../database/entities/booklet.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import { ChunkEntity } from '../database/entities/chunk.entity';
import ResourcePackage from '../database/entities/resource-package.entity';
import { Session } from '../database/entities/session.entity';
import { BookletLog } from '../database/entities/bookletLog.entity';
import { UnitLog } from '../database/entities/unitLog.entity';
import { UnitLastState } from '../database/entities/unitLastState.entity';
import { UnitTag } from '../database/entities/unitTag.entity';
import { UnitNote } from '../database/entities/unitNote.entity';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { Setting } from '../database/entities/setting.entity';
import { ReplayStatistics } from '../database/entities/replay-statistics.entity';
import Logs from '../database/entities/logs.entity';
import { BookletInfo } from '../database/entities/bookletInfo.entity';
import { Job } from '../database/entities/job.entity';

// Services
import { WorkspaceCoreService } from '../database/services/workspace-core.service';
import { WorkspaceFilesService } from '../database/services/workspace-files.service';
import { WorkspaceXmlSchemaValidationService } from '../database/services/workspace-xml-schema-validation.service';
import { WorkspaceFileStorageService } from '../database/services/workspace-file-storage.service';
import { WorkspaceFileParsingService } from '../database/services/workspace-file-parsing.service';
import { WorkspaceResponseValidationService } from '../database/services/workspace-response-validation.service';
import { WorkspaceTestFilesValidationService } from '../database/services/workspace-test-files-validation.service';
import { WorkspaceTestResultsService } from '../database/services/workspace-test-results.service';
import { WorkspaceUsersService } from '../database/services/workspace-users.service';
import { WorkspacePlayerService } from '../database/services/workspace-player.service';
import { TestcenterService } from '../database/services/testcenter.service';
import { UploadResultsService } from '../database/services/upload-results.service';
import { PersonService } from '../database/services/person.service';
import { UnitTagService } from '../database/services/unit-tag.service';
import { UnitNoteService } from '../database/services/unit-note.service';
import { ResourcePackageService } from '../database/services/resource-package.service';
import { JournalService } from '../database/services/journal.service';
import { JobService } from '../database/services/job.service';
import { ValidationTaskService } from '../database/services/validation-task.service';
import { ReplayStatisticsService } from '../database/services/replay-statistics.service';
import { BookletInfoService } from '../database/services/booklet-info.service';
import { UnitInfoService } from '../database/services/unit-info.service';
import { ExportValidationResultsService } from '../database/services/export-validation-results.service';

@Module({
  imports: [
    HttpModule,
    forwardRef(() => CacheModule),
    UsersModule,
    forwardRef(() => CodingModule),
    forwardRef(() => JobQueueModule),
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
    ExportValidationResultsService
  ],
  exports: [
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
    TypeOrmModule
  ]
})
export class WorkspacesModule {}
