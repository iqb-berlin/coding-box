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
import { CodingJobMutationService } from '../database/services/coding/coding-job-mutation.service';
import { CodingJobResponsesService } from '../database/services/coding/coding-job-responses.service';
import { CodingJobAccessService } from '../database/services/coding/coding-job-access.service';
import { CodingJobQueryService } from '../database/services/coding/coding-job-query.service';
import { CodingJobDistributionService } from '../database/services/coding/coding-job-distribution.service';
import { CodingJobStatusService } from '../database/services/coding/coding-job-status.service';
import { CodingJobProgressService } from '../database/services/coding/coding-job-progress.service';
import { CodingJobSchemeService } from '../database/services/coding/coding-job-scheme.service';
import { CodingJobReplayService } from '../database/services/coding/coding-job-replay.service';
import { CodingJobAggregationService } from '../database/services/coding/coding-job-aggregation.service';
import { CodingJobService } from '../database/services/coding/coding-job.service';
import { WorkspaceFilesService } from '../database/services/workspace/workspace-files.service';
import { DERIVED_VARIABLE_READER } from '../database/services/workspace/derived-variable-reader.token';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CodingModule } from './coding.module';

// Supply isolated infrastructure credentials while retaining real startup validation.
jest.mock('../config/environment.validation', () => {
  const actual = jest.requireActual('../config/environment.validation');
  return {
    ...actual,
    validateEnvironment: (config: Record<string, unknown>) => actual.validateEnvironment({
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test-password',
      POSTGRES_DB: 'test',
      JWT_SECRET: 'test-secret',
      ...config
    })
  };
});

const sharedCodingProviders = [
  CodingJobService,
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
      const facade = module.get(CodingJobService);
      const featureProviders = [
        CodingJobMutationService, CodingJobResponsesService, CodingJobAccessService,
        CodingJobQueryService, CodingJobDistributionService, CodingJobStatusService,
        CodingJobProgressService, CodingJobSchemeService, CodingJobReplayService,
        CodingJobAggregationService
      ];
      featureProviders.forEach(provider => expect(module.get(provider)).toBeInstanceOf(provider));
      expect(module.get(DERIVED_VARIABLE_READER)).toBe(module.get(WorkspaceFilesService));
      const query = module.get(CodingJobQueryService);
      const getJob = jest.spyOn(query, 'getCodingJobByIdForWorkspace').mockResolvedValue({ id: 42 } as never);
      await expect(facade.getCodingJobByIdForWorkspace(42, 7)).resolves.toEqual({ id: 42 });
      expect(getJob).toHaveBeenCalledWith(42, 7, undefined);
      getJob.mockRestore();
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
