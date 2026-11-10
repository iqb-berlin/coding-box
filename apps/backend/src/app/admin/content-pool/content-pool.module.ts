import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPoolIntegrationService } from './content-pool-integration.service';
import { JobQueueClientModule } from '../../job-queue/job-queue-client.module';
import { WorkspaceModule } from '../../workspace/workspace.module';
import { Setting } from '../../database/entities/setting.entity';
import FileUpload from '../../database/entities/file_upload.entity';

@Module({
  imports: [HttpModule, TypeOrmModule.forFeature([Setting, FileUpload]), WorkspaceModule, JobQueueClientModule],
  providers: [ContentPoolIntegrationService],
  exports: [ContentPoolIntegrationService]
})
export class ContentPoolModule {}
