import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '../../database/database.module';
import { CodingModule } from '../../coding/coding.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AuthModule } from '../../auth/auth.module';
import { JobQueueModule } from '../../job-queue/job-queue.module';
import { WorkspaceCodingController } from '../workspace/workspace-coding.controller';
import { WorkspaceCodingExportController } from '../workspace/workspace-coding-export.controller';
import { WorkspaceCodingJobController } from '../workspace/workspace-coding-job.controller';
import { WorkspaceCodingStatisticsController } from '../workspace/workspace-coding-statistics.controller';
import { WorkspaceCodingAnalysisController } from '../workspace/workspace-coding-analysis.controller';
import { WorkspaceCodingCodebookController } from '../workspace/workspace-coding-codebook.controller';
import { WorkspaceCodingImportController } from '../workspace/workspace-coding-import.controller';
import { WorkspaceCodingReviewController } from '../workspace/workspace-coding-review.controller';
import { WorkspaceCodingReplayController } from '../workspace/workspace-coding-replay.controller';
import { WorkspaceCodingVersionController } from '../workspace/workspace-coding-version.controller';
import { WorkspaceCoderTrainingController } from '../workspace/workspace-coder-training.controller';
import { WorkspaceCodingJobDefinitionController } from '../workspace/workspace-coding-job-definition.controller';
import { WorkspaceCodingResultsController } from '../workspace/workspace-coding-results.controller';
import { WorkspaceTestCenterController } from '../workspace/workspace-test-center.controller';
import { WorkspacePlayerController } from '../workspace/workspace-player.controller';

@Module({
  imports: [
    DatabaseModule,
    CodingModule,
    WorkspaceModule,
    AuthModule,
    JobQueueModule,
    HttpModule
  ],
  controllers: [
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
    WorkspacePlayerController
  ]
})
export class WorkspaceCodingAdminModule { }
