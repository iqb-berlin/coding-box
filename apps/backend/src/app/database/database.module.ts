import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import User from './entities/user.entity';
import { UsersService } from './services/users.service';
import { WorkspaceCoreService } from './services/workspace-core.service';
import { WorkspaceFilesService } from './services/workspace-files.service';
import { WorkspaceTestResultsService } from './services/workspace-test-results.service';
import { WorkspaceUsersService } from './services/workspace-users.service';
import { WorkspaceCodingService } from './services/workspace-coding.service';
import { WorkspacePlayerService } from './services/workspace-player.service';
import Workspace from './entities/workspace.entity';
import WorkspaceAdmin from './entities/workspace-admin.entity';
import FileUpload from './entities/file_upload.entity';
import WorkspaceUser from './entities/workspace_user.entity';
import { TestcenterService } from './services/testcenter.service';
import ResourcePackage from './entities/resource-package.entity';
import Logs from './entities/logs.entity';
import Persons from './entities/persons.entity';
import { UploadResultsService } from './services/upload-results.service';
import { BookletLog } from './entities/bookletLog.entity';
import { Unit } from './entities/unit.entity';
import { Booklet } from './entities/booklet.entity';
import { BookletInfo } from './entities/bookletInfo.entity';
import { UnitLog } from './entities/unitLog.entity';
import { UnitLastState } from './entities/unitLastState.entity';
import { ChunkEntity } from './entities/chunk.entity';
import { ResponseEntity } from './entities/response.entity';
import { Session } from './entities/session.entity';
import { UnitTag } from './entities/unitTag.entity';
import { UnitNote } from './entities/unitNote.entity';
import { PersonService } from './services/person.service';
import { AuthService } from '../auth/service/auth.service';
import { UnitTagService } from './services/unit-tag.service';
import { UnitNoteService } from './services/unit-note.service';
import { ResourcePackageService } from './services/resource-package.service';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalService } from './services/journal.service';
import { VariableAnalysisService } from './services/variable-analysis.service';
import { JobService } from './services/job.service';
import { ValidationTaskService } from './services/validation-task.service';
import { Job } from './entities/job.entity';
import { VariableAnalysisJob } from './entities/variable-analysis-job.entity';
import { ValidationTask } from './entities/validation-task.entity';
import { Setting } from './entities/setting.entity';
import { ReplayStatistics } from './entities/replay-statistics.entity';
import { ReplayStatisticsService } from './services/replay-statistics.service';
// eslint-disable-next-line import/no-cycle
import { JobQueueModule } from '../job-queue/job-queue.module';

/**
 * DatabaseModule provides database access and services for the application.
 *
 * Note: This module has a circular dependency with JobQueueModule because:
 * - DatabaseModule exports WorkspaceCodingService which is used by JobQueueModule
 * - DatabaseModule imports JobQueueModule for job queue functionality
 *
 * This circular dependency is resolved using forwardRef() both at the module level
 * and at the injection point in the TestPersonCodingProcessor.
 */
@Module({
  imports: [
    User,
    Logs,
    Workspace,
    WorkspaceAdmin,
    FileUpload,
    Persons,
    Unit,
    BookletLog,
    Session,
    UnitLastState,
    UnitLog,
    ResponseEntity,
    ChunkEntity,
    ResourcePackage,
    WorkspaceUser,
    HttpModule,
    forwardRef(() => JobQueueModule),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('POSTGRES_HOST'),
        port: +configService.get<number>('POSTGRES_PORT'),
        username: configService.get('POSTGRES_USER'),
        password: configService.get('POSTGRES_PASSWORD'),
        database: configService.get('POSTGRES_DB'),
        entities: [BookletInfo, Booklet, Session, BookletLog, Unit, UnitLog, UnitLastState, ResponseEntity,
          User, Workspace, WorkspaceAdmin, FileUpload, WorkspaceUser, ResourcePackage, Logs, Persons, ChunkEntity, BookletLog, Session, UnitLog, UnitTag, UnitNote, JournalEntry, Job, VariableAnalysisJob, ValidationTask, Setting, ReplayStatistics
        ],
        synchronize: false
      }),
      inject: [ConfigService]
    }),
    TypeOrmModule.forFeature([
      User,
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
      ReplayStatistics
    ])
  ],
  providers: [
    UsersService,
    WorkspaceCoreService,
    WorkspaceFilesService,
    WorkspaceTestResultsService,
    WorkspaceUsersService,
    WorkspaceCodingService,
    WorkspacePlayerService,
    TestcenterService,
    UploadResultsService,
    PersonService,
    AuthService,
    JwtService,
    UnitTagService,
    UnitNoteService,
    ResourcePackageService,
    JournalService,
    VariableAnalysisService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService
  ],
  exports: [
    User,
    FileUpload,
    Logs,
    Persons,
    Workspace,
    WorkspaceAdmin,
    WorkspaceCoreService,
    WorkspaceFilesService,
    WorkspaceTestResultsService,
    WorkspaceUsersService,
    WorkspaceCodingService,
    WorkspacePlayerService,
    UsersService,
    WorkspaceUser,
    TestcenterService,
    UploadResultsService,
    ResourcePackageService,
    ResourcePackage,
    PersonService,
    AuthService,
    UnitTagService,
    UnitNoteService,
    JournalService,
    VariableAnalysisService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService
  ]
})
export class DatabaseModule {}
