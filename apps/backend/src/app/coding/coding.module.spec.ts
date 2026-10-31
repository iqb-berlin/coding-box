/* eslint-disable max-classes-per-file */
import { Module } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { getQueueToken } from '@nestjs/bullmq';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Connection, DataSource, EntityManager, getMetadataArgsStorage
} from 'typeorm';
import { TestResultsAnomaliesService } from '../database/services/test-results/test-results-anomalies.service';
import { TestResultsCacheService } from '../database/services/test-results/test-results-cache.service';
import { TestResultsQueryService } from '../database/services/test-results/test-results-query.service';
import { TestResultsFrequenciesService } from '../database/services/test-results/test-results-frequencies.service';
import { TestResultsFilterOptionsService } from '../database/services/test-results/test-results-filter-options.service';
import { TestResultsResponsesService } from '../database/services/test-results/test-results-responses.service';
import { TestResultsReplayService } from '../database/services/test-results/test-results-replay.service';
import { TestResultsDeletionQueryService } from '../database/services/test-results/test-results-deletion-query.service';
import { TestResultsMutationService } from '../database/services/test-results/test-results-mutation.service';
import { TestResultsSearchService } from '../database/services/test-results/test-results-search.service';
import { TestResultsExportService } from '../database/services/test-results/test-results-export.service';
import { WorkspaceTestResultsService } from '../database/services/test-results/workspace-test-results.service';
import { CoderTrainingDisplayService } from '../database/services/coding/coder-training-display.service';
import { CoderTrainingSamplingService } from '../database/services/coding/coder-training-sampling.service';
import { CoderTrainingSelectionService } from '../database/services/coding/coder-training-selection.service';
import { CoderTrainingMutationService } from '../database/services/coding/coder-training-mutation.service';
import { CoderTrainingComparisonService } from '../database/services/coding/coder-training-comparison.service';
import { CoderTrainingComparisonQueryService } from '../database/services/coding/coder-training-comparison-query.service';
import { CoderTrainingKappaService } from '../database/services/coding/coder-training-kappa.service';
import { CoderTrainingDiscussionService } from '../database/services/coding/coder-training-discussion.service';
import { CoderTrainingQueryService } from '../database/services/coding/coder-training-query.service';
import { CoderTrainingFreshnessService } from '../database/services/coding/coder-training-freshness.service';
import { CoderTrainingService } from '../database/services/coding/coder-training.service';
import { AUTH_RATE_LIMIT_REDIS } from '../auth/auth-rate-limit.storage';
// Load the application first so this test uses the production module evaluation order.
import '../config/startup-environment.test.factory';
import { AppModule } from '../app.module';
import { WorkspaceSettingsModule } from '../workspace/workspace-settings.module';
import { WorkspaceSettingsService } from '../workspace/workspace-settings.service';
import { WorkspaceSettingsController } from '../workspace/workspace-settings.controller';
import { WorkspaceCodingAnalysisController } from '../admin/workspace/workspace-coding-analysis.controller';
import { WorkspaceTestResultsResponseController } from '../admin/workspace/workspace-test-results-response.controller';
import { WorkspaceFilesController } from '../admin/workspace/workspace-files.controller';
import { WorkspaceTestResultsAnalysisController } from '../admin/workspace/workspace-test-results-analysis.controller';
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
import { WorkspaceFileMetadataService } from '../database/services/workspace/workspace-file-metadata.service';
import { WORKSPACE_FILE_METADATA_READER } from '../database/services/workspace/workspace-file-metadata-reader.token';
import { WorkspaceDataModule } from '../workspace/workspace-data.module';
import { WorkspaceStatsCacheService } from '../database/services/workspace/workspace-stats-cache.service';
import { WorkspaceExclusionService } from '../database/services/workspace/workspace-exclusion.service';
import { WorkspacePlayerService } from '../database/services/workspace/workspace-player.service';
import { ResponseManagementService } from '../database/services/test-results/response-management.service';
import { JournalService } from '../database/services/shared/journal.service';
import { DERIVED_VARIABLE_READER } from '../database/services/workspace/derived-variable-reader.token';
import { WorkspaceModule } from '../workspace/workspace.module';
import { CodingModule } from './coding.module';
import { CodingJob } from '../database/entities/coding-job.entity';
import { CodingJobCoder } from '../database/entities/coding-job-coder.entity';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { UsersService } from '../database/services/users/users.service';

import { CodingExportService } from '../database/services/coding/coding-export.service';
import { CodingExportQueryService } from '../database/services/coding/coding-export-query.service';
import { CodingExportFormattingService } from '../database/services/coding/coding-export-formatting.service';
import { CodingExportReplayService } from '../database/services/coding/coding-export-replay.service';
import { CodingExportDownloadService } from '../database/services/coding/coding-export-download.service';
import { CodingAggregatedExportService } from '../database/services/coding/coding-aggregated-export.service';
import { CodingAggregatedRowsExportService } from '../database/services/coding/coding-aggregated-rows-export.service';
import { CodingAggregatedColumnsExportService } from '../database/services/coding/coding-aggregated-columns-export.service';
import { CodingCoderExportService } from '../database/services/coding/coding-coder-export.service';
import { CodingVariableExportService } from '../database/services/coding/coding-variable-export.service';
import { CodingCompactExportService } from '../database/services/coding/coding-compact-export.service';
import { CodingDetailedExportService } from '../database/services/coding/coding-detailed-export.service';
import { CodingTimingReportExportService } from '../database/services/coding/coding-timing-report-export.service';

const sharedCodingProviders = [
  CodingExportService,
  CodingJobService,
  CodingValidationService,
  CodingAnalysisService,
  CodingFreshnessService,
  CodingItemMatrixExportService,
  WorkspaceFileMetadataService,
  WorkspaceStatsCacheService,
  WorkspaceExclusionService,
  WorkspacePlayerService,
  ResponseManagementService
];

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

async function createApplication(): Promise<TestingModule> {
  const builder = Test.createTestingModule({
    imports: [AppModule, WorkspaceConsumerModule, CodingConsumerModule]
  })
    .overrideProvider(AUTH_RATE_LIMIT_REDIS).useValue({ disconnect: jest.fn() })
    .overrideProvider(DataSource)
    .useValue({})
    .overrideProvider(Connection)
    .useValue({})
    .overrideProvider(getRedisConnectionToken())
    .useValue({ disconnect: jest.fn() });
  const queues = [
    'test-person-coding', 'coding-statistics', 'data-export', 'flat-response-filter-options',
    'test-results-upload', 'codebook-generation', 'reset-coding-version', 'validation-task',
    'response-analysis', 'variable-analysis', 'external-coding-import', 'database-export'
  ];
  queues.forEach(name => builder.overrideProvider(getQueueToken(name)).useValue({}));

  // Keep domain providers real; isolate only external storage and queues.
  for (const entity of getMetadataArgsStorage().tables) {
    builder.overrideProvider(getRepositoryToken(entity.target as never)).useValue({});
  }

  return builder.compile();
}

describe('CodingModule', () => {
  it('exports CodingAggregationPeerService for importing modules', () => {
    const exportedProviders = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      CodingModule
    ) as unknown[];

    expect(exportedProviders).toContain(CodingAggregationPeerService);
  });

  it('compiles the real AppModule and shares coding instances through WorkspaceModule', async () => {
    const applicationImports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);
    expect(applicationImports).toContain(CodingModule);
    expect(applicationImports).toContain(WorkspaceModule);

    const module = await createApplication();
    try {
      const settings = module.select(WorkspaceSettingsModule).get(WorkspaceSettingsService, { strict: true });
      expect((module.get(WorkspaceSettingsController) as unknown as { settings: WorkspaceSettingsService }).settings).toBe(settings);
      expect((module.get(WorkspaceFilesController) as unknown as { workspaceSettings: WorkspaceSettingsService }).workspaceSettings).toBe(settings);
      expect((module.get(WorkspaceTestResultsAnalysisController) as unknown as { workspaceSettings: WorkspaceSettingsService }).workspaceSettings).toBe(settings);
      for (const controller of [module.get(WorkspaceCodingAnalysisController), module.get(WorkspaceTestResultsResponseController)]) {
        expect((controller as unknown as { workspaceSettings: WorkspaceSettingsService }).workspaceSettings).toBe(settings);
      }
      const exportFacade = module.get(CodingExportService);
      for (const [field, provider] of [
        ['downloads', CodingExportDownloadService], ['aggregated', CodingAggregatedExportService],
        ['byCoder', CodingCoderExportService], ['byVariable', CodingVariableExportService],
        ['compact', CodingCompactExportService], ['detailed', CodingDetailedExportService],
        ['times', CodingTimingReportExportService]
      ] as const) expect(Reflect.get(exportFacade, field)).toBe(module.get(provider));
      for (const provider of [CodingAggregatedExportService, CodingAggregatedRowsExportService, CodingCoderExportService,
        CodingVariableExportService, CodingCompactExportService, CodingDetailedExportService]) {
        expect(Reflect.get(module.get(provider), 'replay')).toBe(module.get(CodingExportReplayService));
        expect(Reflect.get(module.get(provider), 'formatting')).toBe(module.get(CodingExportFormattingService));
        expect(Reflect.get(module.get(provider), 'query')).toBe(module.get(CodingExportQueryService));
      }
      expect(Reflect.get(module.get(CodingAggregatedColumnsExportService), 'query')).toBe(module.get(CodingExportQueryService));
      const facade = module.get(CodingJobService);
      const featureProviders = [
        CodingJobMutationService, CodingJobResponsesService, CodingJobAccessService,
        CodingJobQueryService, CodingJobDistributionService, CodingJobStatusService,
        CodingJobProgressService, CodingJobSchemeService, CodingJobReplayService,
        CodingJobAggregationService
      ];
      const useCaseProviders = [
        TestResultsAnomaliesService, TestResultsCacheService, TestResultsQueryService,
        TestResultsFrequenciesService, TestResultsFilterOptionsService, TestResultsResponsesService, TestResultsReplayService, TestResultsDeletionQueryService,
        TestResultsMutationService, TestResultsSearchService, TestResultsExportService,
        CoderTrainingDisplayService, CoderTrainingSamplingService, CoderTrainingSelectionService, CoderTrainingMutationService,
        CoderTrainingComparisonService, CoderTrainingComparisonQueryService, CoderTrainingKappaService,
        CoderTrainingDiscussionService, CoderTrainingQueryService, CoderTrainingFreshnessService
      ];
      useCaseProviders.forEach(provider => expect(module.get(provider)).toBeInstanceOf(provider));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'anomalies')).toBe(module.get(TestResultsAnomaliesService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'cache')).toBe(module.get(TestResultsCacheService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'query')).toBe(module.get(TestResultsQueryService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'mutation')).toBe(module.get(TestResultsMutationService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'responses')).toBe(module.get(TestResultsResponsesService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'frequencies')).toBe(module.get(TestResultsFrequenciesService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'filterOptions')).toBe(module.get(TestResultsFilterOptionsService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'replay')).toBe(module.get(TestResultsReplayService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'search')).toBe(module.get(TestResultsSearchService));
      expect(Reflect.get(module.get(WorkspaceTestResultsService), 'exporter')).toBe(module.get(TestResultsExportService));
      expect(Reflect.get(module.get(CoderTrainingService), 'selection')).toBe(module.get(CoderTrainingSelectionService));
      expect(Reflect.get(module.get(CoderTrainingService), 'discussion')).toBe(module.get(CoderTrainingDiscussionService));
      expect(Reflect.get(module.get(CoderTrainingService), 'mutation')).toBe(module.get(CoderTrainingMutationService));
      expect(Reflect.get(module.get(CoderTrainingService), 'query')).toBe(module.get(CoderTrainingQueryService));
      expect(Reflect.get(module.get(CoderTrainingService), 'comparison')).toBe(module.get(CoderTrainingComparisonService));
      expect(Reflect.get(module.get(CoderTrainingService), 'freshness')).toBe(module.get(CoderTrainingFreshnessService));
      expect(Reflect.get(module.get(CoderTrainingService), 'kappa')).toBe(module.get(CoderTrainingKappaService));
      expect(Reflect.get(module.get(CoderTrainingSelectionService), 'workspaceFilesService')).toBe(module.get(WORKSPACE_FILE_METADATA_READER));
      for (const provider of [CoderTrainingSelectionService, CoderTrainingMutationService]) {
        expect(Reflect.get(module.get(provider), 'sampling')).toBe(module.get(CoderTrainingSamplingService));
      }
      featureProviders.forEach(provider => expect(module.get(provider)).toBeInstanceOf(provider));
      const metadata = module.select(WorkspaceDataModule).get(WorkspaceFileMetadataService, { strict: true });
      expect(module.get(DERIVED_VARIABLE_READER)).toBe(metadata);
      expect(module.get(WORKSPACE_FILE_METADATA_READER)).toBe(metadata);
      expect(Reflect.get(module.get(WorkspaceFilesService), 'fileMetadata')).toBe(metadata);
      expect(Reflect.get(module.get(ResponseManagementService), 'journalService'))
        .toBe(module.select(WorkspaceDataModule).get(JournalService, { strict: true }));
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

  it('keeps the assigned actor, row lock, mutation and audit inside one transaction across providers', async () => {
    const module = await createApplication();
    try {
      const job = { id: 42, workspace_id: 7, status: 'active' } as CodingJob;
      const jobs = {
        findOne: jest.fn().mockResolvedValue(job),
        save: jest.fn(async value => value)
      };
      const assignments = { count: jest.fn().mockResolvedValue(1) };
      const journal = {
        create: jest.fn(value => value),
        save: jest.fn(async value => value)
      };
      const manager = {
        query: jest.fn().mockResolvedValue([]),
        getRepository: jest.fn(entity => {
          if (entity === CodingJob) return jobs;
          if (entity === CodingJobCoder) return assignments;
          if (entity === JournalEntry) return journal;
          throw new Error('Unexpected repository outside the coding status transaction');
        })
      };
      const transaction = jest.fn(async callback => callback(manager));
      Object.assign(module.get(Connection), { transaction });
      const canCode = jest.spyOn(module.get(UsersService), 'canUserCodeInWorkspace').mockResolvedValue(true);
      const facade = module.get(CodingJobService);

      await expect(facade.pauseCodingJob(42, 7, 5)).resolves.toMatchObject({ status: 'paused' });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(manager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1::int, $2::int)', [expect.any(Number), 7]
      );
      expect(jobs.findOne).toHaveBeenCalledWith({
        where: { id: 42, workspace_id: 7 }, lock: { mode: 'pessimistic_write' }
      });
      expect(canCode).toHaveBeenCalledWith(5, 7, manager);
      expect(assignments.count).toHaveBeenCalledWith({ where: { coding_job_id: 42, user_id: 5 } });
      expect(journal.save).toHaveBeenCalledWith(expect.objectContaining({
        actorUserId: 5,
        workspaceId: 7,
        eventType: 'CODING_JOB_UPDATED',
        entityId: '42',
        details: { changedFields: ['status'], previousStatus: 'active', status: 'paused' }
      }));

      // A capability revoked after the lock must prevent both status writes and audit entries.
      jobs.save.mockClear();
      journal.save.mockClear();
      canCode.mockResolvedValue(false);
      await expect(facade.resumeCodingJob(42, 7, 5)).rejects.toMatchObject({ status: 403 });
      expect(jobs.save).not.toHaveBeenCalled();
      expect(journal.save).not.toHaveBeenCalled();

      // Apply already runs in a transaction: the supplied manager must cross the facade unchanged.
      job.status = 'completed';
      transaction.mockClear();
      await expect(facade.markCodingJobResultsApplied(42, 7, manager as unknown as EntityManager))
        .resolves.toMatchObject({ status: 'results_applied' });
      expect(transaction).not.toHaveBeenCalled();
      expect(jobs.save).toHaveBeenCalledWith(job);
    } finally {
      jest.restoreAllMocks();
      await module.close();
    }
  });
});
