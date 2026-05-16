import { DataSource, Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { CodingFreshnessService } from './coding-freshness.service';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';

const queryBuilder = (overrides: Record<string, jest.Mock> = {}) => ({
  select: jest.fn().mockReturnThis(),
  addSelect: jest.fn().mockReturnThis(),
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  innerJoin: jest.fn().mockReturnThis(),
  groupBy: jest.fn().mockReturnThis(),
  addGroupBy: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  getRawMany: jest.fn().mockResolvedValue([]),
  getRawOne: jest.fn().mockResolvedValue({}),
  ...overrides
});

describe('CodingFreshnessService', () => {
  let freshnessRepository: Repository<CodingUnitFreshness>;
  let responseRepository: Repository<ResponseEntity>;
  let connection: DataSource;
  let service: CodingFreshnessService;

  beforeEach(() => {
    freshnessRepository = {
      createQueryBuilder: jest.fn(),
      upsert: jest.fn().mockResolvedValue({})
    } as unknown as Repository<CodingUnitFreshness>;

    responseRepository = {
      createQueryBuilder: jest.fn()
    } as unknown as Repository<ResponseEntity>;

    connection = {
      query: jest.fn(),
      createQueryBuilder: jest.fn()
    } as unknown as DataSource;

    service = new CodingFreshnessService(
      freshnessRepository,
      responseRepository,
      connection
    );
  });

  it('summarizes freshness rows by version and state', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 7 }]);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(
      queryBuilder({
        getRawMany: jest.fn().mockResolvedValue([
          {
            version: 'v1',
            state: 'PENDING',
            unitCount: '2',
            affectedResponseCount: '5'
          },
          {
            version: 'v2',
            state: 'MANUAL_REVIEW_REQUIRED',
            unitCount: '1',
            affectedResponseCount: '2'
          }
        ])
      })
    );

    await expect(service.getSummary(1)).resolves.toEqual({
      workspaceId: 1,
      currentRevision: 7,
      items: [
        {
          version: 'v1',
          state: 'PENDING',
          unitCount: 2,
          affectedResponseCount: 5
        },
        {
          version: 'v2',
          state: 'MANUAL_REVIEW_REQUIRED',
          unitCount: 1,
          affectedResponseCount: 2
        }
      ]
    });
  });

  it('applies workspace exclusions when summarizing freshness rows', async () => {
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: ['IGNORED_UNIT'],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
    service = new CodingFreshnessService(
      freshnessRepository,
      responseRepository,
      connection,
      workspaceExclusionService
    );

    (connection.query as jest.Mock).mockResolvedValue([{ revision: 7 }]);
    const summaryQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([])
    });
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);

    await service.getSummary(1);

    expect(workspaceExclusionService.resolveExclusionsForQueries)
      .toHaveBeenCalledWith(1);
    expect(summaryQb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT IN'),
      expect.objectContaining({
        workspaceExclusionIgnoredUnits: ['IGNORED_UNIT']
      })
    );
  });

  it('returns grouped freshness scope for non-current rows', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 8 }]);
    const scopeQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        {
          unitId: '10',
          personId: '100',
          groupName: 'A',
          version: 'v1',
          state: 'PENDING',
          affectedResponseCount: '2'
        },
        {
          unitId: '11',
          personId: '100',
          groupName: 'A',
          version: 'v1',
          state: 'STALE',
          affectedResponseCount: '3'
        },
        {
          unitId: '12',
          personId: '101',
          groupName: 'B',
          version: 'v1',
          state: 'PENDING',
          affectedResponseCount: '4'
        }
      ])
    });
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(scopeQb);

    await expect(service.getScope(1, ['v1'], ['PENDING', 'STALE']))
      .resolves.toEqual({
        workspaceId: 1,
        currentRevision: 8,
        versions: ['v1'],
        states: ['PENDING', 'STALE'],
        unitCount: 3,
        personCount: 2,
        groupCount: 2,
        affectedResponseCount: 9,
        unitIds: [10, 11, 12],
        personIds: [100, 101],
        groupNames: ['A', 'B'],
        groups: [
          {
            groupName: 'A',
            personCount: 1,
            unitCount: 2,
            affectedResponseCount: 5,
            items: [
              {
                version: 'v1',
                state: 'PENDING',
                unitCount: 1,
                affectedResponseCount: 2
              },
              {
                version: 'v1',
                state: 'STALE',
                unitCount: 1,
                affectedResponseCount: 3
              }
            ]
          },
          {
            groupName: 'B',
            personCount: 1,
            unitCount: 1,
            affectedResponseCount: 4,
            items: [
              {
                version: 'v1',
                state: 'PENDING',
                unitCount: 1,
                affectedResponseCount: 4
              }
            ]
          }
        ]
      });
  });

  it('marks changed units stale, pending, and manual-review according to existing coding data', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 4 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '2' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: true })
    });
    const unitPresenceQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        {
          unitId: 10,
          v1: true,
          v2: true,
          v3: false
        }
      ])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb);

    await service.markUnitsStaleAfterResultChange(1, [10], 'RESULT_UPDATED');

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          unit_id: 10,
          version: 'v1',
          state: 'STALE',
          reason: 'RESULT_UPDATED',
          affected_response_count: 2,
          source_revision: 4
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v3',
          state: 'PENDING',
          reason: 'RESULT_UPDATED'
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v2',
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'RESULT_UPDATED'
        })
      ]),
      ['workspace_id', 'unit_id', 'version']
    );
  });

  it('does not mark excluded imported units as pending', async () => {
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: ['IGNORED_UNIT'],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;
    service = new CodingFreshnessService(
      freshnessRepository,
      responseRepository,
      connection,
      workspaceExclusionService
    );

    const includedUnitsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ id: 10 }])
    });
    (connection.createQueryBuilder as jest.Mock).mockReturnValue(includedUnitsQb);
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 5 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '2' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: false, v3: false })
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb);

    await service.markUnitsPendingAfterImport(1, [10, 20], 4);

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        unit_id: 10,
        version: 'v1',
        state: 'PENDING',
        reason: 'RESULT_ADDED',
        affected_response_count: 2,
        source_revision: 5
      })],
      ['workspace_id', 'unit_id', 'version']
    );
    expect(JSON.stringify((freshnessRepository.upsert as jest.Mock).mock.calls[0][0]))
      .not.toContain('"unit_id":20');
  });

  it('marks reset units as pending or manual review by coding version', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 9 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        { unitId: 10, count: '2' },
        { unitId: 20, count: '5' }
      ])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb);

    await service.markVersionsPendingAfterReset(1, {
      v1: [10, 20, 10],
      v2: [10],
      v3: [20]
    });

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          unit_id: 10,
          version: 'v1',
          state: 'PENDING',
          reason: 'RESET',
          affected_response_count: 2,
          source_revision: 9,
          coded_revision: null
        }),
        expect.objectContaining({
          unit_id: 20,
          version: 'v1',
          state: 'PENDING',
          reason: 'RESET',
          affected_response_count: 5
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v2',
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'RESET'
        }),
        expect.objectContaining({
          unit_id: 20,
          version: 'v3',
          state: 'PENDING',
          reason: 'RESET'
        })
      ]),
      ['workspace_id', 'unit_id', 'version']
    );
    expect((freshnessRepository.upsert as jest.Mock).mock.calls[0][0]).toHaveLength(4);
  });

  it('marks only v1/v2 reset units as manual-job review required', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 9 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        { unitId: 10, count: '2' },
        { unitId: 20, count: '5' }
      ])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb);

    await service.markVersionsPendingAfterReset(1, {
      v1: [10],
      v3: [20]
    });

    const queryCalls = (connection.query as jest.Mock).mock.calls;
    expect(queryCalls[queryCalls.length - 1]).toEqual([
      expect.stringContaining('resp.unitid = ANY($2::int[])'),
      [1, [10], 'review_required', 'RESET']
    ]);
  });

  it('marks manual coding jobs review-required by response ids before source deletion', async () => {
    await service.markCodingJobsStaleForResponseIds(1, [100, 100, 0], 'RESULT_DELETED');

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('cju.response_id = ANY($2::int[])'),
      [1, [100], 'review_required', 'RESULT_DELETED']
    );
  });

  it('marks manual coding jobs review-required by unit ids after source changes', async () => {
    await service.markCodingJobsStaleForUnitIds(1, [10, 10, -1], 'RESULT_UPDATED');

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('resp.unitid = ANY($2::int[])'),
      [1, [10], 'review_required', 'RESULT_UPDATED']
    );
  });

  it('does not apply the aggregate import count to imported units with zero responses', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 6 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '2' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: false, v3: false })
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb);

    await service.markUnitsPendingAfterImport(1, [10, 20], 100);

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          unit_id: 10,
          affected_response_count: 2
        }),
        expect.objectContaining({
          unit_id: 20,
          affected_response_count: 0
        })
      ]),
      ['workspace_id', 'unit_id', 'version']
    );
  });

  it('marks imported units pending for the first auto-coding run when no coding exists yet', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 7 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '3' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: false, v2: false, v3: false })
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb);

    await service.markUnitsPendingAfterImport(1, [10], 3);

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        unit_id: 10,
        version: 'v1',
        state: 'PENDING',
        reason: 'RESULT_ADDED',
        affected_response_count: 3,
        source_revision: 7
      })],
      ['workspace_id', 'unit_id', 'version']
    );
  });

  it('marks existing manual jobs matching newly imported variables as review-required', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 7 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '3' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: false })
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb);

    await service.markUnitsPendingAfterImport(1, [10], 3);

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('coding_job_variable'),
      [1, [10], 'review_required', 'RESULT_ADDED']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('variable_bundle.variables @>'),
      [1, [10], 'review_required', 'RESULT_ADDED']
    );
  });

  it('blocks the second auto-coding run when auto-coding 1 has not run yet', async () => {
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: false, v2: false, v3: false })
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks the second auto-coding run while v1 or manual coding freshness is open', async () => {
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: false })
    });
    const summaryQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        {
          version: 'v1',
          state: 'STALE',
          unitCount: '2',
          affectedResponseCount: '6'
        },
        {
          version: 'v2',
          state: 'MANUAL_REVIEW_REQUIRED',
          unitCount: '1',
          affectedResponseCount: '3'
        },
        {
          version: 'v3',
          state: 'STALE',
          unitCount: '4',
          affectedResponseCount: '8'
        }
      ])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 10 }]);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .rejects.toThrow('Auto-Coding 1');
  });

  it('blocks the second auto-coding run while manual coding jobs require review', async () => {
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: false })
    });
    const summaryQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);
    (connection.query as jest.Mock)
      .mockResolvedValueOnce([{ revision: 12 }])
      .mockResolvedValueOnce([{
        jobCount: '2',
        affectedUnits: '5',
        affectedResponses: '7'
      }]);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .rejects.toThrow('manuelle Kodierung');
  });

  it('allows the second auto-coding run when only v3 freshness is open', async () => {
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: true })
    });
    const summaryQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        {
          version: 'v3',
          state: 'STALE',
          unitCount: '4',
          affectedResponseCount: '8'
        }
      ])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 11 }]);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .resolves.toBeUndefined();
  });

  it('keeps changed uncoded units pending for the first auto-coding run', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 8 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '5' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: false, v2: false, v3: false })
    });
    const unitPresenceQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{
        unitId: 10,
        v1: false,
        v2: false,
        v3: false
      }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb);

    await service.markUnitsStaleAfterResultChange(1, [10], 'RESULT_UPDATED');

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        unit_id: 10,
        version: 'v1',
        state: 'PENDING',
        reason: 'RESULT_UPDATED',
        affected_response_count: 5,
        source_revision: 8
      })],
      ['workspace_id', 'unit_id', 'version']
    );
  });
});
