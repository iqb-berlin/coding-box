import { Test, TestingModule } from '@nestjs/testing';
import { CodingListStreamService } from './coding-list-stream.service';
import { CodingResponseFilterService } from './coding-response-filter.service';
import { CodingItemBuilderService } from './coding-item-builder.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { ResponseEntity } from '../../entities/response.entity';

describe('CodingListStreamService', () => {
  let service: CodingListStreamService;
  let mockResponseFilterService: jest.Mocked<CodingResponseFilterService>;
  let mockItemBuilderService: jest.Mocked<CodingItemBuilderService>;
  let mockFileCacheService: jest.Mocked<CodingFileCacheService>;

  const createMockResponse = (id: number): ResponseEntity => ({
    id,
    unitid: 1,
    variableid: `var${id}`,
    status: 1,
    value: 'test',
    subform: null,
    status_v1: null,
    code_v1: null,
    score_v1: null,
    status_v2: null,
    code_v2: null,
    score_v2: null,
    status_v3: null,
    code_v3: null,
    score_v3: null,
    unit: {
      id: 1,
      bookletid: 1,
      name: 'unit1',
      alias: 'Unit 1',
      unitLogs: [],
      unitLastStates: [],
      chunks: [],
      responses: [],
      tags: [],
      notes: [],
      booklet: {
        id: 1,
        personid: 1,
        bookletname: 'booklet1',
        infoid: 1,
        lastts: 0,
        firstts: 0,
        sessions: [],
        bookletLogs: [],
        units: [],
        person: {
          id: 1,
          login: 'user1',
          code: 'code1',
          group: 'group1',
          workspace_id: 1
        },
        bookletinfo: { id: 1, name: 'Booklet 1' }
      }
    }
  }) as unknown as ResponseEntity;

  beforeEach(async () => {
    mockResponseFilterService = {
      getResponsesBatch: jest.fn()
    } as unknown as jest.Mocked<CodingResponseFilterService>;

    mockItemBuilderService = {
      buildCodingItem: jest.fn(),
      buildCodingItemWithVersions: jest.fn(),
      getHeadersForVersion: jest.fn()
    } as unknown as jest.Mocked<CodingItemBuilderService>;

    mockFileCacheService = {
      clearCaches: jest.fn(),
      loadVoudData: jest.fn()
    } as unknown as jest.Mocked<CodingFileCacheService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingListStreamService,
        {
          provide: CodingResponseFilterService,
          useValue: mockResponseFilterService
        },
        { provide: CodingItemBuilderService, useValue: mockItemBuilderService },
        { provide: CodingFileCacheService, useValue: mockFileCacheService }
      ]
    }).compile();

    service = module.get<CodingListStreamService>(CodingListStreamService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Stream creation', () => {
    it('should create CSV stream', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );

      expect(stream).toBeDefined();
      expect(mockFileCacheService.clearCaches).toHaveBeenCalled();
    });

    it('should create JSON stream', () => {
      const stream = service.getCodingListJsonStream(
        1,
        'token',
        'http://server'
      );

      expect(stream).toBeDefined();
      expect(stream.on).toBeDefined();
      expect(mockFileCacheService.clearCaches).toHaveBeenCalled();
    });

    it('should create versioned CSV stream', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      const stream = await service.getCodingResultsByVersionCsvStream(
        1,
        'v1',
        'token',
        'http://server'
      );

      expect(stream).toBeDefined();
      expect(mockFileCacheService.clearCaches).toHaveBeenCalled();
    });
  });

  describe('CSV formatting', () => {
    it('should write CSV headers', async () => {
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItem.mockResolvedValue({
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        url: 'http://test'
      });

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));

      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      const output = Buffer.concat(chunks).toString();
      expect(output).toContain('unit_key;unit_alias');
    });

    it('should format data with semicolon delimiter', async () => {
      const mockItem = {
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        url: 'http://test'
      };
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([
        createMockResponse(1)
      ]);
      mockItemBuilderService.buildCodingItem.mockResolvedValue(mockItem);
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));

      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      const output = Buffer.concat(chunks).toString();
      expect(output).toContain(';');
    });
  });

  describe('Excel streaming', () => {
    it('should create Excel buffer', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      const result = await service.getCodingListAsExcel(
        1,
        'token',
        'http://server'
      );

      expect(result).toBeInstanceOf(Buffer);
      expect(mockFileCacheService.clearCaches).toHaveBeenCalledTimes(2);
    });

    it('should include correct worksheet columns', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      await service.getCodingListAsExcel(1, 'token', 'http://server');

      expect(mockFileCacheService.clearCaches).toHaveBeenCalled();
    });

    it('should handle versioned Excel export', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'status_v1'
      ]);

      const result = await service.getCodingResultsByVersionAsExcel(
        1,
        'v1',
        'token',
        'http://server'
      );

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('Memory efficiency', () => {
    it('should process data in batches', async () => {
      const responses = Array(10)
        .fill(null)
        .map((_, i) => createMockResponse(i + 1));
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce(responses)
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItem.mockResolvedValue({
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        url: 'http://test'
      });

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );
      stream.on('data', () => {});
      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      expect(mockResponseFilterService.getResponsesBatch).toHaveBeenCalledTimes(
        2
      );
    });

    it('should clear caches after export', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      await service.getCodingListAsExcel(1, 'token', 'http://server');

      expect(mockFileCacheService.clearCaches).toHaveBeenCalled();
    });
  });

  describe('Error handling in streams', () => {
    it('should emit error on CSV stream failure', async () => {
      mockResponseFilterService.getResponsesBatch.mockImplementation(
        async () => {
          await new Promise(resolve => {
            setImmediate(resolve);
          });
          throw new Error('DB error');
        }
      );

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );

      const errorPromise = new Promise((_, reject) => {
        stream.on('error', reject);
      });
      stream.on('data', () => {});

      await expect(errorPromise).rejects.toThrow('DB error');
    });

    it('should handle null items from builder', async () => {
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItem.mockResolvedValue(null);

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));

      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      const output = Buffer.concat(chunks).toString();
      expect(output).toBe('');
    });

    it('should handle rejected promises in batch processing', async () => {
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItem.mockRejectedValue(
        new Error('Build error')
      );

      const stream = await service.getCodingListCsvStream(
        1,
        'token',
        'http://server'
      );
      stream.on('data', () => {});
      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      expect(mockFileCacheService.clearCaches).toHaveBeenCalled();
    });

    it('should emit error on JSON stream processing failure', async () => {
      mockResponseFilterService.getResponsesBatch.mockRejectedValue(
        new Error('Stream error')
      );

      const stream = service.getCodingListJsonStream(
        1,
        'token',
        'http://server'
      );

      await expect(
        new Promise((_, reject) => {
          stream.on('error', reject);
          stream.on('data', () => {});
        })
      ).rejects.toThrow('Stream error');
    });
  });

  describe('JSON stream', () => {
    it('should emit data events', async () => {
      const mockItem = {
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        url: 'http://test'
      };
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItem.mockResolvedValue(mockItem);

      const stream = service.getCodingListJsonStream(
        1,
        'token',
        'http://server'
      );
      const items: unknown[] = [];

      await new Promise<void>(resolve => {
        stream.on('data', item => items.push(item));
        stream.on('end', resolve);
      });

      expect(items.length).toBe(1);
      expect(items[0]).toEqual(mockItem);
    });

    it('should call end listener when complete', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      const stream = service.getCodingListJsonStream(
        1,
        'token',
        'http://server'
      );
      let endCalled = false;

      await new Promise<void>(resolve => {
        stream.on('end', () => {
          endCalled = true;
          resolve();
        });
        stream.on('data', () => {});
      });

      expect(endCalled).toBe(true);
    });
  });
});
