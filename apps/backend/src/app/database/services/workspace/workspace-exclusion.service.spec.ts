import { Repository } from 'typeorm';
import { WorkspaceExclusionService } from './workspace-exclusion.service';
import { WorkspaceCoreService } from './workspace-core.service';
import FileUpload from '../../entities/file_upload.entity';
import { CacheService } from '../../../cache/cache.service';

describe('WorkspaceExclusionService', () => {
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
