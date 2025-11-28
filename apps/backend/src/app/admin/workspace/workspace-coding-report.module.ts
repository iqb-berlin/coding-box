import { Module } from '@nestjs/common';
import { WorkspaceCodingReportController } from './workspace-coding-report.controller';
import { CodingReportService } from '../../database/services/coding-report.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [WorkspaceCodingReportController],
  providers: [CodingReportService],
  exports: [CodingReportService]
})
export class WorkspaceCodingReportModule {}
