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
  leftJoin: jest.fn().mockReturnThis(),
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

  const mockCodingSchemeChangeQueries = (
    unitIds: number[],
    revision: number
  ): void => {
    (connection.query as jest.Mock).mockImplementation((sql: string) => {
      if (sql.includes('matching_unit_files')) {
        return Promise.resolve(unitIds.map(id => ({ id })));
      }
      if (sql.includes('workspace_test_results_revision')) {
        return Promise.resolve([{ revision }]);
      }
      return Promise.resolve([]);
    });
  };

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
    const autoCodingCandidateV1Qb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '2' }])
    });
    const autoCodingCandidateV3Qb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '2' }])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(autoCodingCandidateV1Qb)
      .mockReturnValueOnce(autoCodingCandidateV3Qb);

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

  it('closes auto-coding freshness as current when changed units have no auto-coding candidates', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 14 }]);

    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: false, v3: false })
    });
    const unitPresenceQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{
        unitId: 10,
        v1: true,
        v2: false,
        v3: false
      }])
    });
    const autoCodingCandidateQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb)
      .mockReturnValueOnce(autoCodingCandidateQb);

    await service.markUnitsStaleAfterResultChange(1, [10], 'RESULT_DELETED');

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        unit_id: 10,
        version: 'v1',
        state: 'CURRENT',
        reason: 'RESULT_DELETED',
        affected_response_count: 0,
        source_revision: 14,
        coded_revision: 14
      })],
      ['workspace_id', 'unit_id', 'version']
    );
    expect(responseRepository.createQueryBuilder).toHaveBeenCalledTimes(3);
  });

  it('marks coding scheme rule changes stale for auto-coding and manual review', async () => {
    mockCodingSchemeChangeQueries([10], 11);
    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '3' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: true })
    });
    const unitPresenceQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        {
          unitId: 10,
          v1: true,
          v2: false,
          v3: false
        }
      ])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb);

    await service.markUnitsStaleAfterCodingSchemeChange(1, {
      autoCodingSchemeRefs: ['SEPARATE_SCHEME']
    });

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('coding_scheme_ref_normalized'),
      [1, ['SEPARATE_SCHEME']]
    );
    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          unit_id: 10,
          version: 'v1',
          state: 'STALE',
          reason: 'CODING_SCHEME_CHANGED',
          affected_response_count: 3,
          source_revision: 11
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v3',
          state: 'PENDING',
          reason: 'CODING_SCHEME_CHANGED'
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v2',
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'CODING_SCHEME_CHANGED'
        })
      ]),
      ['workspace_id', 'unit_id', 'version']
    );
    expect((freshnessRepository.upsert as jest.Mock).mock.calls[0][0])
      .toHaveLength(3);
    expect(connection.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE coding_job cj'),
      [1, [10], 'stale_source', 'CODING_SCHEME_CHANGED']
    );
  });

  it('prefilters unit files by indexed normalized coding scheme refs', async () => {
    (connection.query as jest.Mock).mockResolvedValue([]);

    await (
      service as unknown as {
        getUnitIdsByCodingSchemeRefs: (
          workspaceId: number,
          codingSchemeRefs: string[]
        ) => Promise<number[]>;
      }
    ).getUnitIdsByCodingSchemeRefs(1, ['schemes\\separate_scheme.vocs']);

    const [sql, params] = (connection.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('matching_unit_files');
    expect(sql).toContain('unit_file.coding_scheme_ref_normalized = candidate.scheme_ref');
    expect(sql).toContain('unit_file.file_id_normalized IS NOT NULL');
    expect(sql).toContain('unit_refs AS');
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain('matched_unit_ids');
    expect(sql).toContain(
      "REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') = unit_refs.unit_ref"
    );
    expect(sql).toContain(
      "REGEXP_REPLACE(UPPER(COALESCE(unit.alias, '')), '\\.XML$', '', 'i') = unit_refs.unit_ref"
    );
    expect(sql).not.toContain('unit_candidates AS');
    expect(params).toEqual([1, ['SCHEMES\\SEPARATE_SCHEME', 'SEPARATE_SCHEME']]);
  });

  it('does not run the legacy regex fallback when all Unit files have normalized lookup state', async () => {
    (connection.query as jest.Mock)
      .mockResolvedValueOnce([{ id: 10 }])
      .mockResolvedValueOnce([{ hasLegacy: false }]);

    await expect((
      service as unknown as {
        getUnitIdsByCodingSchemeRefs: (
          workspaceId: number,
          codingSchemeRefs: string[]
        ) => Promise<number[]>;
      }
    ).getUnitIdsByCodingSchemeRefs(1, ['scheme_a'])).resolves.toEqual([10]);

    expect(connection.query).toHaveBeenCalledTimes(2);
    expect(
      (connection.query as jest.Mock).mock.calls
        .some(([sql]) => String(sql).includes('legacy_matching_unit_files'))
    ).toBe(false);
  });

  it('uses candidate-driven index probes for the legacy regex fallback', async () => {
    (connection.query as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ hasLegacy: true }])
      .mockResolvedValueOnce([{ id: 11 }]);

    await expect((
      service as unknown as {
        getUnitIdsByCodingSchemeRefs: (
          workspaceId: number,
          codingSchemeRefs: string[]
        ) => Promise<number[]>;
      }
    ).getUnitIdsByCodingSchemeRefs(1, ['scheme_a'])).resolves.toEqual([11]);

    expect(connection.query).toHaveBeenCalledTimes(3);
    const [sql, params] = (connection.query as jest.Mock).mock.calls[2];
    expect(sql).toContain('legacy_matching_unit_files');
    expect(sql).toContain('CROSS JOIN LATERAL');
    expect(sql).toContain(
      "REGEXP_REPLACE(UPPER(unit.name), '\\.XML$', '', 'i') ="
    );
    expect(sql).toContain('legacy_matching_unit_files.unit_ref');
    expect(sql).not.toContain('unit_candidates AS');
    expect(params).toEqual([1, ['SCHEME_A']]);
  });

  it('marks coding scheme instruction-only changes for manual review only', async () => {
    mockCodingSchemeChangeQueries([10], 12);
    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '3' }])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: false, v3: false })
    });
    const unitPresenceQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        {
          unitId: 10,
          v1: true,
          v2: false,
          v3: false
        }
      ])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb);

    await service.markUnitsStaleAfterCodingSchemeChange(1, {
      manualCodingSchemeRefs: ['UNIT_A']
    });

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          unit_id: 10,
          version: 'v2',
          state: 'MANUAL_REVIEW_REQUIRED',
          reason: 'CODING_SCHEME_CHANGED',
          affected_response_count: 3,
          source_revision: 12
        })
      ],
      ['workspace_id', 'unit_id', 'version']
    );
    expect(connection.query).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE coding_job cj'),
      [1, [10], 'review_required', 'CODING_SCHEME_CHANGED']
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

  it('batches reset freshness count queries and upserts for large reset scopes', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 9 }]);

    const unitIds = Array.from({ length: 1201 }, (_, index) => index + 1);
    const firstResponseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 1, count: '2' }])
    });
    const secondResponseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 1001, count: '3' }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(firstResponseCountsQb)
      .mockReturnValueOnce(secondResponseCountsQb);

    await service.markVersionsPendingAfterReset(1, {
      v3: unitIds
    });

    expect(responseRepository.createQueryBuilder).toHaveBeenCalledTimes(2);
    expect(firstResponseCountsQb.andWhere).toHaveBeenCalledWith(
      'response.unitid IN (:...unitIds)',
      { unitIds: unitIds.slice(0, 1000) }
    );
    expect(secondResponseCountsQb.andWhere).toHaveBeenCalledWith(
      'response.unitid IN (:...unitIds)',
      { unitIds: unitIds.slice(1000) }
    );
    expect(freshnessRepository.upsert).toHaveBeenCalledTimes(5);
    (freshnessRepository.upsert as jest.Mock).mock.calls.forEach(([rows]) => {
      expect(rows.length).toBeLessThanOrEqual(250);
    });
  });

  it('reopens existing auto-coding freshness rows in the reset response scope', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 9 }]);

    const scopeQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        { unitId: 10, version: 'v1' },
        { unitId: 10, version: 'v3' }
      ])
    });
    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '4' }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(scopeQb)
      .mockReturnValueOnce(responseCountsQb);

    await service.markExistingAutoCodingVersionsPendingAfterResetScope(
      1,
      ['v1', 'v2', 'v3'],
      ['UNIT_A'],
      ['VAR_A']
    );

    expect(scopeQb.andWhere).toHaveBeenCalledWith(
      'unit.name IN (:...unitNames)',
      { unitNames: ['UNIT_A'] }
    );
    expect(scopeQb.andWhere).toHaveBeenCalledWith(
      'response.variableid IN (:...variableIds)',
      { variableIds: ['VAR_A'] }
    );
    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          unit_id: 10,
          version: 'v1',
          state: 'PENDING',
          reason: 'RESET',
          affected_response_count: 4,
          source_revision: 9,
          coded_revision: null
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v3',
          state: 'PENDING',
          reason: 'RESET',
          affected_response_count: 4
        })
      ]),
      ['workspace_id', 'unit_id', 'version']
    );
    expect((freshnessRepository.upsert as jest.Mock).mock.calls[0][0]).toHaveLength(2);
  });

  it('marks only v1 reset units as stale source for manual jobs', async () => {
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
      [1, [10], 'stale_source', 'RESET']
    ]);
  });

  it('does not mark v2 reset units as stale source for manual jobs', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 9 }]);

    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '2' }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(responseCountsQb);

    await service.markVersionsPendingAfterReset(1, {
      v2: [10]
    });

    expect(connection.query).not.toHaveBeenCalledWith(
      expect.stringContaining('resp.unitid = ANY($2::int[])'),
      [1, [10], 'stale_source', 'RESET']
    );
  });

  it('marks manual coding jobs stale-source by response ids before source deletion', async () => {
    await service.markCodingJobsStaleForResponseIds(1, [100, 100, 0], 'RESULT_DELETED');

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('cju.response_id = ANY($2::int[])'),
      [1, [100], 'stale_source', 'RESULT_DELETED']
    );
  });

  it('marks manual coding jobs stale-source by unit ids after source changes', async () => {
    await service.markCodingJobsStaleForUnitIds(1, [10, 10, -1], 'RESULT_UPDATED');

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('resp.unitid = ANY($2::int[])'),
      [1, [10], 'stale_source', 'RESULT_UPDATED']
    );
  });

  it('moves applied jobs back to completed when cleared manual results can be reapplied', async () => {
    await service.markAppliedCodingJobsResultsClearedForUnitIds(
      1,
      [10, 10, -1],
      'RESET',
      'current'
    );

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      [1, [10], 'current', 'RESET']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("cj.status = 'results_applied'"),
      [1, [10], 'current', 'RESET']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('resp.unitid = ANY($2::int[])'),
      [1, [10], 'current', 'RESET']
    );
  });

  it('moves applied jobs back to completed and stale-source when source responses are recoded', async () => {
    await service.markAppliedCodingJobsResultsClearedForResponseIds(
      1,
      [100, 100, 0],
      'AUTOCODE_RUN',
      'stale_source'
    );

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      [1, [100], 'stale_source', 'AUTOCODE_RUN']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('cju.response_id = ANY($2::int[])'),
      [1, [100], 'stale_source', 'AUTOCODE_RUN']
    );
  });

  it('reconciles applied manual jobs whose v2 response results are missing', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ id: 7 }, { id: 8 }]);

    await expect(service.reconcileAppliedManualCodingJobs(
      1,
      'RESET',
      'current'
    )).resolves.toBe(2);

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("cj.status = 'results_applied'"),
      [1, 'current', 'RESET']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('resp.status_v2 IS NULL'),
      [1, 'current', 'RESET']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'completed'"),
      [1, 'current', 'RESET']
    );
  });

  it('scopes applied manual job reconciliation by unit and variable filters', async () => {
    await service.reconcileAppliedManualCodingJobs(
      1,
      'RESET',
      'stale_source',
      {
        unitNames: ['UNIT_A', 'UNIT_A', ''],
        variableIds: ['VAR_1']
      }
    );

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('cju.unit_name = ANY($4::text[])'),
      [1, 'stale_source', 'RESET', ['UNIT_A'], ['VAR_1']]
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('cju.variable_id = ANY($5::text[])'),
      [1, 'stale_source', 'RESET', ['UNIT_A'], ['VAR_1']]
    );
  });

  it('marks manual coding freshness current after applying a coding job', async () => {
    (connection.query as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ revision: 13 }])
      .mockResolvedValueOnce({});

    const unitIdsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: '20' }])
    });
    const responseCountsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: '20', count: '2' }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(unitIdsQb)
      .mockReturnValueOnce(responseCountsQb);

    await service.markManualCodingCurrent(1, [99, 99], { codingJobId: 10 });

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        workspace_id: 1,
        unit_id: 20,
        version: 'v2',
        state: 'CURRENT',
        reason: 'MANUAL_CODING_APPLIED',
        affected_response_count: 2,
        source_revision: 13,
        coded_revision: 13
      })],
      ['workspace_id', 'unit_id', 'version']
    );
    expect(connection.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("cj.freshness_status IN ('review_required', 'stale_source')"),
      [1, [20], [10]]
    );
    expect(connection.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("COALESCE(freshness_status, 'current') <> 'stale_source'"),
      [1, [10]]
    );
  });

  it('does not clear stale-source coding jobs when finalizing manual freshness', async () => {
    await service.markManualCodingCurrent(1, [], { codingJobId: 10 });

    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining("COALESCE(freshness_status, 'current') <> 'stale_source'"),
      [1, [10]]
    );
  });

  it('does not clear unit freshness while another manual coding job still requires review or source refresh', async () => {
    (connection.query as jest.Mock)
      .mockResolvedValueOnce([{ unitId: '20' }])
      .mockResolvedValueOnce({});

    const unitIdsQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: '20' }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(unitIdsQb);

    await service.markManualCodingCurrent(1, [99], { codingJobId: 10 });

    expect(freshnessRepository.upsert).not.toHaveBeenCalled();
    expect(connection.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("cj.freshness_status IN ('review_required', 'stale_source')"),
      [1, [20], [10]]
    );
    expect(connection.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("SET freshness_status = 'current'"),
      [1, [10]]
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

  it('marks existing manual jobs matching newly imported variables as stale-source', async () => {
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
      [1, [10], 'stale_source', 'RESULT_ADDED']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'UPPER(coding_job_variable.unit_name) = UPPER(added_responses.unit_name)'
      ),
      [1, [10], 'stale_source', 'RESULT_ADDED']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'FROM jsonb_array_elements(variable_bundle.variables) bundle_variable'
      ),
      [1, [10], 'stale_source', 'RESULT_ADDED']
    );
  });

  it('marks newly imported responses in existing units as RESULT_ADDED', async () => {
    (connection.query as jest.Mock)
      .mockResolvedValueOnce([{ revision: 9 }])
      .mockResolvedValueOnce({});

    const importedResponsesQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([
        { responseId: '100', unitId: '10' },
        { responseId: '101', unitId: '10' },
        { responseId: '102', unitId: '20' }
      ])
    });
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: false, v3: true })
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(importedResponsesQb)
      .mockReturnValueOnce(workspacePresenceQb);

    await service.markResponsesPendingAfterImport(1, [100, 101, 102, 100, -1]);

    expect(freshnessRepository.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          unit_id: 10,
          version: 'v1',
          state: 'PENDING',
          reason: 'RESULT_ADDED',
          affected_response_count: 2,
          source_revision: 9
        }),
        expect.objectContaining({
          unit_id: 10,
          version: 'v3',
          state: 'PENDING',
          reason: 'RESULT_ADDED',
          affected_response_count: 2,
          source_revision: 9
        }),
        expect.objectContaining({
          unit_id: 20,
          version: 'v1',
          state: 'PENDING',
          reason: 'RESULT_ADDED',
          affected_response_count: 1,
          source_revision: 9
        })
      ]),
      ['workspace_id', 'unit_id', 'version']
    );
    expect((freshnessRepository.upsert as jest.Mock).mock.calls[0][0]).toHaveLength(4);
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining('response.id = ANY($2::int[])'),
      [1, [100, 101, 102], 'stale_source', 'RESULT_ADDED']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'UPPER(coding_job_variable.unit_name) = UPPER(added_responses.unit_name)'
      ),
      [1, [100, 101, 102], 'stale_source', 'RESULT_ADDED']
    );
    expect(connection.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "UPPER(bundle_variable ->> 'unitName') = UPPER(added_responses.unit_name)"
      ),
      [1, [100, 101, 102], 'stale_source', 'RESULT_ADDED']
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
    const openManualCodingQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({
        affectedUnits: '0',
        affectedResponses: '0'
      })
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(openManualCodingQb);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 10 }]);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .rejects.toThrow('Auto-Coding 1');
  });

  it('blocks the second auto-coding run while manual coding jobs require review or stale refresh', async () => {
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: false })
    });
    const summaryQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([])
    });
    const openManualCodingQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({
        affectedUnits: '0',
        affectedResponses: '0'
      })
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(openManualCodingQb);
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

    expect(connection.query).toHaveBeenLastCalledWith(
      expect.stringContaining("cj.freshness_status IN ('review_required', 'stale_source')"),
      [1]
    );
  });

  it('blocks the second auto-coding run while manual coding results are not fully applied', async () => {
    const workspacePresenceQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({ v1: true, v2: true, v3: false })
    });
    const openManualCodingQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({
        affectedUnits: '3',
        affectedResponses: '9'
      })
    });
    const summaryQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([])
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(openManualCodingQb);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 12 }]);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .rejects.toThrow('manuelle Kodierung');

    expect(openManualCodingQb.leftJoin).toHaveBeenCalledWith('booklet.bookletinfo', 'bookletinfo');
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
    const openManualCodingQb = queryBuilder({
      getRawOne: jest.fn().mockResolvedValue({
        affectedUnits: '0',
        affectedResponses: '0'
      })
    });

    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(openManualCodingQb);
    (freshnessRepository.createQueryBuilder as jest.Mock).mockReturnValue(summaryQb);
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 11 }]);

    await expect(service.assertAutoCodingRunCanStart(1, 2))
      .resolves.toBeUndefined();
  });

  it('keeps changed uncoded units pending for the first auto-coding run', async () => {
    (connection.query as jest.Mock).mockResolvedValue([{ revision: 8 }]);

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
    const autoCodingCandidateQb = queryBuilder({
      getRawMany: jest.fn().mockResolvedValue([{ unitId: 10, count: '5' }])
    });
    (responseRepository.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(workspacePresenceQb)
      .mockReturnValueOnce(unitPresenceQb)
      .mockReturnValueOnce(autoCodingCandidateQb);

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
