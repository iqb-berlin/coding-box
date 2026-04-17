import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '../../database/database.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { CodingModule } from '../../coding/coding.module';
import { AuthModule } from '../../auth/auth.module';
import { CacheModule } from '../../cache/cache.module';
import { JobQueueModule } from '../../job-queue/job-queue.module';
import { WorkspaceFilesController } from '../workspace/workspace-files.controller';
import { WorkspaceFilesValidationController } from '../workspace/workspace-files-validation.controller';
import { WorkspaceFilesContentController } from '../workspace/workspace-files-content.controller';
import { WorkspaceFilesInfoController } from '../workspace/workspace-files-info.controller';
import { GithubReleasesController } from '../workspace/github-releases.controller';
import { GithubReleasesService } from '../workspace/github-releases.service';
import { WorkspaceContentPoolController } from '../workspace/workspace-content-pool.controller';
import { ContentPoolIntegrationService } from '../content-pool/content-pool-integration.service';
import FileUpload from '../../database/entities/file_upload.entity';
import { Setting } from '../../database/entities/setting.entity';

@Module({
  imports: [
    DatabaseModule,
    CodingModule,
    WorkspaceModule,
    AuthModule,
    CacheModule,
    JobQueueModule,
    HttpModule,
    TypeOrmModule.forFeature([FileUpload, Setting])
  ],
  controllers: [
    WorkspaceFilesController,
    WorkspaceFilesValidationController,
    WorkspaceFilesContentController,
    WorkspaceFilesInfoController,
    GithubReleasesController,
    WorkspaceContentPoolController
  ],
  providers: [
    GithubReleasesService,
    ContentPoolIntegrationService
  ]
})
export class WorkspaceFilesAdminModule { }
