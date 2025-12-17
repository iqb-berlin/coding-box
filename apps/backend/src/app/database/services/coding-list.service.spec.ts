import { Repository } from 'typeorm';
import FileUpload from '../entities/file_upload.entity';
import { ResponseEntity } from '../entities/response.entity';
import { WorkspaceFilesService } from './workspace-files.service';
import { CodingListService } from './coding-list.service';

type CodingListServiceHeaderGetter = {
  getHeadersForVersion: (version: 'v1' | 'v2' | 'v3') => string[];
};

describe('CodingListService', () => {
  it('should use CodingItem keys as Excel headers for results-by-version export', () => {
    const fileUploadRepository = {} as unknown as Repository<FileUpload>;
    const responseRepository = {} as unknown as Repository<ResponseEntity>;
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn()
    } as unknown as WorkspaceFilesService;

    const service = new CodingListService(
      fileUploadRepository,
      responseRepository,
      workspaceFilesService
    );

    const headersV1 = (
      service as unknown as CodingListServiceHeaderGetter
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
