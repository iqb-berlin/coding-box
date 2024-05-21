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
import ResourcePackage from './entities/resource-package.entity';
import { ResourcePackageService } from './services/resource-package.service';
import { TestcenterService } from './services/testcenter.service';

@Module({
  imports: [
    User,
    Workspace,
    WorkspaceAdmin,
    FileUpload,
    Responses,
    WorkspaceUser,
    HttpModule,
    ResourcePackage,
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
          User, Workspace, WorkspaceAdmin, FileUpload, Responses, WorkspaceUser, ResourcePackage
        ],
        synchronize: false
      }),
      inject: [ConfigService]
    }),
    TypeOrmModule.forFeature([User, Workspace, WorkspaceAdmin, FileUpload, Responses, WorkspaceUser, ResourcePackage])
  ],
  providers: [UsersService, WorkspaceService, ResourcePackageService, TestcenterService],
  exports: [
    User,
    FileUpload,
    Responses,
    Workspace,
    WorkspaceAdmin,
    WorkspaceService,
    UsersService,
    WorkspaceUser,
    ResourcePackage,
    TestcenterService
  ]
})
export class DatabaseModule {}
