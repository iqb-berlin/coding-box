import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Setting } from '../database/entities/setting.entity';
import { WorkspaceSettingsService } from './workspace-settings.service';

@Module({
  imports: [TypeOrmModule.forFeature([Setting])],
  providers: [WorkspaceSettingsService],
  exports: [WorkspaceSettingsService]
})
export class WorkspaceSettingsModule {}
