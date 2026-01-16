import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../database/database.module';
import { UserModule } from '../../user/user.module';
import { AuthModule } from '../../auth/auth.module';
import { JobQueueModule } from '../../job-queue/job-queue.module';
import { VariableBundleModule } from '../variable-bundle/variable-bundle.module';
import { UsersController } from '../users/users.controller';
import { LogoController } from '../logo/logo.controller';
import { UnitTagsController } from '../unit-tags/unit-tags.controller';
import { UnitNotesController } from '../unit-notes/unit-notes.controller';
import { ResourcePackageController } from '../resource-packages/resource-package.controller';
import { VariableAnalysisController } from '../variable-analysis/variable-analysis.controller';
import { JobsController } from '../jobs/jobs.controller';
import { ReplayStatisticsController } from '../replay-statistics/replay-statistics.controller';
import { VariableBundleController } from '../variable-bundle/variable-bundle.controller';
import { CodingJobsController } from '../coding-jobs/coding-jobs.controller';
import { DatabaseAdminController } from '../database/database-admin.controller';
import { DatabaseExportService } from '../database/database-export.service';
import { Setting } from '../../database/entities/setting.entity';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    AuthModule,
    HttpModule,
    TypeOrmModule.forFeature([Setting]),
    VariableBundleModule,
    JobQueueModule
  ],
  controllers: [
    UsersController,
    LogoController,
    UnitTagsController,
    UnitNotesController,
    ResourcePackageController,
    VariableAnalysisController,
    JobsController,
    ReplayStatisticsController,
    VariableBundleController,
    CodingJobsController,
    DatabaseAdminController
  ],
  providers: [
    DatabaseExportService
  ]
})
export class CoreAdminModule { }
