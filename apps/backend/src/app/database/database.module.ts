import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import User from './entities/user.entity';
import Logs from './entities/logs.entity';
import Persons from './entities/persons.entity';
import Workspace from './entities/workspace.entity';
import WorkspaceAdmin from './entities/workspace-admin.entity';
import FileUpload from './entities/file_upload.entity';
import WorkspaceUser from './entities/workspace_user.entity';
import ResourcePackage from './entities/resource-package.entity';
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
import { OAuth2ClientCredentialsService } from '../auth/service/oauth2-client-credentials.service';
import { UnitTagService } from './services/unit-tag.service';
import { UnitNoteService } from './services/unit-note.service';
import { ResourcePackageService } from './services/resource-package.service';
import { JournalEntry } from './entities/journal-entry.entity';
import { Job } from './entities/job.entity';
import { VariableAnalysisJob } from './entities/variable-analysis-job.entity';
import { ValidationTask } from './entities/validation-task.entity';
import { Setting } from './entities/setting.entity';
import { ReplayStatistics } from './entities/replay-statistics.entity';
import { VariableBundle } from './entities/variable-bundle.entity';
import { CodingJob } from './entities/coding-job.entity';
import { CodingJobCoder } from './entities/coding-job-coder.entity';
import { CodingJobVariable } from './entities/coding-job-variable.entity';
import { CodingJobVariableBundle } from './entities/coding-job-variable-bundle.entity';
import { CodingJobUnit } from './entities/coding-job-unit.entity';
import { JobDefinition } from './entities/job-definition.entity';
import { MissingsProfile } from './entities/missings-profile.entity';
import { CoderTraining } from './entities/coder-training.entity';
import { CoderTrainingVariable } from './entities/coder-training-variable.entity';
import { CoderTrainingBundle } from './entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from './entities/coder-training-coder.entity';

@Module({
  imports: [
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
          User, Workspace, WorkspaceAdmin, FileUpload, WorkspaceUser, ResourcePackage, Logs, Persons, ChunkEntity, BookletLog, Session, UnitLog, UnitTag, UnitNote, JournalEntry, Job, VariableAnalysisJob, ValidationTask, Setting, ReplayStatistics, VariableBundle,
          CodingJob, CodingJobCoder, CodingJobVariable, CodingJobVariableBundle, CodingJobUnit, JobDefinition, CoderTraining, MissingsProfile
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
      ReplayStatistics,
      VariableBundle,
      CodingJob,
      CodingJobCoder,
      CodingJobVariable,
      CodingJobVariableBundle,
      CodingJobUnit,
      JobDefinition,
      CoderTraining,
      MissingsProfile
    ]),
    CacheModule
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
    OAuth2ClientCredentialsService,
    JwtService,
    UnitTagService,
    UnitNoteService,
    ResourcePackageService,
    JournalService,
    VariableAnalysisService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService,
    CodingJobService,
    JobDefinitionService,
    CodingStatisticsService,
    MissingsProfilesService,
    CodingListService,
    CoderTrainingService,
    VariableAnalysisReplayService,
    ExportValidationResultsService,
    ExternalCodingImportService,
    BullJobManagementService,
    CodingResultsService,
    CodingExportService
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
    UnitTagService,
    UnitNoteService,
    JournalService,
    VariableAnalysisService,
    JobService,
    ValidationTaskService,
    ReplayStatisticsService,
    CodingJobService,
    JobDefinitionService,
    CodingStatisticsService,
    MissingsProfilesService,
    CodingListService,
    CoderTrainingService,
    VariableAnalysisReplayService,
    ExportValidationResultsService,
    ExternalCodingImportService,
    BullJobManagementService,
    CodingResultsService,
    CodingExportService
        entities: [
          BookletInfo,
          Booklet,
          Session,
          BookletLog,
          Unit,
          UnitLog,
          UnitLastState,
          ResponseEntity,
          User,
          Workspace,
          WorkspaceAdmin,
          FileUpload,
          WorkspaceUser,
          ResourcePackage,
          Logs,
          Persons,
          ChunkEntity,
          UnitTag,
          UnitNote,
          JournalEntry,
          Job,
          VariableAnalysisJob,
          ValidationTask,
          Setting,
          ReplayStatistics,
          VariableBundle,
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
          MissingsProfile
        ],
        synchronize: false
      }),
      inject: [ConfigService]
    })
  ]
})
export class DatabaseModule { }
