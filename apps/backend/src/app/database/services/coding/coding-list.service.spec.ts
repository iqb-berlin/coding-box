import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { WorkspaceFilesService, WorkspaceCoreService } from '../workspace';
import { CodingListService } from './coding-list.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingListQueryService } from './coding-list-query.service';
import { CodingListStreamService } from './coding-list-stream.service';
import { CodingItemBuilderService } from './coding-item-builder.service';

type CodingItemBuilderServiceHeaderGetter = {
  getHeadersForVersion: (version: 'v1' | 'v2' | 'v3') => string[];
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
      fileUploadRepository,
      responseRepository,
      workspaceFilesService,
      {} as unknown as WorkspaceCoreService
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
        'booklet_name'
      ])
    );

    expect(headersV1).not.toEqual(
      expect.arrayContaining([
        'login_name',
        'login_code',
        'login_group',
        'booklet_id'
      ])
    );
  });
});
