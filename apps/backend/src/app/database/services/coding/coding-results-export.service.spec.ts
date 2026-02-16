import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Response } from 'express';
import * as fastCsv from 'fast-csv';
import { WorkspaceCoreService } from '../workspace/workspace-core.service';
import { CodingResultsExportService } from './coding-results-export.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingJob } from '../../entities/coding-job.entity';
import { CodingJobVariable } from '../../entities/coding-job-variable.entity';
import { CodingJobUnit } from '../../entities/coding-job-unit.entity';
import { CodingListService } from './coding-list.service';

jest.mock('../../../utils/replay-url.util', () => ({
  generateReplayUrlFromRequest: jest
    .fn()
    .mockReturnValue('http://test.com/replay')
}));

jest.mock('../../../utils/coding-utils', () => ({
  calculateModalValue: jest
    .fn()
    .mockReturnValue({ modalValue: 1, deviationCount: 0 }),
  getLatestCode: jest.fn().mockReturnValue({ code: 1, score: 10 }),
  buildCoderMapping: jest.fn().mockReturnValue(new Map([['coder1', 'K1']])),
  buildCoderNameMapping: jest.fn().mockReturnValue(new Map([['coder1', 'K1']]))
}));

jest.mock('../../../utils/excel-utils', () => ({
  generateUniqueWorksheetName: jest
    .fn()
    .mockImplementation((wb, name) => name.substring(0, 31))
}));

describe('CodingResultsExportService', () => {
  let service: CodingResultsExportService;
  let mockResponseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let mockCodingJobRepository: jest.Mocked<Repository<CodingJob>>;
  let mockCodingJobVariableRepository: jest.Mocked<
  Repository<CodingJobVariable>
  >;
  let mockCodingJobUnitRepository: jest.Mocked<Repository<CodingJobUnit>>;
  let mockCodingListService: jest.Mocked<CodingListService>;
  let mockWorkspaceCoreService: jest.Mocked<WorkspaceCoreService>;

  const createMockResponse = (): jest.Mocked<Response> => ({
    setHeader: jest.fn(),
    write: jest.fn(),
    send: jest.fn()
  }) as unknown as jest.Mocked<Response>;

  beforeEach(async () => {
    mockResponseRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn()
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;

    mockCodingJobRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<CodingJob>>;

    mockCodingJobVariableRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<CodingJobVariable>>;

    mockCodingJobUnitRepository = {
      find: jest.fn()
    } as unknown as jest.Mocked<Repository<CodingJobUnit>>;

    mockCodingListService = {
      getCodingResultsByVersionCsvStream: jest.fn(),
      getCodingResultsByVersionAsExcel: jest
        .fn()
        .mockResolvedValue(Buffer.from('excel-data')),
      getVariablePageMap: jest.fn().mockResolvedValue(new Map([['var1', '1']])),
      getCodingListVariables: jest
        .fn()
        .mockResolvedValue([{ unitName: 'Unit1', variableId: 'var1' }])
    } as unknown as jest.Mocked<CodingListService>;

    mockWorkspaceCoreService = {
      getIgnoredUnits: jest.fn().mockResolvedValue([])
    } as unknown as jest.Mocked<WorkspaceCoreService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingResultsExportService,
        {
          provide: getRepositoryToken(ResponseEntity),
          useValue: mockResponseRepository
        },
        {
          provide: getRepositoryToken(CodingJob),
          useValue: mockCodingJobRepository
        },
        {
          provide: getRepositoryToken(CodingJobVariable),
          useValue: mockCodingJobVariableRepository
        },
        {
          provide: getRepositoryToken(CodingJobUnit),
          useValue: mockCodingJobUnitRepository
        },
        { provide: CodingListService, useValue: mockCodingListService },
        { provide: WorkspaceCoreService, useValue: mockWorkspaceCoreService }
      ]
    }).compile();

    service = module.get<CodingResultsExportService>(
      CodingResultsExportService
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    service.clearPageMapsCache();
  });

  describe('Cache Management', () => {
    it('should clear page maps cache', () => {
      service.clearPageMapsCache();
      // Access private properties via type assertion for testing
      expect(
        (service as unknown as { variablePageMapsCache: Map<string, unknown> })
          .variablePageMapsCache.size
      ).toBe(0);
      expect(
        (service as unknown as { currentWorkspaceId: number | null })
          .currentWorkspaceId
      ).toBeNull();
    });

    it('should cache variable page maps per workspace', async () => {
      mockCodingListService.getVariablePageMap.mockResolvedValue(
        new Map([['var1', '1']])
      );

      await service.getVariablePage('Unit1', 'var1', 1);
      await service.getVariablePage('Unit1', 'var1', 1);

      expect(mockCodingListService.getVariablePageMap).toHaveBeenCalledTimes(1);
    });

    it('should clear cache when workspace changes', async () => {
      mockCodingListService.getVariablePageMap.mockResolvedValue(
        new Map([['var1', '1']])
      );

      await service.getVariablePage('Unit1', 'var1', 1);
      await service.getVariablePage('Unit1', 'var1', 2);

      expect(mockCodingListService.getVariablePageMap).toHaveBeenCalledTimes(2);
    });
  });

  describe('CSV Export by Version', () => {
    it('should export CSV with correct headers', async () => {
      const mockCsvStream = {
        pipe: jest.fn().mockReturnValue({}),
        write: jest.fn().mockReturnValue(true),
        end: jest.fn()
      } as unknown as ReturnType<typeof fastCsv.format>;
      mockCodingListService.getCodingResultsByVersionCsvStream.mockResolvedValue(
        mockCsvStream
      );
      const res = createMockResponse();

      await service.exportCodingResultsByVersionAsCsv(
        1,
        'v1',
        'token',
        'http://test.com',
        false,
        res
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8'
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('coding-results-v1-')
      );
      expect(res.write).toHaveBeenCalledWith('\uFEFF');
    });
  });

  describe('Excel Export by Version', () => {
    it('should export Excel with correct headers', async () => {
      const res = createMockResponse();

      await service.exportCodingResultsByVersionAsExcel(
        1,
        'v1',
        'token',
        'http://test.com',
        false,
        res
      );

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
    });
  });

  describe('Aggregated Export - Most Frequent Method', () => {
    beforeEach(() => {
      const mockCodingJobUnits = [
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          notes: 'test note',
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            code_v1: 1,
            code_v2: null,
            code_v3: null,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        }
      ] as unknown as CodingJobUnit[];

      mockCodingJobUnitRepository.find.mockResolvedValue(mockCodingJobUnits);
    });

    it('should export aggregated results with most-frequent method', async () => {
      const result = await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        false,
        false,
        'most-frequent'
      );

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should throw error when no coding jobs found', async () => {
      mockCodingJobUnitRepository.find.mockResolvedValue([]);

      await expect(service.exportCodingResultsAggregated(1)).rejects.toThrow(
        'No coding jobs found'
      );
    });

    it('should filter by manual coding variables when excludeAutoCoded is true', async () => {
      await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        false,
        false,
        'most-frequent',
        false,
        false,
        '',
        undefined,
        true
      );

      expect(mockCodingListService.getCodingListVariables).toHaveBeenCalledWith(
        1
      );
    });
  });

  describe('Aggregated Export - New Row Per Variable Method', () => {
    beforeEach(() => {
      const mockCodingJobUnits = [
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          notes: 'test note',
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            code_v1: 1,
            score_v1: 10,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        }
      ] as unknown as CodingJobUnit[];

      mockCodingJobUnitRepository.find.mockResolvedValue(mockCodingJobUnits);
    });

    it('should export with new-row-per-variable method', async () => {
      const result = await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        false,
        false,
        'new-row-per-variable',
        false,
        false,
        '',
        undefined,
        false
      );

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should include modal value when requested', async () => {
      const { calculateModalValue } = jest.requireMock(
        '../../../utils/coding-utils'
      );

      await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        false,
        false,
        'new-row-per-variable',
        false,
        true,
        '',
        undefined,
        false
      );

      expect(calculateModalValue).toHaveBeenCalled();
    });
  });

  describe('Aggregated Export - New Column Per Coder Method', () => {
    beforeEach(() => {
      const mockCodingJobUnits = [
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            code_v1: 1,
            score_v1: 10,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        }
      ] as unknown as CodingJobUnit[];

      mockCodingJobUnitRepository.find.mockResolvedValue(mockCodingJobUnits);
    });

    it('should export with new-column-per-coder method', async () => {
      const result = await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        false,
        false,
        'new-column-per-coder',
        false,
        false,
        '',
        undefined,
        false
      );

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('Anonymization Logic', () => {
    beforeEach(() => {
      const { buildCoderMapping } = jest.requireMock(
        '../../../utils/coding-utils'
      );
      buildCoderMapping.mockReturnValue(new Map([['coder1', 'K1']]));

      const mockCodingJobUnits = [
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            code_v1: 1,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        }
      ] as unknown as CodingJobUnit[];

      mockCodingJobUnitRepository.find.mockResolvedValue(mockCodingJobUnits);
    });

    it('should anonymize coders when requested', async () => {
      const { buildCoderMapping } = jest.requireMock(
        '../../../utils/coding-utils'
      );

      await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        true,
        false,
        'new-row-per-variable'
      );

      expect(buildCoderMapping).toHaveBeenCalledWith(expect.any(Array), false);
    });

    it('should use pseudo coders when both anonymize and usePseudo are true', async () => {
      const { buildCoderMapping } = jest.requireMock(
        '../../../utils/coding-utils'
      );

      await service.exportCodingResultsAggregated(
        1,
        false,
        false,
        true,
        true,
        'new-row-per-variable'
      );

      expect(buildCoderMapping).toHaveBeenCalledWith(expect.any(Array), true);
    });
  });

  describe('Export by Coder', () => {
    beforeEach(() => {
      const mockCodingJobs = [
        {
          id: 1,
          workspace_id: 1,
          codingJobCoders: [{ user: { username: 'coder1', id: 1 } }],
          codingJobUnits: [
            {
              response: { unit: { id: 1 } },
              variable_id: 'var1'
            }
          ]
        }
      ] as unknown as CodingJob[];

      mockCodingJobRepository.find.mockResolvedValue(mockCodingJobs);
      mockCodingJobVariableRepository.find.mockResolvedValue([
        {
          id: 1,
          coding_job_id: 1,
          unit_name: 'Unit1',
          variable_id: 'var1'
        }
      ] as CodingJobVariable[]);

      mockResponseRepository.find.mockResolvedValue([
        {
          id: 1,
          variableid: 'var1',
          code_v1: 1,
          code_v2: null,
          code_v3: null,
          score_v1: 10,
          unit: {
            id: 1,
            name: 'Unit1',
            booklet: {
              id: 1,
              person: {
                login: 'user1',
                code: 'code1',
                group: 'group1',
                id: 1
              },
              bookletinfo: { name: 'Booklet1' }
            }
          }
        }
      ] as ResponseEntity[]);
    });

    it('should export results by coder', async () => {
      const result = await service.exportCodingResultsByCoder(1);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should throw error when no coding jobs found', async () => {
      mockCodingJobRepository.find.mockResolvedValue([]);

      await expect(service.exportCodingResultsByCoder(1)).rejects.toThrow(
        'No coding jobs found'
      );
    });
  });

  describe('Export by Variable', () => {
    beforeEach(() => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ unitName: 'Unit1', variableId: 'var1' }])
      };

      mockResponseRepository.createQueryBuilder = jest
        .fn()
        .mockReturnValue(mockQueryBuilder);

      mockCodingJobUnitRepository.find.mockResolvedValue([
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          notes: 'test',
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        }
      ] as CodingJobUnit[]);
    });

    it('should export results by variable', async () => {
      // Pass excludeAutoCoded=true so that filtering uses getCodingListVariables
      mockCodingListService.getCodingListVariables.mockResolvedValue([
        { unitName: 'Unit1', variableId: 'var1' }
      ]);

      const result = await service.exportCodingResultsByVariable(
        1,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        '',
        undefined,
        true
      );

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should limit worksheets to MAX_WORKSHEETS', async () => {
      process.env.EXPORT_MAX_WORKSHEETS = '2';
      const manyResults = Array(10).fill({
        unitName: 'Unit1',
        variableId: 'var1'
      });

      mockCodingListService.getCodingListVariables.mockResolvedValue(
        manyResults.map((r: { unitName: string; variableId: string }) => ({
          unitName: r.unitName,
          variableId: r.variableId
        }))
      );

      const mockQueryBuilder = mockResponseRepository.createQueryBuilder('');
      mockQueryBuilder.getRawMany = jest.fn().mockResolvedValue(manyResults);

      const result = await service.exportCodingResultsByVariable(
        1,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        '',
        undefined,
        true
      );

      expect(result).toBeInstanceOf(Buffer);
      delete process.env.EXPORT_MAX_WORKSHEETS;
    });
  });

  describe('Detailed Export', () => {
    beforeEach(() => {
      const mockCodingJobUnits = [
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          notes: 'test note',
          coding_issue_option: null,
          updated_at: new Date(),
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        }
      ] as unknown as CodingJobUnit[];

      mockCodingJobUnitRepository.find.mockResolvedValue(mockCodingJobUnits);
    });

    it('should export detailed results as CSV', async () => {
      const result = await service.exportCodingResultsDetailed(1);

      expect(result).toBeInstanceOf(Buffer);
      const csvContent = result.toString('utf-8');
      expect(csvContent).toContain('Person');
      expect(csvContent).toContain('Kodierer');
    });
  });

  describe('Cancellation Support', () => {
    it('should check for cancellation before processing', async () => {
      const checkCancellation = jest.fn().mockResolvedValue(undefined);

      mockCodingJobUnitRepository.find.mockResolvedValue([]);

      await expect(
        service.exportCodingResultsAggregated(
          1,
          false,
          false,
          false,
          false,
          'most-frequent',
          false,
          false,
          '',
          undefined,
          false,
          checkCancellation
        )
      ).rejects.toThrow();

      expect(checkCancellation).toHaveBeenCalled();
    });
  });

  describe('Ignored Units Filter', () => {
    it('should filter out ignored units', async () => {
      mockWorkspaceCoreService.getIgnoredUnits.mockResolvedValue(['Unit1']);

      const mockCodingJobUnits = [
        {
          id: 1,
          coding_job_id: 1,
          variable_id: 'var1',
          unit_name: 'Unit1',
          code: 1,
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 1,
            unit: {
              id: 1,
              name: 'Unit1',
              booklet: {
                id: 1,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user1', code: 'code1', group: 'group1' }
              }
            }
          }
        },
        {
          id: 2,
          coding_job_id: 1,
          variable_id: 'var2',
          unit_name: 'Unit2',
          code: 2,
          coding_job: {
            id: 1,
            workspace_id: 1,
            codingJobCoders: [{ user: { username: 'coder1', id: 1 } }]
          },
          response: {
            id: 2,
            unit: {
              id: 2,
              name: 'Unit2',
              booklet: {
                id: 2,
                bookletinfo: { name: 'Booklet1' },
                person: { login: 'user2', code: 'code2', group: 'group1' }
              }
            }
          }
        }
      ] as unknown as CodingJobUnit[];

      mockCodingJobUnitRepository.find.mockResolvedValue(mockCodingJobUnits);

      await service.exportCodingResultsAggregated(1);

      expect(mockWorkspaceCoreService.getIgnoredUnits).toHaveBeenCalledWith(1);
    });
  });
});
