import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AdmZip = require('adm-zip');
import { CodingListStreamService } from './coding-list-stream.service';
import { CodingResponseFilterService } from './coding-response-filter.service';
import { CodingItemBuilderService } from './coding-item-builder.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';

jest.mock('libxmljs2', () => ({}));

describe('CodingListStreamService', () => {
  let service: CodingListStreamService;
  let mockResponseFilterService: jest.Mocked<CodingResponseFilterService>;
  let mockItemBuilderService: jest.Mocked<CodingItemBuilderService>;
  let mockFileCacheService: jest.Mocked<CodingFileCacheService>;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockReplayAnchorService: jest.Mocked<CodingReplayAnchorService>;

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
      getResponsesBatch: jest.fn(),
      countResponses: jest.fn().mockResolvedValue(0)
    } as unknown as jest.Mocked<CodingResponseFilterService>;

    mockItemBuilderService = {
      buildCodingItem: jest.fn(),
      buildCodingItemWithVersions: jest.fn(),
      getHeadersForVersion: jest.fn().mockReturnValue([
        'unit_key',
        'unit_alias',
        'person_login',
        'person_code',
        'person_group',
        'booklet_name',
        'variable_id',
        'variable_page',
        'variable_anchor',
        'value',
        'status_v1',
        'code_v1',
        'score_v1'
      ])
    } as unknown as jest.Mocked<CodingItemBuilderService>;

    mockFileCacheService = {
      clearCaches: jest.fn(),
      loadVoudData: jest.fn()
    } as unknown as jest.Mocked<CodingFileCacheService>;

    mockConfigService = {
      get: jest.fn().mockReturnValue(undefined)
    } as unknown as jest.Mocked<ConfigService>;

    mockReplayAnchorService = {
      getVariableAnchorMaps: jest.fn().mockResolvedValue(new Map())
    } as unknown as jest.Mocked<CodingReplayAnchorService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CodingListStreamService,
        {
          provide: CodingResponseFilterService,
          useValue: mockResponseFilterService
        },
        { provide: CodingItemBuilderService, useValue: mockItemBuilderService },
        { provide: CodingFileCacheService, useValue: mockFileCacheService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CodingReplayAnchorService, useValue: mockReplayAnchorService },
        {
          provide: WorkspaceFilesService,
          useValue: {
            getCoderTrainingRequiredVariableMap: jest.fn().mockResolvedValue(new Map())
          }
        }
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

    it('should emit cancellation before reading versioned CSV batches', async () => {
      const cancellationError = new Error('cancelled');
      const checkCancellation = jest.fn(async () => {
        await new Promise(resolve => {
          setImmediate(resolve);
        });
        throw cancellationError;
      });

      const stream = await service.getCodingResultsByVersionCsvStream(
        1,
        'v1',
        'token',
        'http://server',
        false,
        undefined,
        true,
        false,
        checkCancellation
      );

      await expect(new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      })).rejects.toThrow('cancelled');

      expect(mockResponseFilterService.countResponses).not.toHaveBeenCalled();
      expect(mockResponseFilterService.getResponsesBatch).not.toHaveBeenCalled();
    });

    it('should write headers for empty versioned CSV exports', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);

      const stream = await service.getCodingResultsByVersionCsvStream(
        1,
        'v1',
        'token',
        'http://server'
      );
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      expect(Buffer.concat(chunks).toString()).toBe([
        'unit_key',
        'unit_alias',
        'person_login',
        'person_code',
        'person_group',
        'booklet_name',
        'variable_id',
        'variable_page',
        'variable_anchor',
        'value',
        'status_v1',
        'code_v1',
        'score_v1'
      ].join(';'));
      expect(mockItemBuilderService.getHeadersForVersion).toHaveBeenCalledWith('v1', true);
    });

    it('should include replay URL column in versioned CSV exports when requested', async () => {
      const response = createMockResponse(1);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([response])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItemWithVersions.mockResolvedValue({
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        value: 'answer',
        status_v1: 'VALUE_CHANGED',
        code_v1: '',
        score_v1: '',
        url: 'http://server/#/replay/user1@code1@group1@booklet1/unit1/1/var1?auth=token'
      } as never);

      const stream = await service.getCodingResultsByVersionCsvStream(
        1,
        'v1',
        'token',
        'http://server',
        true
      );
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      const [header, row] = Buffer.concat(chunks).toString().split('\n');

      expect(header.split(';')).toContain('url');
      expect(row).toContain(
        'http://server/#/replay/user1@code1@group1@booklet1/unit1/1/var1?auth=token'
      );
      expect(mockItemBuilderService.buildCodingItemWithVersions).toHaveBeenCalledWith(
        response,
        'v1',
        'token',
        'http://server',
        1,
        true,
        true,
        false,
        expect.any(Map)
      );
    });

    it('should pass response value option to versioned CSV item builder', async () => {
      const response = createMockResponse(1);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([response])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.buildCodingItemWithVersions.mockResolvedValue({
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        status_v1: 'VALUE_CHANGED',
        code_v1: '',
        score_v1: ''
      } as never);

      const stream = await service.getCodingResultsByVersionCsvStream(
        1,
        'v1',
        'token',
        'http://server',
        false,
        undefined,
        false
      );
      stream.on('data', () => {});
      await new Promise(resolve => {
        stream.on('end', resolve);
      });

      const versionExportOptions = {
        version: 'v1',
        validCodingVariablesOnly: true,
        givenResponsesOnly: true
      };
      expect(mockResponseFilterService.countResponses).toHaveBeenCalledWith(1, versionExportOptions);
      expect(mockResponseFilterService.getResponsesBatch).toHaveBeenCalledWith(
        1,
        0,
        500,
        versionExportOptions
      );
      expect(mockItemBuilderService.buildCodingItemWithVersions).toHaveBeenCalledWith(
        response,
        'v1',
        'token',
        'http://server',
        1,
        false,
        false,
        false,
        expect.any(Map)
      );
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

    it('should write versioned Excel exports directly to a file', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-export-'));
      const filePath = path.join(tempDir, 'results.xlsx');
      const response = createMockResponse(1);
      mockResponseFilterService.countResponses.mockResolvedValueOnce(1);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([response])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'status_v1'
      ]);
      mockItemBuilderService.buildCodingItemWithVersions.mockResolvedValue({
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'var1',
        value: 'answer',
        status_v1: 'VALUE_CHANGED'
      });

      try {
        await service.writeCodingResultsByVersionExcelToFile(
          filePath,
          1,
          'v1',
          'token',
          'http://server'
        );

        expect(fs.statSync(filePath).size).toBeGreaterThan(0);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);
        const worksheet = workbook.getWorksheet('Coding Results');
        expect(worksheet?.getRow(2).getCell(1).value).toBe('unit1');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should pass response value option to versioned Excel headers', async () => {
      mockResponseFilterService.getResponsesBatch.mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'status_v1'
      ]);

      await service.getCodingResultsByVersionAsExcel(
        1,
        'v1',
        'token',
        'http://server',
        false,
        undefined,
        false
      );

      expect(mockItemBuilderService.getHeadersForVersion).toHaveBeenCalledWith('v1', false);
      expect(mockResponseFilterService.countResponses).toHaveBeenCalledWith(1, {
        version: 'v1',
        validCodingVariablesOnly: true,
        givenResponsesOnly: true
      });
    });

    it('should export GeoGebra values as linked .ggb files in a ZIP package', async () => {
      const geoGebraResponse = createMockResponse(1);
      const plainResponse = createMockResponse(2);
      mockResponseFilterService.countResponses.mockResolvedValue(2);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([geoGebraResponse, plainResponse])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'unit_alias',
        'person_login',
        'person_code',
        'person_group',
        'booklet_name',
        'variable_id',
        'variable_page',
        'variable_anchor',
        'value',
        'status_v1',
        'code_v1',
        'score_v1'
      ]);
      mockItemBuilderService.buildCodingItemWithVersions
        .mockResolvedValueOnce({
          unit_key: 'Unit/1',
          unit_alias: 'Unit 1',
          person_login: 'login',
          person_code: 'code',
          person_group: 'group',
          booklet_name: 'Booklet',
          variable_id: 'Geo:Var',
          variable_page: '1',
          variable_anchor: 'Geo:Var',
          value: 'UEsDBA==',
          status_v1: 'VALUE_CHANGED',
          code_v1: '',
          score_v1: ''
        } as never)
        .mockResolvedValueOnce({
          unit_key: 'Unit 1',
          unit_alias: 'Unit 1',
          person_login: 'login',
          person_code: 'code',
          person_group: 'group',
          booklet_name: 'Booklet',
          variable_id: 'Plain',
          variable_page: '1',
          variable_anchor: 'Plain',
          value: 'plain answer',
          status_v1: 'VALUE_CHANGED',
          code_v1: '',
          score_v1: ''
        } as never);

      const result = await service.getCodingResultsByVersionAsGeoGebraZip(
        1,
        'v1',
        'token',
        'http://server'
      );

      const zip = new AdmZip(result);
      const entries = zip.getEntries().map(entry => entry.entryName);
      expect(entries).toContain('coding-results-v1.xlsx');
      expect(entries).toContain('geogebra/login__code__Booklet__Unit_1__Geo_Var__response-1.ggb');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(zip.readFile('coding-results-v1.xlsx')!);
      const worksheet = workbook.getWorksheet('Coding Results')!;
      expect(worksheet.getCell('J2').value).toEqual(expect.objectContaining({
        text: 'login__code__Booklet__Unit_1__Geo_Var__response-1.ggb',
        hyperlink: 'geogebra/login__code__Booklet__Unit_1__Geo_Var__response-1.ggb'
      }));
      expect(worksheet.getCell('J3').value).toBe('plain answer');
    });

    it('should write GeoGebra ZIP exports directly to a file', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geogebra-export-'));
      const filePath = path.join(tempDir, 'geogebra.zip');
      mockResponseFilterService.countResponses.mockResolvedValue(1);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'unit_alias',
        'person_login',
        'person_code',
        'person_group',
        'booklet_name',
        'variable_id',
        'variable_page',
        'variable_anchor',
        'value',
        'status_v1',
        'code_v1',
        'score_v1'
      ]);
      mockItemBuilderService.buildCodingItemWithVersions.mockResolvedValue({
        unit_key: 'Unit/1',
        unit_alias: 'Unit 1',
        person_login: 'login',
        person_code: 'code',
        person_group: 'group',
        booklet_name: 'Booklet',
        variable_id: 'Geo:Var',
        variable_page: '1',
        variable_anchor: 'Geo:Var',
        value: 'UEsDBA==',
        status_v1: 'VALUE_CHANGED',
        code_v1: '',
        score_v1: ''
      } as never);

      try {
        await service.writeCodingResultsByVersionGeoGebraZipToFile(
          filePath,
          1,
          'v1',
          'token',
          'http://server'
        );

        expect(fs.statSync(filePath).size).toBeGreaterThan(0);
        const zip = new AdmZip(filePath);
        const entries = zip.getEntries().map(entry => entry.entryName);
        expect(entries).toContain('coding-results-v1.xlsx');
        expect(entries).toContain('geogebra/login__code__Booklet__Unit_1__Geo_Var__response-1.ggb');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should abort GeoGebra ZIP export when configured file count limit is exceeded', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'GEOGEBRA_EXPORT_MAX_FILES') return '1';
        return undefined;
      });
      mockResponseFilterService.countResponses.mockResolvedValue(2);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1), createMockResponse(2)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'person_login',
        'person_code',
        'booklet_name',
        'variable_id',
        'value'
      ]);
      mockItemBuilderService.buildCodingItemWithVersions
        .mockResolvedValueOnce({
          unit_key: 'Unit 1',
          person_login: 'login',
          person_code: 'code',
          booklet_name: 'Booklet',
          variable_id: 'Geo 1',
          value: 'UEsDBA=='
        } as never)
        .mockResolvedValueOnce({
          unit_key: 'Unit 1',
          person_login: 'login',
          person_code: 'code',
          booklet_name: 'Booklet',
          variable_id: 'Geo 2',
          value: 'UEsDBA=='
        } as never);

      await expect(service.getCodingResultsByVersionAsGeoGebraZip(
        1,
        'v1',
        'token',
        'http://server'
      )).rejects.toThrow(
        'GeoGebra-ZIP-Export abgebrochen: 2 GeoGebra-Dateien überschreiten das Limit von 1.'
      );
    });

    it('should abort GeoGebra ZIP export when configured byte limit is exceeded', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'GEOGEBRA_EXPORT_MAX_BYTES') return '3';
        return undefined;
      });
      mockResponseFilterService.countResponses.mockResolvedValue(1);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce([createMockResponse(1)])
        .mockResolvedValueOnce([]);
      mockItemBuilderService.getHeadersForVersion.mockReturnValue([
        'unit_key',
        'person_login',
        'person_code',
        'booklet_name',
        'variable_id',
        'value'
      ]);
      mockItemBuilderService.buildCodingItemWithVersions.mockResolvedValue({
        unit_key: 'Unit 1',
        person_login: 'login',
        person_code: 'code',
        booklet_name: 'Booklet',
        variable_id: 'Geo 1',
        value: 'UEsDBA=='
      } as never);

      await expect(service.getCodingResultsByVersionAsGeoGebraZip(
        1,
        'v1',
        'token',
        'http://server'
      )).rejects.toThrow(
        'GeoGebra-ZIP-Export abgebrochen: 4 Bytes GeoGebra-Daten überschreiten das Limit von 3 Bytes.'
      );
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

    it('should load replay anchor maps once per batch and pass them to item builder', async () => {
      const responses = [createMockResponse(1), createMockResponse(2)];
      const variableAnchorMaps = new Map([
        ['unit1', new Map([['var1', 'anchor1']])]
      ]);
      mockResponseFilterService.getResponsesBatch
        .mockResolvedValueOnce(responses)
        .mockResolvedValueOnce([]);
      mockReplayAnchorService.getVariableAnchorMaps.mockResolvedValueOnce(variableAnchorMaps);
      mockItemBuilderService.buildCodingItem.mockResolvedValue({
        unit_key: 'unit1',
        unit_alias: 'Unit 1',
        person_login: 'user1',
        person_code: 'code1',
        person_group: 'group1',
        booklet_name: 'booklet1',
        variable_id: 'var1',
        variable_page: '1',
        variable_anchor: 'anchor1',
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

      expect(mockReplayAnchorService.getVariableAnchorMaps).toHaveBeenCalledTimes(1);
      expect(mockReplayAnchorService.getVariableAnchorMaps).toHaveBeenCalledWith(
        ['unit1'],
        1
      );
      expect(mockItemBuilderService.buildCodingItem).toHaveBeenNthCalledWith(
        1,
        responses[0],
        'token',
        'http://server',
        1,
        variableAnchorMaps
      );
      expect(mockItemBuilderService.buildCodingItem).toHaveBeenNthCalledWith(
        2,
        responses[1],
        'token',
        'http://server',
        1,
        variableAnchorMaps
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

    it.skip('should handle rejected promises in batch processing', async () => {
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
