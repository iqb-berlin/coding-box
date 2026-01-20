import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AuthModule } from '../../auth/auth.module';
import { JobQueueModule } from '../../job-queue/job-queue.module';
import { CacheModule } from '../../cache/cache.module';
import { WorkspaceTestResultsController } from '../workspace/workspace-test-results.controller';
import { WorkspaceTestResultsStatisticsController } from '../workspace/workspace-test-results-statistics.controller';
import { WorkspaceTestResultsManagementController } from '../workspace/workspace-test-results-management.controller';
import { WorkspaceTestResultsLogsController } from '../workspace/workspace-test-results-logs.controller';
import { WorkspaceTestResultsResponseController } from '../workspace/workspace-test-results-response.controller';
import { WorkspaceTestResultsAnalysisController } from '../workspace/workspace-test-results-analysis.controller';
import { WorkspaceTestResultsImportController } from '../workspace/workspace-test-results-import.controller';
import { WorkspaceTestResultsExportController } from '../workspace/workspace-test-results-export.controller';
import { DatabaseExportService } from '../database/database-export.service';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    AuthModule,
    JobQueueModule,
    CacheModule
  ],
  controllers: [
    WorkspaceTestResultsController,
    WorkspaceTestResultsStatisticsController,
    WorkspaceTestResultsLogsController,
    WorkspaceTestResultsResponseController,
    WorkspaceTestResultsAnalysisController,
    WorkspaceTestResultsImportController,
    WorkspaceTestResultsExportController,
    WorkspaceTestResultsManagementController
  ],
  providers: [
    DatabaseExportService
  ]
})
export class WorkspaceTestResultsAdminModule { }
