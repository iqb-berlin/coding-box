import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { CacheClientModule } from '../cache/cache-client.module';
import { JobQueueClientModule } from '../job-queue/job-queue-client.module';
import { CodingModule } from '../coding/coding.module';
import { WorkspaceModule } from '../workspace/workspace.module';
import { ExportJobProcessor } from '../job-queue/processors/export-job.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.dev',
      cache: true
    }),
    DatabaseModule,
    CacheClientModule,
    JobQueueClientModule,
    CodingModule,
    WorkspaceModule
  ],
  providers: [ExportJobProcessor]
})
export class ExportWorkerModule { }
