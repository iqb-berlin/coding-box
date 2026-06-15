import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { Setting } from '../../database/entities/setting.entity';

@Module({
  imports: [
    DatabaseModule,
    WorkspaceModule,
    AuthModule,
    BullModule.registerQueue({
      name: 'database-export'
    }),
    JobQueueModule,
    CacheModule,
    TypeOrmModule.forFeature([Setting])
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
  ]
})
export class WorkspaceTestResultsAdminModule { }
