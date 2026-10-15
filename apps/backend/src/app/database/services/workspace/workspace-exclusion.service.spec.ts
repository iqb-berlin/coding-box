import { EntityManager, Repository } from 'typeorm';
import { ExclusionContext, WorkspaceExclusionService } from './workspace-exclusion.service';
import { WorkspaceCoreService } from './workspace-core.service';
import FileUpload from '../../entities/file_upload.entity';
import Workspace from '../../entities/workspace.entity';
import { CacheService } from '../../../cache/cache.service';
import { WorkspaceSettingsDto } from '../../../../../../../api-dto/workspaces/workspace-settings-dto';

const createService = (settings: WorkspaceSettingsDto = {}) => {
  const workspaceCoreService = {
    findOne: jest.fn().mockResolvedValue({ settings })
  };
  const fileUploadRepository = {
    find: jest.fn().mockResolvedValue([])
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

  return {
    service, workspaceCoreService, fileUploadRepository, cacheService
  };
};

describe('WorkspaceExclusionService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns cached exclusions without reading workspace settings or files', async () => {
    const {
      service, workspaceCoreService, fileUploadRepository, cacheService
    } = createService();
    const cached = {
      globalIgnoredUnits: ['U1'], ignoredBooklets: ['B1'], testletIgnoredUnits: []
    };
    cacheService.get.mockResolvedValue(cached);

    await expect(service.resolveExclusionsForQueries(7)).resolves.toBe(cached);
    expect(cacheService.get).toHaveBeenCalledWith('workspace-exclusions-7');
    expect(workspaceCoreService.findOne).not.toHaveBeenCalled();
    expect(fileUploadRepository.find).not.toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('normalizes exclusions and resolves nested ignored testlets only in the selected booklet', async () => {
    const {
      service, workspaceCoreService, fileUploadRepository, cacheService
    } = createService({
      ignoredUnits: [' unit-global.xml '],
      ignoredBooklets: [' booklet-ignore '],
      ignoredTestlets: [{ bookletId: ' booklet-a ', testletId: ' t1 ' }]
    });
    fileUploadRepository.find.mockResolvedValue([
      {
        file_id: 'booklet-a',
        data: '<Booklet><Testlet id="T1"><Unit id="unit-a.XML" />' +
          '<Testlet id="nested"><Unit id="unit-b" /></Testlet></Testlet>' +
          '<Testlet id="T2"><Unit id="unit-c" /></Testlet></Booklet>'
      },
      {
        file_id: 'booklet-b',
        data: '<Booklet><Testlet id="T1"><Unit id="unit-other" /></Testlet></Booklet>'
      }
    ]);
    const expected = {
      globalIgnoredUnits: ['UNIT-GLOBAL'],
      ignoredBooklets: ['BOOKLET-IGNORE'],
      testletIgnoredUnits: [
        { bookletId: 'BOOKLET-A', unitId: 'UNIT-A' },
        { bookletId: 'BOOKLET-A', unitId: 'UNIT-B' }
      ]
    };

    await expect(service.resolveExclusionsForQueries(7)).resolves.toEqual(expected);
    expect(workspaceCoreService.findOne).toHaveBeenCalledWith(7);
    expect(fileUploadRepository.find).toHaveBeenCalledWith({
      where: { workspace_id: 7, file_type: 'Booklet' }
    });
    expect(cacheService.set).toHaveBeenCalledWith('workspace-exclusions-7', expected, 3600);
  });

  it('reads transactional settings and files through the supplied manager without using shared caches', async () => {
    const {
      service, workspaceCoreService, fileUploadRepository, cacheService
    } = createService();
    cacheService.get.mockResolvedValue({
      globalIgnoredUnits: ['STALE'], ignoredBooklets: [], testletIgnoredUnits: []
    });
    const transactionalWorkspaceRepository = {
      findOne: jest.fn().mockResolvedValue({
        settings: { ignoredTestlets: [{ bookletId: 'B1', testletId: 'T1' }] }
      })
    };
    const transactionalFileRepository = {
      find: jest.fn().mockResolvedValue([{
        file_id: 'B1', data: '<Booklet><Testlet id="T1"><Unit id="U1" /></Testlet></Booklet>'
      }])
    };
    const manager = {
      getRepository: jest.fn(entity => {
        if (entity === Workspace) return transactionalWorkspaceRepository;
        if (entity === FileUpload) return transactionalFileRepository;
        throw new Error('Unexpected repository');
      })
    };

    await expect(service.resolveExclusionsForQueries(7, manager as unknown as EntityManager))
      .resolves.toEqual({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: [{ bookletId: 'B1', unitId: 'U1' }]
      });
    expect(transactionalWorkspaceRepository.findOne).toHaveBeenCalledWith({
      where: { id: 7 }, select: { id: true, name: true, settings: true }
    });
    expect(transactionalFileRepository.find).toHaveBeenCalledWith({
      where: { workspace_id: 7, file_type: 'Booklet' }
    });
    expect(workspaceCoreService.findOne).not.toHaveBeenCalled();
    expect(fileUploadRepository.find).not.toHaveBeenCalled();
    expect(cacheService.get).not.toHaveBeenCalled();
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('returns no exclusions for a missing workspace', async () => {
    const { service, workspaceCoreService } = createService();
    workspaceCoreService.findOne.mockResolvedValue(null);

    await expect(service.getExclusions(7)).resolves.toEqual({});
  });

  it('propagates workspace lookup failures without caching a false empty result', async () => {
    const { service, workspaceCoreService, cacheService } = createService();
    const error = new Error('database unavailable');
    workspaceCoreService.findOne.mockRejectedValue(error);

    await expect(service.resolveExclusionsForQueries(7)).rejects.toBe(error);
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('propagates booklet repository failures instead of dropping selected testlet exclusions', async () => {
    const { service, fileUploadRepository, cacheService } = createService({
      ignoredTestlets: [{ bookletId: 'B1', testletId: 'T1' }]
    });
    const error = new Error('booklet lookup failed');
    fileUploadRepository.find.mockRejectedValue(error);

    await expect(service.resolveExclusionsForQueries(7)).rejects.toBe(error);
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('invalidates only the selected workspace exclusion cache', async () => {
    const { service, cacheService } = createService();

    await service.invalidateExclusionCache(7);
    expect(cacheService.delete).toHaveBeenCalledTimes(1);
    expect(cacheService.delete).toHaveBeenCalledWith('workspace-exclusions-7');
  });

  it.each<[ExclusionContext, boolean]>([
    [{ unitId: 'u1' }, true],
    [{ bookletId: 'b1' }, true],
    [{ bookletId: 'b2', testletId: 't1' }, true],
    [{ bookletId: 'b3', testletId: 't1' }, false],
    [{ bookletId: 'b2', testletId: 't2' }, false],
    [{ unitId: 'u2' }, false]
  ])('resolves exclusions without leaking testlet IDs across booklets: %j', (context, excluded) => {
    const { service } = createService();

    expect(service.isExcluded(context, {
      ignoredUnits: ['U1'],
      ignoredBooklets: ['B1'],
      ignoredTestlets: [{ bookletId: 'B2', testletId: 'T1' }]
    })).toBe(excluded);
  });

  it('warns when an ignored-testlet booklet cannot be parsed', async () => {
    const { service, fileUploadRepository } = createService({
      ignoredTestlets: [{ bookletId: 'BOOKLET-A', testletId: 'T1' }]
    });
    const brokenBooklet = { file_id: 'BOOKLET-A' };
    Object.defineProperty(brokenBooklet, 'data', {
      get: () => {
        throw new Error('broken booklet xml');
      }
    });
    fileUploadRepository.find.mockResolvedValue([brokenBooklet]);
    const logger = (service as unknown as { logger: { warn: (message: string) => void } }).logger;
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    await expect(service.resolveExclusionsForQueries(7)).resolves.toEqual({
      globalIgnoredUnits: [], ignoredBooklets: [], testletIgnoredUnits: []
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Could not parse booklet BOOKLET-A while resolving ignored testlets for workspace 7: broken booklet xml'
    );
  });
});
