import { Repository } from 'typeorm';
import { CodingResponseFilterService } from './coding-response-filter.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingFileCacheService } from './coding-file-cache.service';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { STATISTICS_IGNORED_STATUSES } from '../../utils/response-status-converter';

function createQueryBuilderMock() {
  const queryBuilder: Record<string, jest.Mock> = {};
  queryBuilder.leftJoinAndSelect = jest.fn(() => queryBuilder);
  queryBuilder.where = jest.fn(() => queryBuilder);
  queryBuilder.andWhere = jest.fn(() => queryBuilder);
  queryBuilder.orderBy = jest.fn(() => queryBuilder);
  queryBuilder.take = jest.fn(() => queryBuilder);
  queryBuilder.getCount = jest.fn().mockResolvedValue(0);
  queryBuilder.getMany = jest.fn().mockResolvedValue([]);
  return queryBuilder;
}

function createService() {
  const queryBuilder = createQueryBuilderMock();
  const responseRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder)
  } as unknown as jest.Mocked<Repository<ResponseEntity>>;
  const workspaceExclusionService = {
    resolveExclusionsForQueries: jest.fn().mockResolvedValue({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    })
  } as unknown as jest.Mocked<WorkspaceExclusionService>;
  const workspaceFilesService = {
    getUnitVariableMap: jest.fn().mockResolvedValue(new Map([
      ['Unit1', new Set(['var1'])]
    ]))
  } as unknown as jest.Mocked<WorkspaceFilesService>;

  const service = new CodingResponseFilterService(
    responseRepository,
    {} as CodingFileCacheService,
    {} as WorkspaceCoreService,
    workspaceExclusionService,
    workspaceFilesService
  );

  return {
    service,
    queryBuilder
  };
}

describe('CodingResponseFilterService', () => {
  it('uses the effective v2 coding status when filtering versioned exports', async () => {
    const { service, queryBuilder } = createService();

    await service.countResponses(1, {
      version: 'v2',
      validCodingVariablesOnly: true,
      givenResponsesOnly: true
    });

    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('response.status_v2 = 8')
    );
    expect(queryBuilder.where).toHaveBeenCalledWith(
      expect.stringContaining('IS NOT NULL')
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT IN (:...statisticsIgnoredStatuses)'),
      { statisticsIgnoredStatuses: STATISTICS_IGNORED_STATUSES }
    );
  });

  it('uses the same v3 generated-row expression as coding statistics', async () => {
    const { service, queryBuilder } = createService();

    await service.countResponses(1, {
      version: 'v3',
      validCodingVariablesOnly: true,
      givenResponsesOnly: true
    });

    const whereCondition = queryBuilder.where.mock.calls[0][0] as string;
    const ignoredStatusCondition = queryBuilder.andWhere.mock.calls.find(
      ([condition]) => String(condition).includes('statisticsIgnoredStatuses')
    )?.[0] as string;

    expect(whereCondition).not.toContain("response.status_v3 ~ '^-?[0-9]+$'");
    expect(whereCondition).not.toContain('response.status_v3::smallint');
    expect(whereCondition).toContain('COALESCE(response.status_v3');
    expect(whereCondition).toContain('response.status_v2 = 8');
    expect(whereCondition).toContain('response.status_v2, response.status_v1');
    expect(ignoredStatusCondition).not.toContain("response.status_v3 ~ '^-?[0-9]+$'");
    expect(ignoredStatusCondition).toContain('COALESCE(response.status_v3');
    expect(ignoredStatusCondition).toContain('NOT IN (:...statisticsIgnoredStatuses)');
  });

  it('requires valid coding variable pairs for generated responses as well', async () => {
    const { service, queryBuilder } = createService();

    await service.countResponses(1, {
      version: 'v1',
      validCodingVariablesOnly: true
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'CONCAT(unit.name, CHR(31), response.variableid) IN (:...validVariablePairKeys)',
      { validVariablePairKeys: ['Unit1\u001Fvar1'] }
    );
    expect(
      queryBuilder.andWhere.mock.calls.some(([condition]) => String(condition).includes('OR response.is_autocoder_generated'))
    ).toBe(false);
  });

  it('keeps DERIVE_ERROR out of default manual coding candidate filters', async () => {
    const { service, queryBuilder } = createService();

    await service.countResponses(1, {
      manualCodingCandidatesOnly: true
    });

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'response.status_v1 IN (:...statuses)',
      {
        statuses: [
          8,
          12
        ]
      }
    );
  });
});
