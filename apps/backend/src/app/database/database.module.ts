import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
import User from './entities/user.entity';
import { UsersService } from './services/users.service';
import { WorkspaceService } from './services/workspace.service';
import Workspace from './entities/workspace.entity';
import WorkspaceAdmin from './entities/workspace-admin.entity';
import FileUpload from './entities/file_upload.entity';
import Responses from './entities/responses.entity';
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
import { PersonService } from './services/person.service';
import { AuthService } from '../auth/service/auth.service';

@Module({
  imports: [
    User,
    Logs,
    Workspace,
    WorkspaceAdmin,
    FileUpload,
    Responses,
    Persons,
    Unit,
    Responses,
    BookletLog,
    Session,
    UnitLastState,
    UnitLog,
    ResponseEntity,
    ChunkEntity,
    ResourcePackage,
    WorkspaceUser,
    HttpModule,
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
          User, Workspace, WorkspaceAdmin, FileUpload, Responses, WorkspaceUser, ResourcePackage, Logs, Persons, ChunkEntity, BookletLog, Session, UnitLog
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
      Responses,
      ResponseEntity,
      WorkspaceUser,
      ResourcePackage,
      Persons,
      Responses,
      Booklet,
      BookletInfo,
      Unit,
      ChunkEntity,
      BookletLog,
      UnitLog,
      UnitLastState,
      Session
    ])
  ],
  providers: [UsersService, WorkspaceService, TestcenterService, UploadResultsService, PersonService, AuthService, JwtService],
  exports: [
    User,
    FileUpload,
    Logs,
    Persons,
    Responses,
    Workspace,
    WorkspaceAdmin,
    WorkspaceService,
    UsersService,
    WorkspaceUser,
    TestcenterService,
    UploadResultsService,
    ResourcePackage,
    PersonService,
    AuthService
  ]
})
export class DatabaseModule {}
