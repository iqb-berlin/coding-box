import { Module } from '@nestjs/common';
import { WsgCodingJobModule } from './coding-job/coding-job.module';

@Module({
  imports: [WsgCodingJobModule],
  controllers: [],
  providers: [],
  exports: []
})
export class WsgAdminModule {}
