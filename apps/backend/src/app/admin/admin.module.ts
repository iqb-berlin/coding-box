import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';
import { WorkspaceFilesController } from './workspace/workspace-files.controller';
import { WorkspaceTestResultsController } from './workspace/workspace-test-results.controller';
import { WorkspaceUsersController } from './workspace/workspace-users.controller';
import { WorkspaceCodingController } from './workspace/workspace-coding.controller';
import { WorkspaceTestCenterController } from './workspace/workspace-test-center.controller';
import { WorkspacePlayerController } from './workspace/workspace-player.controller';
import { LogoController } from './logo/logo.controller';
import { UnitTagsController } from './unit-tags/unit-tags.controller';
import { UnitNotesController } from './unit-notes/unit-notes.controller';
import { ResourcePackageController } from './resource-packages/resource-package.controller';
import { JournalController } from './workspace/journal.controller';
import { VariableAnalysisController } from './variable-analysis/variable-analysis.controller';
import { JobsController } from './jobs/jobs.controller';
import { ValidationTaskController } from './workspace/validation-task.controller';
import { BookletInfoController } from './workspace/booklet-info.controller';
import { UnitInfoController } from './workspace/unit-info.controller';
import { MissingsProfilesController } from './workspace/missings-profiles.controller';
import { BookletInfoService } from '../database/services/booklet-info.service';
import { UnitInfoService } from '../database/services/unit-info.service';
import FileUpload from '../database/entities/file_upload.entity';
import { ReplayStatisticsController } from './replay-statistics/replay-statistics.controller';
import { VariableBundleModule } from './variable-bundle/variable-bundle.module';
import { VariableBundleController } from './variable-bundle/variable-bundle.controller';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    HttpModule,
    TypeOrmModule.forFeature([FileUpload]),
    VariableBundleModule
  ],
  controllers: [
    UsersController,
    WorkspaceController,
    WorkspaceFilesController,
    WorkspaceTestResultsController,
    WorkspaceUsersController,
    WorkspaceCodingController,
    WorkspaceTestCenterController,
    WorkspacePlayerController,
    LogoController,
    UnitTagsController,
    UnitNotesController,
    ResourcePackageController,
    JournalController,
    VariableAnalysisController,
    JobsController,
    ValidationTaskController,
    BookletInfoController,
    UnitInfoController,
    MissingsProfilesController,
    ReplayStatisticsController,
    VariableBundleController
  ],
  providers: [
    BookletInfoService,
    UnitInfoService
  ]
})
export class AdminModule {}
