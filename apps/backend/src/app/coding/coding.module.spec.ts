/* eslint-disable max-classes-per-file */
import { Global, Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Connection, DataSource, getMetadataArgsStorage } from 'typeorm';
// Load the application first so this test uses the production module evaluation order.
import { AppModule } from '../app.module';
import { CacheClientModule } from '../cache/cache-client.module';
import { CacheService } from '../cache/cache.service';
import { RuntimeConfigService } from '../config/runtime-config.service';
import { JobQueueClientModule } from '../job-queue/job-queue-client.module';
import { JobQueueService } from '../job-queue/job-queue.service';
import { CodingAggregationPeerService } from '../database/services/coding/coding-aggregation-peer.service';
import { CodingValidationService } from '../database/services/coding/coding-validation.service';
import { CodingAnalysisService } from '../database/services/coding/coding-analysis.service';
import { CodingFreshnessService } from '../database/services/coding/coding-freshness.service';
import { CodingItemMatrixExportService } from '../database/services/coding/coding-item-matrix-export.service';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CodingModule } from './coding.module';

const sharedCodingProviders = [
  CodingValidationService,
  CodingAnalysisService,
  CodingFreshnessService,
  CodingItemMatrixExportService
];

@Global()
@Module({
  providers: [
    { provide: DataSource, useValue: {} },
    { provide: Connection, useValue: {} },
    { provide: ConfigService, useValue: { get: (_key: string, fallback: unknown) => fallback } },
    { provide: RuntimeConfigService, useValue: {} }
  ],
  exports: [DataSource, Connection, ConfigService, RuntimeConfigService]
})
class DatabaseStubModule {}

@Module({ providers: [{ provide: CacheService, useValue: {} }], exports: [CacheService] })
class CacheStubModule {}

@Module({ providers: [{ provide: JobQueueService, useValue: {} }], exports: [JobQueueService] })
class QueueStubModule {}

@Module({
  imports: [WorkspaceModule],
  providers: [{ provide: 'workspaceConsumer', inject: sharedCodingProviders, useFactory: (...services) => services }],
  exports: ['workspaceConsumer']
})
class WorkspaceConsumerModule {}

@Module({
  imports: [CodingModule],
  providers: [{ provide: 'codingConsumer', inject: sharedCodingProviders, useFactory: (...services) => services }],
  exports: ['codingConsumer']
})
class CodingConsumerModule {}

describe('CodingModule', () => {
  it('exports CodingAggregationPeerService for importing modules', () => {
    const exportedProviders = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CodingModule
    ) as unknown[];

    expect(exportedProviders).toContain(CodingAggregationPeerService);
  });

  it('compiles real providers in application import order and shares coding instances through WorkspaceModule', async () => {
    const applicationImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);
    expect(applicationImports).toContain(CodingModule);
    expect(applicationImports).toContain(WorkspaceModule);

    const builder = Test.createTestingModule({
      imports: [DatabaseStubModule, WorkspaceConsumerModule, CodingConsumerModule]
    })
      .overrideModule(CacheClientModule).useModule(CacheStubModule)
      .overrideModule(JobQueueClientModule)
      .useModule(QueueStubModule);

    // Keep domain providers real; isolate only external storage, queues and configuration.
    for (const entity of getMetadataArgsStorage().tables) {
      builder.overrideProvider(getRepositoryToken(entity.target as never)).useValue({});
    }

    const module = await builder.compile();
    try {
      const fromWorkspace = module.get<unknown[]>('workspaceConsumer');
      const fromCoding = module.get<unknown[]>('codingConsumer');
      sharedCodingProviders.forEach((provider, index) => {
        expect(fromCoding[index]).toBeInstanceOf(provider);
        expect(fromWorkspace[index]).toBe(fromCoding[index]);
      });
    } finally {
      await module.close();
    }
  });
});
