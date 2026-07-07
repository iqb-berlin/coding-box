import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WsgCodingJobModule } from './coding-job/coding-job.module';
import { WorkspaceSettingsController } from '../workspace/workspace-settings.controller';
import { Setting } from '../database/entities/setting.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AuthModule,
    WsgCodingJobModule,
    TypeOrmModule.forFeature([Setting])
  ],
  controllers: [WorkspaceSettingsController],
  providers: [],
  exports: []
})
export class WsgAdminModule {}
