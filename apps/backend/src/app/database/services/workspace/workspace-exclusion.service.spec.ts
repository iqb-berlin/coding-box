import { EntityManager, Repository } from 'typeorm';
import { WorkspaceExclusionService } from './workspace-exclusion.service';
import { WorkspaceCoreService } from './workspace-core.service';
import FileUpload from '../../entities/file_upload.entity';
import Workspace from '../../entities/workspace.entity';
import { CacheService } from '../../../cache/cache.service';

describe('WorkspaceExclusionService', () => {
  it('resolves transactional settings and booklet files without a second connection or shared cache', async () => {
    const workspaceCoreService = { findOne: jest.fn().mockRejectedValue(new Error('Pool exhausted')) };
    const fileUploadRepository = { find: jest.fn().mockRejectedValue(new Error('Pool exhausted')) };
    const workspaceRepository = {
      findOne: jest.fn().mockResolvedValue({
        settings: {
          ignoredUnits: ['UNIT-A'],
          ignoredTestlets: [{ bookletId: 'BOOKLET-A', testletId: 'T1' }]
        }
      })
    };
    const transactionFileRepository = {
      find: jest.fn().mockResolvedValue([{
        file_id: 'BOOKLET-A',
        data: '<Booklet><Testlet id="T1"><Unit id="UNIT-B"/></Testlet></Booklet>'
      }])
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue({ globalIgnoredUnits: ['OLD'], ignoredBooklets: [], testletIgnoredUnits: [] }),
      set: jest.fn()
    };
    const manager = {
      getRepository: jest.fn(entity => (entity === Workspace ? workspaceRepository : transactionFileRepository))
    } as unknown as EntityManager;
    const service = new WorkspaceExclusionService(
      workspaceCoreService as unknown as WorkspaceCoreService,
      fileUploadRepository as unknown as Repository<FileUpload>,
      cacheService as unknown as CacheService
    );
    await expect(service.resolveExclusionsForQueries(7, manager)).resolves.toEqual({
      globalIgnoredUnits: ['UNIT-A'],
      ignoredBooklets: [],
      testletIgnoredUnits: [{ bookletId: 'BOOKLET-A', unitId: 'UNIT-B' }]
    });
    expect(manager.getRepository).toHaveBeenCalledWith(Workspace);
    expect(manager.getRepository).toHaveBeenCalledWith(FileUpload);
    expect(workspaceCoreService.findOne).not.toHaveBeenCalled();
    expect(fileUploadRepository.find).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('warns when an ignored-testlet booklet cannot be parsed', async () => {
    const workspaceCoreService = {
      findOne: jest.fn().mockResolvedValue({
        settings: {
          ignoredTestlets: [{ bookletId: 'BOOKLET-A', testletId: 'T1' }]
        }
      })
    };
    const brokenBooklet = { file_id: 'BOOKLET-A' };
    Object.defineProperty(brokenBooklet, 'data', {
      get: () => {
        throw new Error('broken booklet xml');
      }
    });
    const fileUploadRepository = {
      find: jest.fn().mockResolvedValue([brokenBooklet])
    };
    const cacheService = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined)
    };

    const service = new WorkspaceExclusionService(
      workspaceCoreService as unknown as WorkspaceCoreService,
      fileUploadRepository as unknown as Repository<FileUpload>,
      cacheService as unknown as CacheService
    );
    const logger = (service as unknown as { logger: { warn: (message: string) => void } }).logger;
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(jest.fn());

    await expect(service.resolveExclusionsForQueries(7)).resolves.toEqual({
      globalIgnoredUnits: [],
      ignoredBooklets: [],
      testletIgnoredUnits: []
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'Could not parse booklet BOOKLET-A while resolving ignored testlets for workspace 7: broken booklet xml'
    );
  });
});
