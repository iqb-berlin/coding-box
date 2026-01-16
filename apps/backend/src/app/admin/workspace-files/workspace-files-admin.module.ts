import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../database/database.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AuthModule } from '../../auth/auth.module';
import { WorkspaceFilesController } from '../workspace/workspace-files.controller';
import { WorkspaceFilesValidationController } from '../workspace/workspace-files-validation.controller';
import { WorkspaceFilesContentController } from '../workspace/workspace-files-content.controller';
import { WorkspaceFilesInfoController } from '../workspace/workspace-files-info.controller';
import FileUpload from '../../database/entities/file_upload.entity';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    AuthModule,
    TypeOrmModule.forFeature([FileUpload])
  ],
  controllers: [
    WorkspaceFilesController,
    WorkspaceFilesValidationController,
    WorkspaceFilesContentController,
    WorkspaceFilesInfoController
  ]
})
export class WorkspaceFilesAdminModule { }
