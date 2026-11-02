import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CodingUnitFreshness } from '../database/entities/coding-unit-freshness.entity';
import { ResponseEntity } from '../database/entities/response.entity';
import { CodingFreshnessService } from '../database/services/coding/coding-freshness.service';
import { CodingFreshnessQueryService } from '../database/services/coding/coding-freshness-query.service';
import { CodingJobFreshnessService } from '../database/services/coding/coding-job-freshness.service';
import { WorkspaceDataModule } from '../workspace/workspace-data.module';

/** Unit/version transitions and manual-job freshness behind one application API. */
@Module({
  imports: [TypeOrmModule.forFeature([CodingUnitFreshness, ResponseEntity]), WorkspaceDataModule],
  providers: [CodingFreshnessService, CodingFreshnessQueryService, CodingJobFreshnessService],
  exports: [CodingFreshnessService]
})
export class CodingFreshnessModule {}
