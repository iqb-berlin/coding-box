import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CodingVersionService } from './coding-version.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingAnalysisService } from './coding-analysis.service';
import { CodingValidationService } from './coding-validation.service';
import { JournalService } from '../shared/journal.service';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';

describe('CodingVersionService', () => {
  let service: CodingVersionService;
  const mockQueryBuilder = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    clone: jest.fn().mockReturnThis(),
    setQueryRunner: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn()
  };

  const mockLockQueryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    release: jest.fn().mockResolvedValue(undefined)
  };

  const mockConnection = {
    createQueryRunner: jest.fn(() => mockLockQueryRunner)
  };

  const mockResponseRepository = {
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
    update: jest.fn(),
    delete: jest.fn(),
    manager: { connection: mockConnection }
  };

  const mockCodingStatisticsService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined)
  };

  const mockCodingAnalysisService = {
    invalidateCache: jest.fn().mockResolvedValue(undefined)
  };

  const mockCodingValidationService = {
    invalidateIncompleteVariablesCache: jest.fn().mockResolvedValue(undefined)
  };

  const mockCodingFreshnessService = {
    markVersionsPendingAfterReset: jest.fn().mockResolvedValue([]),
    markExistingAutoCodingVersionsPendingAfterResetScope: jest.fn().mockResolvedValue([]),
    markCodingJobsStaleForResetScope: jest.fn().mockResolvedValue(undefined),
    updateStaleCodingJobResetCountsForResponseIds: jest.fn().mockResolvedValue(undefined),
    clearVersionsAfterReset: jest.fn().mockResolvedValue(undefined),
    markAppliedCodingJobsResultsClearedForUnitIds: jest.fn().mockResolvedValue(undefined),
    markAppliedCodingJobsResultsClearedForResponseIds: jest.fn().mockResolvedValue(undefined),
    reconcileAppliedManualCodingJobs: jest.fn().mockResolvedValue(0)
  };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    jest.spyOn(JournalService, 'recordEventInTransaction').mockResolvedValue(undefined as never);
    Object.assign(mockResponseRepository, {
      manager: {
        transaction: jest.fn(async callback => callback({
          getRepository: () => mockResponseRepository,
          query: jest.fn().mockResolvedValue([]),
          queryRunner: {}
        }))
      }
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingVersionService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: CodingStatisticsService,
          useValue: mockCodingStatisticsService
        },
        {
          provide: CodingAnalysisService,
          useValue: mockCodingAnalysisService
        },
        {
          provide: CodingValidationService,
          useValue: mockCodingValidationService
        },
        {
          provide: CodingFreshnessService,
          useValue: mockCodingFreshnessService
        }
      ]
    }).compile();

    service = module.get<CodingVersionService>(CodingVersionService);

    // Reset mocks before each test
    jest.clearAllMocks();
    mockQueryBuilder.getMany.mockReset();
    mockQueryBuilder.getCount.mockReset();
    mockQueryBuilder.getMany.mockResolvedValue([]);
    mockQueryBuilder.getCount.mockResolvedValue(0);
    mockResponseRepository.update.mockReset();
    mockResponseRepository.delete.mockReset();
    mockResponseRepository.update.mockResolvedValue({ affected: 0 });
    mockResponseRepository.delete.mockResolvedValue({ affected: 0 });
    mockLockQueryRunner.connect.mockResolvedValue(undefined);
    mockLockQueryRunner.query.mockResolvedValue([]);
    mockLockQueryRunner.release.mockResolvedValue(undefined);
    mockCodingAnalysisService.invalidateCache.mockClear();
    mockCodingValidationService.invalidateIncompleteVariablesCache.mockClear();
    Object.values(mockCodingFreshnessService).forEach(mock => mock.mockReset().mockResolvedValue(undefined));
    mockCodingFreshnessService.markVersionsPendingAfterReset.mockResolvedValue([]);
    mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope.mockResolvedValue([]);
    mockCodingFreshnessService.reconcileAppliedManualCodingJobs.mockResolvedValue(0);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('resetCodingVersion', () => {
    it.each(['v1', 'v2', 'v3', 'generated-cleanup'] as const)(
      'waits for the workspace mutation lock before selecting or changing a %s batch',
      async phase => {
        let releaseLock!: () => void;
        let reportLockEntered!: () => void;
        const lockReleased = new Promise<void>(resolve => { releaseLock = resolve; });
        const lockEntered = new Promise<void>(resolve => { reportLockEntered = resolve; });
        const manager = {
          getRepository: () => mockResponseRepository,
          queryRunner: {},
          query: jest.fn().mockImplementationOnce(async () => {
            reportLockEntered();
            await lockReleased;
          }).mockResolvedValue([])
        } as unknown as EntityManager;
        Object.assign(mockResponseRepository, {
          manager: { transaction: async callback => callback(manager) }
        });
        mockQueryBuilder.getCount.mockResolvedValue(phase === 'generated-cleanup' ? 0 : 1);
        mockQueryBuilder.getMany.mockResolvedValueOnce([{ id: 1, unitid: 10, code_v1: 1 }]);

        const reset = service.resetCodingVersion(3, phase === 'generated-cleanup' ? 'v1' : phase);
        await lockEntered;

        expect(manager.query).toHaveBeenCalledWith(
          'SELECT pg_advisory_xact_lock($1::int, $2::int)', [774020251, 3]
        );
        expect(mockQueryBuilder.getMany).not.toHaveBeenCalled();
        expect(mockResponseRepository.update).not.toHaveBeenCalled();
        expect(mockResponseRepository.delete).not.toHaveBeenCalled();
        expect(mockCodingFreshnessService.markVersionsPendingAfterReset).not.toHaveBeenCalled();
        expect(JournalService.recordEventInTransaction).not.toHaveBeenCalled();

        releaseLock();
        await reset;

        expect(mockQueryBuilder.getMany).toHaveBeenCalled();
        if (phase === 'generated-cleanup') {
          expect(mockResponseRepository.delete).toHaveBeenCalledTimes(1);
        } else {
          expect(mockQueryBuilder.setQueryRunner).toHaveBeenCalledWith(manager.queryRunner);
          expect(mockResponseRepository.update).toHaveBeenCalledTimes(1);
        }
      }
    );

    it('does not select or mutate a reset batch when acquiring the workspace lock fails', async () => {
      Object.assign(mockResponseRepository, {
        manager: {
          transaction: async callback => callback({
            getRepository: () => mockResponseRepository,
            query: jest.fn().mockRejectedValue(new Error('lock unavailable'))
          })
        }
      });
      mockQueryBuilder.getCount.mockResolvedValue(1);

      await expect(service.resetCodingVersion(3, 'v1')).rejects.toThrow('lock unavailable');

      expect(mockQueryBuilder.getMany).not.toHaveBeenCalled();
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
      expect(JournalService.recordEventInTransaction).not.toHaveBeenCalled();
      expect(mockCodingStatisticsService.invalidateCache).not.toHaveBeenCalled();
    });

    it('locks final freshness reconciliation and uses its transaction manager even without reset targets', async () => {
      let releaseLock!: () => void;
      let reportLockEntered!: () => void;
      const lockReleased = new Promise<void>(resolve => { releaseLock = resolve; });
      const lockEntered = new Promise<void>(resolve => { reportLockEntered = resolve; });
      const manager = {
        getRepository: () => mockResponseRepository,
        query: jest.fn().mockResolvedValueOnce([]).mockImplementationOnce(async () => {
          reportLockEntered();
          await lockReleased;
        })
      } as unknown as EntityManager;
      Object.assign(mockResponseRepository, { manager: { transaction: async callback => callback(manager) } });

      const reset = service.resetCodingVersion(3, 'v1');
      await lockEntered;

      expect(mockCodingFreshnessService.clearVersionsAfterReset).not.toHaveBeenCalled();
      expect(mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope).not.toHaveBeenCalled();
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs).not.toHaveBeenCalled();
      releaseLock();
      await reset;

      expect(mockCodingFreshnessService.clearVersionsAfterReset)
        .toHaveBeenCalledWith(3, ['v2'], undefined, undefined, { manager });
      expect(mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope)
        .toHaveBeenCalledWith(3, ['v1', 'v3'], undefined, undefined, { manager });
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs)
        .toHaveBeenCalledWith(3, 'RESET', 'stale_source', { unitNames: undefined, variableIds: undefined, manager });
    });

    it.each([
      { version: 'v1', initialFreshness: 'current', failThirdBatch: true },
      { version: 'v2', initialFreshness: 'stale_source', failThirdBatch: true },
      { version: 'v2', initialFreshness: 'current', failThirdBatch: true },
      { version: 'v2', initialFreshness: 'stale_source', failThirdBatch: false },
      { version: 'v2', initialFreshness: 'current', failThirdBatch: false }
    ] as const)('counts committed $version batches for $initialFreshness (fail third batch: $failThirdBatch)', async ({
      version, initialFreshness, failThirdBatch
    }) => {
      const rows = Array.from({ length: 10001 }, (_, index) => ({
        id: index + 1, unitid: index + 1, code_v1: 1, code_v2: 2
      }));
      let committed = {
        rows: rows.map(row => ({ ...row })),
        job: {
          status: 'results_applied',
          freshnessStatus: initialFreshness as string,
          freshnessReason: initialFreshness === 'stale_source' ? 'RESULT_UPDATED' : null as string | null,
          affectedUnits: 0,
          affectedResponses: 0
        },
        audits: 0
      };
      const staged = new Map<EntityManager, typeof committed>();
      const realFreshnessService = new CodingFreshnessService(
        {} as Repository<CodingUnitFreshness>, {} as Repository<ResponseEntity>, {} as DataSource
      );
      let transactionCount = 0;
      Object.assign(mockResponseRepository, {
        manager: {
          transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => {
            transactionCount += 1;
            const pending: typeof committed = JSON.parse(JSON.stringify(committed));
            const manager = {
              queryRunner: {},
              getRepository: () => ({
                createQueryBuilder: () => mockQueryBuilder,
                update: async (criteria: { id: { value: number[] } }, values: Record<string, null>) => {
                  const ids = new Set(criteria.id.value);
                  pending.rows.filter(row => ids.has(row.id)).forEach(row => Object.assign(row, values));
                  return { affected: ids.size };
                }
              }),
              query: jest.fn(async (sql: string, parameters: unknown[]) => {
                if (!sql.includes('WITH affected_jobs')) return [];
                const invalidatesAppliedResults = sql.includes("SET status = 'completed'");
                const updatesStaleCountsOnly = sql.includes("AND cj.freshness_status = 'stale_source'");
                if (invalidatesAppliedResults && pending.job.status !== 'results_applied') return [];
                if (updatesStaleCountsOnly && (pending.job.status !== 'completed' || pending.job.freshnessStatus !== 'stale_source')) {
                  return [];
                }
                const unitIds = new Set(invalidatesAppliedResults || updatesStaleCountsOnly ? [] : parameters[1] as number[]);
                const responseIds = new Set((invalidatesAppliedResults || updatesStaleCountsOnly ? parameters[1] : parameters[4] || []) as number[]);
                const affected = pending.rows.filter(row => unitIds.has(row.unitid) || responseIds.has(row.id));
                if (affected.length === 0) return [];
                if (invalidatesAppliedResults) {
                  pending.job.status = 'completed';
                  const preservesStaleSource = parameters[2] === 'current' && pending.job.freshnessStatus === 'stale_source';
                  if (!preservesStaleSource) {
                    pending.job.freshnessStatus = parameters[2] as string;
                    pending.job.freshnessReason = parameters[2] === 'current' ? null : parameters[3] as string;
                  }
                } else if (!updatesStaleCountsOnly) {
                  pending.job.freshnessStatus = 'stale_source';
                  pending.job.freshnessReason = 'RESET';
                }
                if (pending.job.freshnessStatus === 'current') {
                  pending.job.affectedUnits = 0;
                  pending.job.affectedResponses = 0;
                  return [];
                }
                pending.job.affectedUnits = Math.max(pending.job.affectedUnits, new Set(affected.map(row => row.unitid)).size);
                pending.job.affectedResponses = Math.max(pending.job.affectedResponses, new Set(affected.map(row => row.id)).size);
                return [];
              })
            } as unknown as EntityManager;
            staged.set(manager, pending);
            const result = await callback(manager);
            committed = pending;
            return result;
          }
        }
      });
      mockCodingFreshnessService.markVersionsPendingAfterReset.mockImplementation(async (_workspaceId, scope) => scope.v1 || []);
      mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds.mockImplementation(
        (workspaceId, ids, reason, status, manager) => realFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds(
          workspaceId, ids, reason, status, manager
        )
      );
      mockCodingFreshnessService.markCodingJobsStaleForResetScope.mockImplementation(
        (workspaceId, unitIds, responseIds, manager) => realFreshnessService.markCodingJobsStaleForResetScope(
          workspaceId, unitIds, responseIds, manager
        )
      );
      mockCodingFreshnessService.updateStaleCodingJobResetCountsForResponseIds.mockImplementation(
        (workspaceId, ids, manager) => realFreshnessService.updateStaleCodingJobResetCountsForResponseIds(workspaceId, ids, manager)
      );
      jest.mocked(JournalService.recordEventInTransaction).mockImplementation(async manager => {
        if (failThirdBatch && transactionCount === 3) throw new Error('third audit unavailable');
        staged.get(manager)!.audits += 1;
        return undefined as never;
      });
      mockQueryBuilder.getCount.mockResolvedValue(rows.length);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(rows.slice(0, 5000))
        .mockResolvedValueOnce(rows.slice(5000, 10000))
        .mockResolvedValueOnce(rows.slice(10000));

      if (failThirdBatch) {
        await expect(service.resetCodingVersion(3, version)).rejects.toThrow('third audit unavailable');
        expect(committed.rows[10000]).toEqual(rows[10000]);
      } else {
        await expect(service.resetCodingVersion(3, version)).resolves.toMatchObject({ affectedResponseCount: rows.length });
      }

      const committedResponseCount = failThirdBatch ? 10000 : 10001;
      const expectedFreshness = version === 'v1' ? 'stale_source' : initialFreshness;
      const expectedCount = expectedFreshness === 'stale_source' ? committedResponseCount : 0;
      const initialReason = initialFreshness === 'stale_source' ? 'RESULT_UPDATED' : null;
      expect(committed.rows.filter(row => row[`code_${version}`] === null)).toHaveLength(committedResponseCount);
      expect(committed.job).toEqual({
        status: 'completed',
        freshnessStatus: expectedFreshness,
        freshnessReason: version === 'v1' ? 'RESET' : initialReason,
        affectedUnits: expectedCount,
        affectedResponses: expectedCount
      });
      expect(committed.audits).toBe(failThirdBatch ? 2 : 3);
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(3, version);
      if (version === 'v2') expect(mockCodingFreshnessService.markCodingJobsStaleForResetScope).not.toHaveBeenCalled();
    });

    it('deduplicates overlapping source and manual-result scopes across reset batches', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(3);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([{
          id: 1, unitid: 10, code_v1: 1, code_v2: 2
        }])
        .mockResolvedValueOnce([{
          id: 2, unitid: 10, code_v1: 1, code_v2: 2
        }])
        .mockResolvedValueOnce([{ id: 3, unitid: 30, code_v2: 2 }]);
      mockCodingFreshnessService.markVersionsPendingAfterReset
        .mockResolvedValueOnce([10]).mockResolvedValueOnce([10]).mockResolvedValueOnce([]);
      mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope
        .mockResolvedValueOnce([10, 20]).mockResolvedValueOnce([20]).mockResolvedValueOnce([]);

      await service.resetCodingVersion(3, 'v1');

      expect(mockCodingFreshnessService.markCodingJobsStaleForResetScope)
        .toHaveBeenNthCalledWith(1, 3, [10, 20], [1], expect.anything());
      expect(mockCodingFreshnessService.markCodingJobsStaleForResetScope)
        .toHaveBeenNthCalledWith(2, 3, [10, 20], [1, 2], expect.anything());
      expect(mockCodingFreshnessService.markCodingJobsStaleForResetScope)
        .toHaveBeenNthCalledWith(3, 3, [10, 20], [1, 2, 3], expect.anything());
    });

    it('keeps v2 reset counters scoped to deduplicated manual-result responses, not entire units', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce([{ id: 101, unitid: 10, code_v2: 2 }])
        .mockResolvedValueOnce([{ id: 102, unitid: 10, code_v2: 2 }]);

      await service.resetCodingVersion(3, 'v2', undefined, ['VAR_A']);

      expect(mockCodingFreshnessService.updateStaleCodingJobResetCountsForResponseIds)
        .toHaveBeenNthCalledWith(1, 3, [101], expect.anything());
      expect(mockCodingFreshnessService.updateStaleCodingJobResetCountsForResponseIds)
        .toHaveBeenNthCalledWith(2, 3, [101, 102], expect.anything());
      expect(mockCodingFreshnessService.markCodingJobsStaleForResetScope).not.toHaveBeenCalled();
    });

    it('commits reset data and its trusted job audit together', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValue([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });
      await service.resetCodingVersion(3, 'v1', undefined, undefined, undefined, { actorUserId: 7, jobId: 'reset-1' });
      expect(JournalService.recordEventInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        workspaceId: 3,
        actorUserId: 7,
        actorType: 'job',
        jobId: 'reset-1',
        eventType: 'CODING_VERSION_RESET',
        details: {
          version: 'v1', phase: 'reset', affectedResponseCount: 1, cascadeResetVersions: ['v2', 'v3']
        }
      }));
    });

    it('rolls back the first reset batch on audit failure', async () => {
      let committed = false;
      Object.assign(mockResponseRepository, {
        manager: {
          transaction: async callback => {
            const result = await callback({ getRepository: () => mockResponseRepository, query: jest.fn().mockResolvedValue([]) });
            committed = true;
            return result;
          }
        }
      });
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce([{ id: 1 }]);
      jest.mocked(JournalService.recordEventInTransaction).mockRejectedValueOnce(new Error('audit unavailable'));
      await expect(service.resetCodingVersion(3, 'v1')).rejects.toThrow('audit unavailable');
      expect(committed).toBe(false);
      expect(mockCodingStatisticsService.invalidateCache).not.toHaveBeenCalled();
    });

    it('refreshes caches when a later reset batch fails to record its audit', async () => {
      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 2 }]);
      jest.mocked(JournalService.recordEventInTransaction)
        .mockResolvedValueOnce(undefined as never).mockRejectedValueOnce(new Error('audit unavailable'));
      await expect(service.resetCodingVersion(3, 'v1')).rejects.toThrow('audit unavailable');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(3, 'v1');
      expect(mockCodingAnalysisService.invalidateCache).toHaveBeenCalledWith(3);
    });

    it.each(['v1', 'v2', 'v3'] as const)('keeps data, freshness and job status atomic per %s reset batch', async version => {
      const rows = [
        {
          id: 1, unitid: 10, code_v1: 1, code_v2: 2, code_v3: 3
        },
        {
          id: 2, unitid: 20, code_v1: 1, code_v2: 2, code_v3: 3
        }
      ];
      let committed = {
        rows: rows.map(row => ({ ...row })),
        pendingUnits: [] as number[],
        clearedManualUnits: [] as number[],
        invalidatedJobs: [] as number[],
        auditCount: 0
      };
      const staged = new Map<EntityManager, typeof committed>();
      const managers: EntityManager[] = [];
      Object.assign(mockResponseRepository, {
        manager: {
          transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => {
            const pending: typeof committed = JSON.parse(JSON.stringify(committed));
            const manager = {
              query: jest.fn().mockResolvedValue([]),
              queryRunner: {},
              getRepository: () => ({
                createQueryBuilder: () => mockQueryBuilder,
                update: async (criteria: { id: { value: number[] } }, values: Record<string, null>) => {
                  pending.rows.filter(row => criteria.id.value.includes(row.id))
                    .forEach(row => Object.assign(row, values));
                  return { affected: criteria.id.value.length };
                }
              })
            } as unknown as EntityManager;
            managers.push(manager);
            staged.set(manager, pending);
            const result = await callback(manager);
            committed = pending;
            return result;
          }
        }
      });
      mockCodingFreshnessService.markVersionsPendingAfterReset.mockImplementation(
        async (_workspaceId: number, unitIdsByVersion: Record<string, number[]>, manager: EntityManager) => {
          staged.get(manager)!.pendingUnits.push(...new Set(Object.values(unitIdsByVersion).flat()));
          return unitIdsByVersion.v1 || [];
        }
      );
      mockCodingFreshnessService.clearVersionsAfterReset.mockImplementation(
        async (_workspaceId: number, _versions: string[], _unitNames: unknown, _variables: unknown,
               options: { unitIds: number[]; manager: EntityManager }) => {
          staged.get(options.manager)!.clearedManualUnits.push(...options.unitIds);
        }
      );
      mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds.mockImplementation(
        async (_workspaceId: number, ids: number[], _reason: string, _status: string, manager: EntityManager) => {
          staged.get(manager)!.invalidatedJobs.push(...ids);
        }
      );
      jest.mocked(JournalService.recordEventInTransaction).mockImplementation(async manager => {
        if (managers.length === 2) throw new Error('second audit unavailable');
        staged.get(manager)!.auditCount += 1;
        return undefined as never;
      });
      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce([rows[0]]).mockResolvedValueOnce([rows[1]]);

      await expect(service.resetCodingVersion(3, version)).rejects.toThrow('second audit unavailable');

      expect(committed.rows[0][`code_${version}`]).toBeNull();
      expect(committed.rows[1]).toEqual(rows[1]);
      expect(committed.pendingUnits).toEqual([10]);
      expect(committed.clearedManualUnits).toEqual(version === 'v1' ? [10] : []);
      expect(committed.invalidatedJobs).toEqual(version === 'v3' ? [] : [1]);
      expect(committed.auditCount).toBe(1);
      expect(mockCodingFreshnessService.markVersionsPendingAfterReset).toHaveBeenCalledTimes(2);
      expect(mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope)
        .toHaveBeenNthCalledWith(1, 3, version === 'v1' ? ['v1', 'v3'] : ['v3'], undefined, undefined, {
          unitIds: [10], manager: managers[0]
        });
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs).not.toHaveBeenCalled();
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(3, version);
    });

    it('rolls back reset data and skips audit when updating freshness fails', async () => {
      let committed = false;
      Object.assign(mockResponseRepository, {
        manager: {
          transaction: async callback => {
            await callback({ getRepository: () => mockResponseRepository, query: jest.fn().mockResolvedValue([]) });
            committed = true;
          }
        }
      });
      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce([{ id: 1, unitid: 10, code_v2: 2 }]);
      mockCodingFreshnessService.markVersionsPendingAfterReset.mockRejectedValueOnce(new Error('freshness unavailable'));

      await expect(service.resetCodingVersion(3, 'v2')).rejects.toThrow('freshness unavailable');

      expect(committed).toBe(false);
      expect(JournalService.recordEventInTransaction).not.toHaveBeenCalled();
      expect(mockCodingStatisticsService.invalidateCache).not.toHaveBeenCalled();
    });

    it('should reset v1 version and cascade to v2 and v3', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }, { id: 3 }];

      mockQueryBuilder.getCount.mockResolvedValue(3);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 3 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 3,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'Successfully reset 3 responses for version v1 and v2, v3 (cascade)'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v1: null,
          code_v1: null,
          score_v1: null,
          status_v2: null,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status IN (:...codedStatuses)',
        { codedStatuses: [1, 2, 3] }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v1 IS NOT NULL OR response.code_v1 IS NOT NULL OR response.score_v1 IS NOT NULL OR response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL OR response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v1');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(3);
      expect(mockCodingAnalysisService.invalidateCache).toHaveBeenCalledWith(1);
      expect(mockCodingValidationService.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(1);
    });

    it('should reset v2 version and cascade to v3', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const mockResponses = [{ id: 1 }, { id: 2 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 2,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: ['v3'],
        message: 'Successfully reset 2 responses for version v2 and v3 (cascade)'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v2: null,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL OR response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(2);
    });

    it('should reset v3 version without cascade', async () => {
      const workspaceId = 1;
      const version = 'v3';
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 1,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: [],
        message: 'Successfully reset 1 responses for version v3'
      });
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        {
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledTimes(1);
    });

    it('should mark affected reset units pending by the versions that had coding data', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const mockResponses = [
        {
          id: 1,
          unitid: 10,
          status_v2: 2,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        },
        {
          id: 2,
          unitid: 11,
          status_v2: null,
          code_v2: null,
          score_v2: null,
          status_v3: 1,
          code_v3: null,
          score_v3: null
        }
      ];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockCodingFreshnessService.markVersionsPendingAfterReset)
        .toHaveBeenCalledWith(1, {
          v2: [10],
          v3: [11]
        }, expect.anything());
    });

    it('should move applied jobs back to completed/current when v2 results are reset', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const mockResponses = [
        {
          id: 1,
          unitid: 10,
          status_v2: 2,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      ];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .toHaveBeenCalledWith(1, [1], 'RESET', 'current', expect.anything());
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs)
        .toHaveBeenCalledWith(1, 'RESET', 'current', {
          unitNames: undefined,
          variableIds: undefined,
          manager: expect.anything()
        });
      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForUnitIds)
        .not.toHaveBeenCalled();
    });

    it('should move applied jobs back to completed/stale-source when v1 reset cascades v2 results', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [
        {
          id: 1,
          unitid: 10,
          status_v1: 2,
          code_v1: null,
          score_v1: null,
          status_v2: 2,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      ];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .toHaveBeenCalledWith(1, [1], 'RESET', 'stale_source', expect.anything());
      expect(mockCodingFreshnessService.clearVersionsAfterReset)
        .toHaveBeenCalledWith(1, ['v2'], undefined, undefined, { manager: expect.anything() });
      expect(mockCodingFreshnessService.markVersionsPendingAfterReset)
        .toHaveBeenCalledWith(1, {
          v1: [10]
        }, expect.anything());
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs)
        .toHaveBeenCalledWith(1, 'RESET', 'stale_source', {
          unitNames: undefined,
          variableIds: undefined,
          manager: expect.anything()
        });
      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForUnitIds)
        .not.toHaveBeenCalled();
    });

    it('should not change applied manual jobs when only v3 is reset', async () => {
      const workspaceId = 1;
      const version = 'v3';
      const mockResponses = [
        {
          id: 1,
          unitid: 10,
          status_v3: 2,
          code_v3: null,
          score_v3: null
        }
      ];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .not.toHaveBeenCalled();
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs)
        .not.toHaveBeenCalled();
    });

    it('should mark applied jobs by response ids so variable filters do not reset whole units', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const variableFilters = ['VAR_A'];
      const mockResponses = [
        {
          id: 101,
          unitid: 10,
          variableid: 'VAR_A',
          status_v2: 2,
          code_v2: null,
          score_v2: null,
          status_v3: null,
          code_v3: null,
          score_v3: null
        }
      ];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(mockResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(
        workspaceId,
        version,
        undefined,
        variableFilters
      );

      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .toHaveBeenCalledWith(1, [101], 'RESET', 'current', expect.anything());
      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs)
        .toHaveBeenCalledWith(1, 'RESET', 'current', {
          unitNames: undefined,
          variableIds: ['VAR_A'],
          manager: expect.anything()
        });
      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForUnitIds)
        .not.toHaveBeenCalled();
    });

    it('should reconcile already-inconsistent applied jobs even when reset finds no response targets', async () => {
      const workspaceId = 1;
      const version = 'v2';
      const unitFilters = ['UNIT_A'];

      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockQueryBuilder.getMany.mockResolvedValueOnce([]);

      await service.resetCodingVersion(workspaceId, version, unitFilters);

      expect(mockCodingFreshnessService.reconcileAppliedManualCodingJobs)
        .toHaveBeenCalledWith(1, 'RESET', 'current', {
          unitNames: ['UNIT_A'],
          variableIds: undefined,
          manager: expect.anything()
        });
      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .not.toHaveBeenCalled();
    });

    it('should target v1 rows when only code or score values remain', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      await service.resetCodingVersion(workspaceId, version);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.status_v1 IS NOT NULL OR response.code_v1 IS NOT NULL OR response.score_v1 IS NOT NULL OR response.status_v2 IS NOT NULL OR response.code_v2 IS NOT NULL OR response.score_v2 IS NOT NULL OR response.status_v3 IS NOT NULL OR response.code_v3 IS NOT NULL OR response.score_v3 IS NOT NULL)'
      );
      expect(mockResponseRepository.update).toHaveBeenCalledWith(
        { id: expect.anything() },
        expect.objectContaining({
          status_v1: null,
          code_v1: null,
          score_v1: null
        })
      );
    });

    it('should apply unit filters when provided', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const unitFilters = ['unit1', 'unit2'];
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(workspaceId, version, unitFilters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.name IN (:...unitNames)',
        { unitNames: unitFilters }
      );
    });

    it('should apply variable filters when provided', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const variableFilters = ['var1', 'var2'];
      const mockResponses = [{ id: 1 }];

      mockQueryBuilder.getCount.mockResolvedValue(1);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      await service.resetCodingVersion(
        workspaceId,
        version,
        undefined,
        variableFilters
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.variableid IN (:...variableIds)',
        { variableIds: variableFilters }
      );
    });

    it('should return zero count when no responses match filters', async () => {
      const workspaceId = 1;
      const version = 'v1';

      mockQueryBuilder.getCount.mockResolvedValue(0);

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 0,
        deletedGeneratedResponseCount: 0,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'No responses found matching the filters for version v1'
      });
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v1');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v2');
      expect(mockCodingStatisticsService.invalidateCache).toHaveBeenCalledWith(1, 'v3');
      expect(mockCodingFreshnessService.markVersionsPendingAfterReset).not.toHaveBeenCalled();
      expect(mockCodingFreshnessService.clearVersionsAfterReset)
        .toHaveBeenCalledWith(1, ['v2'], undefined, undefined, { manager: expect.anything() });
      expect(mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope)
        .toHaveBeenCalledWith(1, ['v1', 'v3'], undefined, undefined, { manager: expect.anything() });
    });

    it('reopens existing auto-coding freshness even when no coded responses match reset', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const unitFilters = ['UNIT_A'];
      const variableFilters = ['VAR_A'];

      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version, unitFilters, variableFilters);

      expect(mockCodingFreshnessService.clearVersionsAfterReset)
        .toHaveBeenCalledWith(1, ['v2'], unitFilters, variableFilters, { manager: expect.anything() });
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
      expect(mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope)
        .toHaveBeenCalledWith(1, ['v1', 'v3'], unitFilters, variableFilters, { manager: expect.anything() });
    });

    it('reopens second auto-coding freshness after manual coding reset cascades to v3', async () => {
      const workspaceId = 1;
      const version = 'v2';

      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version);

      expect(mockCodingFreshnessService.markExistingAutoCodingVersionsPendingAfterResetScope)
        .toHaveBeenCalledWith(1, ['v3'], undefined, undefined, { manager: expect.anything() });
    });

    it('should handle large batches correctly', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const batch1 = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1 }));
      const batch2 = Array.from({ length: 3000 }, (_, i) => ({ id: i + 5001 }));

      mockQueryBuilder.getCount.mockResolvedValue(8000);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(batch1)
        .mockResolvedValueOnce(batch2)
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result.affectedResponseCount).toBe(8000);
      expect(mockResponseRepository.update).toHaveBeenCalledTimes(2);
      // Verify that skip is always called with 0
      expect(mockQueryBuilder.skip).toHaveBeenCalledWith(0);
    });

    it('should call progressCallback with expected progress values', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const mockResponses = [{ id: 1 }, { id: 2 }];
      const progressCallback = jest.fn().mockResolvedValue(undefined);

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany.mockResolvedValueOnce(mockResponses).mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });

      await service.resetCodingVersion(workspaceId, version, undefined, undefined, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(0);
      expect(progressCallback).toHaveBeenCalledWith(5);
      expect(progressCallback).toHaveBeenCalledWith(10);
      expect(progressCallback).toHaveBeenCalledWith(100);
      expect(progressCallback.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('should call progressCallback with 100 when no responses match', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const progressCallback = jest.fn().mockResolvedValue(undefined);

      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version, undefined, undefined, progressCallback);

      expect(progressCallback).toHaveBeenCalledWith(0);
      expect(progressCallback).toHaveBeenCalledWith(100);
    });

    it('should delete empty autocoder-generated responses after resetting v1', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const resetResponses = [{ id: 1 }, { id: 2 }];
      const generatedResponses = [{ id: 100 }, { id: 101 }];

      mockQueryBuilder.getCount.mockResolvedValue(2);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(resetResponses)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(generatedResponses)
        .mockResolvedValueOnce([]);
      mockResponseRepository.update.mockResolvedValue({ affected: 2 });
      mockResponseRepository.delete.mockResolvedValue({ affected: 2 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 2,
        deletedGeneratedResponseCount: 2,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'Successfully reset 2 responses for version v1 and v2, v3 (cascade) and removed 2 generated response rows'
      });
      expect(mockResponseRepository.delete).toHaveBeenCalledWith({
        id: expect.anything()
      });
      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .toHaveBeenCalledWith(1, [100, 101], 'RESET', 'stale_source', expect.anything());
      expect(
        mockCodingFreshnessService
          .markAppliedCodingJobsResultsClearedForResponseIds
          .mock
          .invocationCallOrder[0]
      )
        .toBeLessThan(mockResponseRepository.delete.mock.invocationCallOrder[0]);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.is_autocoder_generated = :generated',
        { generated: true }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status_v1 IS NULL AND response.code_v1 IS NULL AND response.score_v1 IS NULL AND response.status_v2 IS NULL AND response.code_v2 IS NULL AND response.score_v2 IS NULL AND response.status_v3 IS NULL AND response.code_v3 IS NULL AND response.score_v3 IS NULL'
      );
    });

    it('should cleanup already-empty generated responses even when no reset targets match', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const generatedResponses = [{ id: 200 }];

      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockQueryBuilder.getMany
        .mockResolvedValueOnce(generatedResponses)
        .mockResolvedValueOnce([]);
      mockResponseRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.resetCodingVersion(workspaceId, version);

      expect(result).toEqual({
        affectedResponseCount: 0,
        deletedGeneratedResponseCount: 1,
        cascadeResetVersions: ['v2', 'v3'],
        message: 'No responses found matching the filters for version v1; removed 1 generated response rows'
      });
      expect(mockResponseRepository.update).not.toHaveBeenCalled();
      expect(mockResponseRepository.delete).toHaveBeenCalledWith({
        id: expect.anything()
      });
      expect(mockCodingFreshnessService.markAppliedCodingJobsResultsClearedForResponseIds)
        .toHaveBeenCalledWith(1, [200], 'RESET', 'stale_source', expect.anything());
    });

    it('should apply unit and variable filters when deleting empty generated responses', async () => {
      const workspaceId = 1;
      const version = 'v1';
      const unitFilters = ['UNIT_A'];
      const variableFilters = ['derived_var'];

      mockQueryBuilder.getCount.mockResolvedValue(0);
      mockQueryBuilder.getMany.mockResolvedValueOnce([]);

      await service.resetCodingVersion(
        workspaceId,
        version,
        unitFilters,
        variableFilters
      );

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'unit.name IN (:...unitNames)',
        { unitNames: unitFilters }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.variableid IN (:...variableIds)',
        { variableIds: variableFilters }
      );
    });

    it('should throw error on database failure', async () => {
      const workspaceId = 1;
      const version = 'v1';

      mockQueryBuilder.getCount.mockRejectedValue(new Error('Database error'));

      await expect(
        service.resetCodingVersion(workspaceId, version)
      ).rejects.toThrow('Failed to reset coding version: Database error');
    });

    it('should always exclude aggregated duplicates (code -111)', async () => {
      const workspaceId = 1;
      const version = 'v2';
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(response.code_v2 IS NULL OR response.code_v2 != -111)'
      );
    });

    it('should only include responses with coded statuses (1, 2, 3)', async () => {
      const workspaceId = 1;
      const version = 'v1';
      mockQueryBuilder.getCount.mockResolvedValue(0);

      await service.resetCodingVersion(workspaceId, version);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'response.status IN (:...codedStatuses)',
        { codedStatuses: [1, 2, 3] }
      );
    });
  });
});
