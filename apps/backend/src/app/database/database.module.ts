import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
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

@Module({
  imports: [
    User,
    Logs,
    Workspace,
    WorkspaceAdmin,
    FileUpload,
    Responses,
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
        entities: [
          User, Workspace, WorkspaceAdmin, FileUpload, Responses, WorkspaceUser, ResourcePackage, Logs
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
      WorkspaceUser,
      ResourcePackage
    ])
  ],
  providers: [UsersService, WorkspaceService, TestcenterService],
  exports: [
    User,
    FileUpload,
    Logs,
    Responses,
    Workspace,
    WorkspaceAdmin,
    WorkspaceService,
    UsersService,
    WorkspaceUser,
    TestcenterService,
    ResourcePackage
  ]
})
export class DatabaseModule {}
