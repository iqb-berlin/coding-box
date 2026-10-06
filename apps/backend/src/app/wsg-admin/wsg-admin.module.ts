import { Module } from '@nestjs/common';
import { WsgCodingJobModule } from './coding-job/coding-job.module';
import { WorkspaceSettingsController } from '../workspace/workspace-settings.controller';
import { WorkspaceSettingsModule } from '../workspace/workspace-settings.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    WsgCodingJobModule,
    WorkspaceSettingsModule
  ],
  controllers: [WorkspaceSettingsController],
  exports: []
})
export class WsgAdminModule {}
