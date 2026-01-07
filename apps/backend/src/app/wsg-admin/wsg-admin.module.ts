import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WsgCodingJobModule } from './coding-job/coding-job.module';
import { WorkspaceSettingsController } from '../workspace/workspace-settings.controller';
import { Setting } from '../workspaces/entities/setting.entity';

@Module({
  imports: [
    WsgCodingJobModule,
    TypeOrmModule.forFeature([Setting])
  ],
  controllers: [WorkspaceSettingsController],
  providers: [],
  exports: []
})
export class WsgAdminModule {}
