import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheClientModule } from './cache-client.module';
import { ResponseCacheSchedulerService } from './response-cache-scheduler.service';
import { CodingIncompleteCacheSchedulerService } from './coding-incomplete-cache-scheduler.service';
import { CodingStatisticsCacheSchedulerService } from './coding-statistics-cache-scheduler.service';
import { WorkspaceCacheWarmupRunner } from './workspace-cache-warmup.runner';
import Persons from '../database/entities/persons.entity';
import { Unit } from '../database/entities/unit.entity';
// eslint-disable-next-line import/no-cycle
import { WorkspaceModule } from '../workspace/workspace.module';
// eslint-disable-next-line import/no-cycle
import { CodingModule } from '../coding/coding.module';

@Module({
  imports: [
    CacheClientModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Persons, Unit]),
    forwardRef(() => WorkspaceModule),
    forwardRef(() => CodingModule)
  ],
  providers: [
    ResponseCacheSchedulerService,
    WorkspaceCacheWarmupRunner,
    CodingIncompleteCacheSchedulerService,
    CodingStatisticsCacheSchedulerService
  ],
  exports: [CacheClientModule]
})
export class CacheModule { }
