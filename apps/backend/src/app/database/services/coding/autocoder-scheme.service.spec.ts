import { EntityManager, Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { RuntimeConfigService } from '../../../config/runtime-config.service';
import { WorkspaceFileMetadataReader } from '../workspace/workspace-file-metadata-reader.token';
import { AutocoderEngineService } from './autocoder-engine.service';
import { AutocoderSchemeService } from './autocoder-scheme.service';

describe('AutocoderSchemeService cache lifecycle', () => {
  let service: AutocoderSchemeService;
  let find: jest.Mock;
  let now: number;

  const file = (fileId: string, data: string): FileUpload => ({
    file_id: fileId, data, filename: fileId
  } as FileUpload);
  const schemeFile = (variableId: string) => file('SCHEME', JSON.stringify({
    version: '3.4', variableCodings: [{ id: variableId, sourceType: 'BASE', codes: [] }]
  }));

  beforeEach(() => {
    now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    find = jest.fn();
    service = new AutocoderSchemeService(
      { find } as unknown as Repository<FileUpload>,
      {} as WorkspaceFileMetadataReader,
      { autocoderSchemaValidationMode: 'compatible' } as RuntimeConfigService,
      new AutocoderEngineService()
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('extends a workspace file cache with missing units without querying cached units again', async () => {
    const first = file('UNIT_A', '<Unit/>');
    const second = file('UNIT_B', '<Unit/>');
    find.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);

    await service.getTestFilesWithCache(7, ['UNIT_A']);
    const files = await service.getTestFilesWithCache(7, ['UNIT_A', 'UNIT_B']);
    await service.getTestFilesWithCache(7, ['UNIT_A', 'UNIT_B']);

    expect([...files.values()]).toEqual([first, second]);
    expect(find).toHaveBeenCalledTimes(2);
    expect(find.mock.calls[1][0].where.file_id.value).toEqual(['UNIT_B']);
  });

  it('invalidates both file caches only for the requested workspace before another preflight', async () => {
    find.mockResolvedValueOnce([file('UNIT', 'old')])
      .mockResolvedValueOnce([schemeFile('old')])
      .mockResolvedValueOnce([file('UNIT', 'other')])
      .mockResolvedValueOnce([schemeFile('other')])
      .mockResolvedValueOnce([file('UNIT', 'new')])
      .mockResolvedValueOnce([schemeFile('new')]);
    await service.getTestFilesWithCache(7, ['UNIT']);
    await service.getCodingSchemesWithCache(7, ['SCHEME']);
    await service.getTestFilesWithCache(70, ['UNIT']);
    await service.getCodingSchemesWithCache(70, ['SCHEME']);

    service.invalidateWorkspaceCaches(7);
    const files = await service.getTestFilesWithCache(7, ['UNIT']);
    const schemes = await service.getCodingSchemesWithCache(7, ['SCHEME']);
    const otherFiles = await service.getTestFilesWithCache(70, ['UNIT']);
    const otherSchemes = await service.getCodingSchemesWithCache(70, ['SCHEME']);

    expect(files.get('UNIT')?.data).toBe('new');
    expect(schemes.get('SCHEME')?.variableCodings[0].id).toBe('new');
    expect(otherFiles.get('UNIT')?.data).toBe('other');
    expect(otherSchemes.get('SCHEME')?.variableCodings[0].id).toBe('other');
    expect(find).toHaveBeenCalledTimes(6);
  });

  it('expires unit files after 15 minutes and parsed schemes after 30 minutes', async () => {
    find.mockResolvedValueOnce([file('UNIT', 'old')])
      .mockResolvedValueOnce([schemeFile('old')])
      .mockResolvedValueOnce([file('UNIT', 'new')])
      .mockResolvedValueOnce([schemeFile('new')]);
    await service.getTestFilesWithCache(7, ['UNIT']);
    await service.getCodingSchemesWithCache(7, ['SCHEME']);

    now = 16 * 60 * 1000;
    service.cleanupCaches();
    expect((await service.getTestFilesWithCache(7, ['UNIT'])).get('UNIT')?.data).toBe('new');
    expect((await service.getCodingSchemesWithCache(7, ['SCHEME'])).get('SCHEME')?.variableCodings[0].id).toBe('old');
    expect(find).toHaveBeenCalledTimes(3);

    now = 31 * 60 * 1000;
    service.cleanupCaches();
    expect((await service.getCodingSchemesWithCache(7, ['SCHEME'])).get('SCHEME')?.variableCodings[0].id).toBe('new');
    expect(find).toHaveBeenCalledTimes(4);
  });

  it('uses the supplied preflight manager for both file queries', async () => {
    const preflightFind = jest.fn()
      .mockResolvedValueOnce([file('UNIT', 'locked file')])
      .mockResolvedValueOnce([schemeFile('locked')]);
    const manager = {
      getRepository: jest.fn().mockReturnValue({ find: preflightFind })
    } as unknown as EntityManager;

    await service.getTestFilesWithCache(7, ['UNIT'], manager);
    await service.getCodingSchemesWithCache(7, ['SCHEME'], manager);

    expect(manager.getRepository).toHaveBeenCalledWith(FileUpload);
    expect(preflightFind).toHaveBeenCalledTimes(2);
    expect(preflightFind.mock.calls.map(([options]) => options.where.workspace_id)).toEqual([7, 7]);
    expect(find).not.toHaveBeenCalled();
  });
});
