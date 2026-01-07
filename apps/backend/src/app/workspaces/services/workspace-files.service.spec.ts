import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceFilesService } from './workspace-files.service';
import { WorkspaceFilesFacade } from './workspace-files-facade.service';

describe('WorkspaceFilesService', () => {
  let service: WorkspaceFilesService;
  let facade: jest.Mocked<WorkspaceFilesFacade>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceFilesService,
        {
          provide: WorkspaceFilesFacade,
          useValue: {
            findAllFileTypes: jest.fn(),
            findFiles: jest.fn(),
            getUnitVariableMap: jest.fn(),
            uploadFiles: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<WorkspaceFilesService>(WorkspaceFilesService);
    facade = module.get(WorkspaceFilesFacade);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delegate findAllFileTypes to facade', async () => {
    const mockFileTypes = ['Unit', 'Testtakers'];
    facade.findAllFileTypes.mockResolvedValue(mockFileTypes);

    const result = await service.findAllFileTypes(1);

    expect(result).toEqual(mockFileTypes);
    expect(facade.findAllFileTypes).toHaveBeenCalledWith(1);
  });

  it('should delegate findFiles to facade', async () => {
    const mockFiles = [{ file_id: 'test', filename: 'test.xml', data: '<xml></xml>' }];
    const mockTotal = 1;
    const mockFileTypes = ['Unit'];
    facade.findFiles.mockResolvedValue([mockFiles, mockTotal, mockFileTypes]);

    const result = await service.findFiles(1, { page: 1, limit: 10 });

    expect(result).toEqual([mockFiles, mockTotal, mockFileTypes]);
    expect(facade.findFiles).toHaveBeenCalledWith(1, { page: 1, limit: 10 });
  });

  it('should delegate getUnitVariableMap to facade', async () => {
    const mockMap = new Map([['UNIT1', new Set(['var1', 'var2'])]]);
    facade.getUnitVariableMap.mockResolvedValue(mockMap);

    const result = await service.getUnitVariableMap(1);

    expect(result).toEqual(mockMap);
    expect(facade.getUnitVariableMap).toHaveBeenCalledWith(1);
  });
});
