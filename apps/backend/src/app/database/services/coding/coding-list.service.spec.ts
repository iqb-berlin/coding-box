import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { WorkspaceFilesService, WorkspaceCoreService } from '../workspace';
import { CodingListService } from './coding-list.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingListQueryService } from './coding-list-query.service';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CodingListStreamService } from './coding-list-stream.service';
import { CodingItemBuilderService } from './coding-item-builder.service';

type CodingItemBuilderServiceHeaderGetter = {
  getHeadersForVersion: (version: 'v1' | 'v2' | 'v3', includeResponseValues?: boolean) => string[];
};

describe('CodingListService', () => {
  it('should use CodingItem keys as Excel headers for results-by-version export', () => {
    const fileUploadRepository = {} as unknown as Repository<FileUpload>;
    const responseRepository = {} as unknown as Repository<ResponseEntity>;
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn()
    } as unknown as WorkspaceFilesService;

    // Create the dependencies
    const fileCacheService = new CodingFileCacheService(fileUploadRepository);
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);
    const queryService = new CodingListQueryService(
      responseRepository,
      fileCacheService,
      workspaceFilesService,
      {} as unknown as WorkspaceCoreService,
      {
        resolveExclusionsForQueries: jest.fn().mockResolvedValue({ globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: [] })
      } as unknown as WorkspaceExclusionService
    );
    const streamService = {} as unknown as CodingListStreamService;

    const service = new CodingListService(
      fileCacheService,
      queryService,
      streamService
    );

    expect(service).toBeDefined();

    // Test the header generation through the item builder service
    const headersV1 = (
      itemBuilderService as unknown as CodingItemBuilderServiceHeaderGetter
    ).getHeadersForVersion('v1');

    expect(headersV1).toEqual(
      expect.arrayContaining([
        'person_login',
        'person_code',
        'person_group',
        'booklet_name',
        'value'
      ])
    );
    expect(headersV1.indexOf('value')).toBe(headersV1.indexOf('variable_anchor') + 1);

    expect(headersV1).not.toEqual(
      expect.arrayContaining([
        'login_name',
        'login_code',
        'login_group',
        'booklet_id'
      ])
    );
  });

  it('should omit value from results-by-version headers when response values are disabled', () => {
    const fileUploadRepository = {} as unknown as Repository<FileUpload>;
    const fileCacheService = new CodingFileCacheService(fileUploadRepository);
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);

    const headersV1 = (
      itemBuilderService as unknown as CodingItemBuilderServiceHeaderGetter
    ).getHeadersForVersion('v1', false);

    expect(headersV1).toEqual([
      'unit_key',
      'unit_alias',
      'person_login',
      'person_code',
      'person_group',
      'booklet_name',
      'variable_id',
      'variable_page',
      'variable_anchor',
      'status_v1',
      'code_v1',
      'score_v1'
    ]);
  });

  it('should include response value in versioned coding items by default', async () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map([['VAR1', '2']]))
    } as unknown as CodingFileCacheService;
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);
    const response = {
      id: 1,
      variableid: 'VAR1',
      value: 'Antworttext',
      status_v1: null,
      code_v1: null,
      score_v1: null,
      unit: {
        name: 'UNIT1',
        alias: 'Unit 1',
        booklet: {
          person: { login: 'login', code: 'code', group: 'group' },
          bookletinfo: { name: 'BOOKLET1' }
        }
      }
    } as unknown as ResponseEntity;

    await expect(
      itemBuilderService.buildCodingItemWithVersions(
        response,
        'v1',
        'token',
        'http://server',
        1
      )
    ).resolves.toMatchObject({
      variable_anchor: 'VAR1',
      value: 'Antworttext',
      status_v1: ''
    });
  });

  it('should replace GeoGebra response values with a placeholder by default', async () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);
    const response = {
      id: 1,
      variableid: 'VAR1',
      value: 'UEsDBA==',
      status_v1: null,
      code_v1: null,
      score_v1: null,
      unit: {
        name: 'UNIT1',
        alias: 'Unit 1',
        booklet: {
          person: { login: 'login', code: 'code', group: 'group' },
          bookletinfo: { name: 'BOOKLET1' }
        }
      }
    } as unknown as ResponseEntity;

    await expect(
      itemBuilderService.buildCodingItemWithVersions(
        response,
        'v1',
        'token',
        'http://server',
        1
      )
    ).resolves.toMatchObject({
      value: '[GeoGebra]'
    });
  });

  it('should include raw GeoGebra response values when explicitly enabled', async () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);
    const response = {
      id: 1,
      variableid: 'VAR1',
      value: 'UEsDBA==',
      status_v1: null,
      code_v1: null,
      score_v1: null,
      unit: {
        name: 'UNIT1',
        alias: 'Unit 1',
        booklet: {
          person: { login: 'login', code: 'code', group: 'group' },
          bookletinfo: { name: 'BOOKLET1' }
        }
      }
    } as unknown as ResponseEntity;

    await expect(
      itemBuilderService.buildCodingItemWithVersions(
        response,
        'v1',
        'token',
        'http://server',
        1,
        false,
        true,
        true
      )
    ).resolves.toMatchObject({
      value: 'UEsDBA=='
    });
  });

  it('should omit response value in versioned coding items when disabled', async () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);
    const response = {
      id: 1,
      variableid: 'VAR1',
      value: 'Antworttext',
      status_v1: null,
      code_v1: null,
      score_v1: null,
      unit: {
        name: 'UNIT1',
        alias: 'Unit 1',
        booklet: {
          person: { login: 'login', code: 'code', group: 'group' },
          bookletinfo: { name: 'BOOKLET1' }
        }
      }
    } as unknown as ResponseEntity;

    const item = await itemBuilderService.buildCodingItemWithVersions(
      response,
      'v1',
      'token',
      'http://server',
      1,
      false,
      false
    );

    expect(item).not.toHaveProperty('value');
  });

  it('should convert string status values in versioned coding items', async () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;
    const itemBuilderService = new CodingItemBuilderService(fileCacheService);
    const response = {
      id: 1,
      variableid: 'VAR1',
      value: 'Antworttext',
      status_v1: 'CODING_INCOMPLETE',
      code_v1: null,
      score_v1: null,
      status_v2: 5,
      code_v2: null,
      score_v2: null,
      status_v3: '5',
      code_v3: null,
      score_v3: null,
      unit: {
        name: 'UNIT1',
        alias: 'Unit 1',
        booklet: {
          person: { login: 'login', code: 'code', group: 'group' },
          bookletinfo: { name: 'BOOKLET1' }
        }
      }
    } as unknown as ResponseEntity;

    await expect(
      itemBuilderService.buildCodingItemWithVersions(
        response,
        'v3',
        'token',
        'http://server',
        1
      )
    ).resolves.toMatchObject({
      status_v1: 'CODING_INCOMPLETE',
      status_v2: 'CODING_COMPLETE',
      status_v3: 'CODING_COMPLETE'
    });
  });
});
