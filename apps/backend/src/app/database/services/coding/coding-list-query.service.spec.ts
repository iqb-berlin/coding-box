import { Repository } from 'typeorm';
import FileUpload from '../../entities/file_upload.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { statusStringToNumber } from '../../utils/response-status-converter';
import { WorkspaceFilesService, WorkspaceCoreService } from '../workspace';
import { WorkspaceExclusionService } from '../workspace/workspace-exclusion.service';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingListQueryService } from './coding-list-query.service';

type QueryBuilderMock = {
  leftJoinAndSelect: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  getManyAndCount: jest.Mock;
};

describe('CodingListQueryService', () => {
  function createQueryBuilder(
    responses: ResponseEntity[],
    total: number
  ): QueryBuilderMock {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn(),
      where: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      getManyAndCount: jest.fn().mockResolvedValue([responses, total])
    };

    queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);

    return queryBuilder;
  }

  function createFile(fileId: string, data: unknown): Partial<FileUpload> {
    return {
      file_id: fileId,
      file_type: 'Resource',
      workspace_id: 1,
      data: typeof data === 'string' ? data : JSON.stringify(data)
    };
  }

  function createFileRepository(files: Record<string, Partial<FileUpload>>) {
    return {
      findOne: jest.fn(({ where }: { where: { file_id: string } }) => (
        Promise.resolve(files[where.file_id] ?? null)
      ))
    } as unknown as Repository<FileUpload> & { findOne: jest.Mock };
  }

  function createService(
    responses: ResponseEntity[],
    fileRepository: Repository<FileUpload>
  ): CodingListQueryService {
    const queryBuilder = createQueryBuilder(responses, responses.length);
    const responseRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder)
    } as unknown as Repository<ResponseEntity>;
    const fileCacheService = new CodingFileCacheService(fileRepository);
    const workspaceFilesService = {
      getUnitVariableMap: jest.fn().mockResolvedValue(
        new Map([['UNIT', new Set(['VAR_WITH_OVERRIDE'])]])
      ),
      getIntendedIncompleteSchemeVariableMap: jest.fn().mockResolvedValue(new Map()),
      getCoderTrainingRequiredVariableMap: jest.fn().mockResolvedValue(new Map())
    } as unknown as WorkspaceFilesService;
    const workspaceExclusionService = {
      resolveExclusionsForQueries: jest.fn().mockResolvedValue({
        globalIgnoredUnits: [],
        ignoredBooklets: [],
        testletIgnoredUnits: []
      })
    } as unknown as WorkspaceExclusionService;

    return new CodingListQueryService(
      responseRepository,
      fileCacheService,
      workspaceFilesService,
      {} as unknown as WorkspaceCoreService,
      workspaceExclusionService
    );
  }

  it('uses VOCS page overrides for coding-list variable_page and replay URL', async () => {
    const fileRepository = createFileRepository({
      'UNIT.VOUD': createFile('UNIT.VOUD', {
        pages: [
          { sections: [{ elements: [{ id: 'VAR_ON_FIRST_AUTO_PAGE' }] }] },
          { sections: [{ elements: [{ id: 'VAR_ON_SECOND_AUTO_PAGE' }] }] },
          { sections: [{ elements: [{ id: 'VAR_WITH_OVERRIDE' }] }] }
        ]
      }),
      'UNIT.VOCS': createFile('UNIT.VOCS', {
        variableCodings: [
          { id: 'VAR_WITH_OVERRIDE', page: '2' }
        ]
      })
    });
    const response = {
      id: 1,
      variableid: 'VAR_WITH_OVERRIDE',
      value: 'Antwort',
      status_v1: statusStringToNumber('CODING_INCOMPLETE'),
      unit: {
        name: 'UNIT',
        alias: 'Unit Alias',
        booklet: {
          person: {
            login: 'login',
            code: 'code',
            group: 'group'
          },
          bookletinfo: {
            name: 'BOOKLET'
          }
        }
      }
    } as unknown as ResponseEntity;
    const service = createService([response], fileRepository);

    const result = await service.getCodingList(
      1,
      'token',
      'https://iqb-kodierbox.de'
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      variable_id: 'VAR_WITH_OVERRIDE',
      variable_page: '1',
      variable_anchor: 'VAR_WITH_OVERRIDE',
      url: 'https://iqb-kodierbox.de/#/replay/login@code@group@BOOKLET/UNIT/1/VAR_WITH_OVERRIDE?auth=token'
    });
  });
});
