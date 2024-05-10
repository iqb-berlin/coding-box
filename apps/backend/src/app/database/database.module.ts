import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
// eslint-disable-next-line import/no-extraneous-dependencies

import User from './entities/user.entity';
import { UsersService } from './services/users.service';
import { WorkspaceService } from './services/workspace.service';
import Workspace from './entities/workspace.entity';
import WorkspaceAdmin from './entities/workspace-admin.entity';
import FileUpload from './entities/file_upload.entity';
import Responses from './entities/responses.entity';

@Module({
  imports: [
    User,
    Workspace,
    WorkspaceAdmin,
    FileUpload,
    Responses,
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
          User, Workspace, WorkspaceAdmin, FileUpload, Responses
        ],
        synchronize: false
      }),
      inject: [ConfigService]
    }),
    TypeOrmModule.forFeature([User, Workspace, WorkspaceAdmin, FileUpload, Responses])
  ],
  providers: [UsersService, WorkspaceService],
  exports: [
    User,
    FileUpload,
    Responses,
    Workspace,
    WorkspaceAdmin,
    WorkspaceService,
    UsersService
  ]
})
export class DatabaseModule {}
