import { Module } from '@nestjs/common';
import { WsgCodingJobController } from './coding-job.controller';
import { AuthModule } from '../../auth/auth.module';
import { CodingModule } from '../../coding/coding.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { CacheModule } from '../../cache/cache.module';

@Module({
  imports: [
    AuthModule,
    CodingModule,
    WorkspaceModule,
    CacheModule
  ],
  controllers: [WsgCodingJobController]
})
export class WsgCodingJobModule { }
