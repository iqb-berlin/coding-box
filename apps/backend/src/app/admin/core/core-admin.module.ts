import { Module, Type } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../../database/database.module';
import { UserModule } from '../../user/user.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { AuthModule } from '../../auth/auth.module';
import { CodingModule } from '../../coding/coding.module';
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
import { DatabaseExportProcessor } from '../database/database-export.processor';
import { DatabaseExportService } from '../database/database-export.service';
import { Setting } from '../../database/entities/setting.entity';
import FileUpload from '../../database/entities/file_upload.entity';
import { ContentPoolSettingsController } from '../content-pool/content-pool-settings.controller';
import { ContentPoolIntegrationService } from '../content-pool/content-pool-integration.service';
import { LegalNoticeController } from '../legal-notice/legal-notice.controller';
import { LegalNoticeService } from '../legal-notice/legal-notice.service';
import { getEnabledProcessorNames } from '../../job-queue/job-queue-processor-selection';
import { SystemNotification } from '../../database/entities/system-notification.entity';
import { PublicSystemNotificationController } from '../system-notifications/system-notification.controller';
import { AdminSystemNotificationController } from '../system-notifications/admin-system-notification.controller';
import { SystemNotificationService } from '../system-notifications/system-notification.service';

const processorProviders = {
  'database-export': DatabaseExportProcessor
} satisfies Record<string, Type<unknown>>;

type CoreAdminProcessorName = keyof typeof processorProviders;

export function getEnabledCoreAdminProcessors(
  enabledValue = process.env.JOB_QUEUE_PROCESSORS,
  disabledValue = process.env.DISABLED_JOB_QUEUE_PROCESSORS
): Type<unknown>[] {
  const allProcessorNames = Object.keys(processorProviders) as CoreAdminProcessorName[];

  return getEnabledProcessorNames(allProcessorNames, enabledValue, disabledValue)
    .map(name => processorProviders[name]);
}

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    WorkspaceModule,
    AuthModule,
    CodingModule,
    HttpModule,
    TypeOrmModule.forFeature([Setting, FileUpload, SystemNotification]),
    BullModule.registerQueue({
      name: 'database-export'
    }),
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
    DatabaseAdminController,
    ContentPoolSettingsController,
    LegalNoticeController,
    PublicSystemNotificationController,
    AdminSystemNotificationController
  ],
  providers: [
    DatabaseExportService,
    ...getEnabledCoreAdminProcessors(),
    ContentPoolIntegrationService,
    LegalNoticeService,
    SystemNotificationService
  ]
})
export class CoreAdminModule { }
