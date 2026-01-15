import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './users/users.controller';
import { DatabaseModule } from '../database/database.module';
import { UserModule } from '../user/user.module';
import { CodingModule } from '../coding/coding.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { AuthModule } from '../auth/auth.module';
import { WorkspaceController } from './workspace/workspace.controller';
import { WorkspaceFilesController } from './workspace/workspace-files.controller';
import { WorkspaceFilesValidationController } from './workspace/workspace-files-validation.controller';
import { WorkspaceFilesContentController } from './workspace/workspace-files-content.controller';
import { WorkspaceFilesInfoController } from './workspace/workspace-files-info.controller';
import { WorkspaceTestResultsController } from './workspace/workspace-test-results.controller';
import { WorkspaceTestResultsStatisticsController } from './workspace/workspace-test-results-statistics.controller';
import { WorkspaceTestResultsManagementController } from './workspace/workspace-test-results-management.controller';
import { WorkspaceTestResultsLogsController } from './workspace/workspace-test-results-logs.controller';
import { WorkspaceTestResultsResponseController } from './workspace/workspace-test-results-response.controller';
import { WorkspaceTestResultsAnalysisController } from './workspace/workspace-test-results-analysis.controller';
import { WorkspaceTestResultsImportController } from './workspace/workspace-test-results-import.controller';
import { WorkspaceTestResultsExportController } from './workspace/workspace-test-results-export.controller';
import { WorkspaceUsersController } from './workspace/workspace-users.controller';
import { WorkspaceCodingController } from './workspace/workspace-coding.controller';
import { WorkspaceCodingExportController } from './workspace/workspace-coding-export.controller';
import { WorkspaceCodingJobController } from './workspace/workspace-coding-job.controller';
import { WorkspaceCodingStatisticsController } from './workspace/workspace-coding-statistics.controller';
import { WorkspaceCodingAnalysisController } from './workspace/workspace-coding-analysis.controller';
import { WorkspaceCodingCodebookController } from './workspace/workspace-coding-codebook.controller';
import { WorkspaceCodingImportController } from './workspace/workspace-coding-import.controller';
import { WorkspaceCodingReviewController } from './workspace/workspace-coding-review.controller';
import { WorkspaceCodingReplayController } from './workspace/workspace-coding-replay.controller';
import { WorkspaceCodingVersionController } from './workspace/workspace-coding-version.controller';
import { WorkspaceCoderTrainingController } from './workspace/workspace-coder-training.controller';
import { WorkspaceCodingJobDefinitionController } from './workspace/workspace-coding-job-definition.controller';
import { WorkspaceCodingResultsController } from './workspace/workspace-coding-results.controller';
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
import { Setting } from '../database/entities/setting.entity';
import { ReplayStatisticsController } from './replay-statistics/replay-statistics.controller';
import { VariableBundleModule } from './variable-bundle/variable-bundle.module';
import { VariableBundleController } from './variable-bundle/variable-bundle.controller';
import { CodingJobsController } from './coding-jobs/coding-jobs.controller';
import { DatabaseAdminController } from './database/database-admin.controller';
import { DatabaseExportService } from './database/database-export.service';
import { JobQueueModule } from '../job-queue/job-queue.module';
import { CacheModule } from '../cache/cache.module';
import { AccessRightsMatrixService } from './workspace/access-rights-matrix.service';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    CodingModule,
    WorkspaceModule,
    AuthModule,
    HttpModule,
    TypeOrmModule.forFeature([FileUpload, Setting]),
    VariableBundleModule,
    JobQueueModule,
    CacheModule
  ],
  controllers: [
    UsersController,
    WorkspaceController,
    WorkspaceFilesController,
    WorkspaceFilesValidationController,
    WorkspaceFilesContentController,
    WorkspaceFilesInfoController,
    WorkspaceTestResultsController,
    WorkspaceTestResultsStatisticsController,
    WorkspaceTestResultsManagementController,
    WorkspaceTestResultsLogsController,
    WorkspaceTestResultsResponseController,
    WorkspaceTestResultsAnalysisController,
    WorkspaceTestResultsImportController,
    WorkspaceTestResultsExportController,
    WorkspaceUsersController,
    WorkspaceCodingController,
    WorkspaceCodingExportController,
    WorkspaceCodingJobController,
    WorkspaceCodingStatisticsController,
    WorkspaceCodingAnalysisController,
    WorkspaceCodingCodebookController,
    WorkspaceCodingImportController,
    WorkspaceCodingReviewController,
    WorkspaceCodingReplayController,
    WorkspaceCodingVersionController,
    WorkspaceCoderTrainingController,
    WorkspaceCodingJobDefinitionController,
    WorkspaceCodingResultsController,
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
    VariableBundleController,
    CodingJobsController,
    DatabaseAdminController
  ],
  providers: [
    BookletInfoService,
    UnitInfoService,
    DatabaseExportService,
    AccessRightsMatrixService
  ]
})
export class AdminModule { }
