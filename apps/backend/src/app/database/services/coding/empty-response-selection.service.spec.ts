import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';
import {
  CODING_INCOMPLETE_STATUS,
  INTENDED_INCOMPLETE_STATUS
} from '../../utils/manual-coding-candidate.util';
import { WorkspaceFilesService } from '../workspace/workspace-files.service';
import { EmptyResponseSelectionService } from './empty-response-selection.service';

describe('EmptyResponseSelectionService', () => {
  let service: EmptyResponseSelectionService;
  let responseRepository: jest.Mocked<Repository<ResponseEntity>>;
  let workspaceFilesService: jest.Mocked<Pick<
  WorkspaceFilesService,
  'getDerivedVariableMetadata'
  >>;
  let sourceRows: ResponseEntity[];

  const response = (
    id: number,
    unitid: number,
    variableid: string,
    value: string | null,
    unitName = 'UNIT'
  ): ResponseEntity => ({
    id,
    unitid,
    variableid,
    value,
    unit: { name: unitName }
  } as ResponseEntity);

  const withStatus = (
    item: ResponseEntity,
    status: number
  ): ResponseEntity => ({
    ...item,
    status_v1: status
  });

  beforeEach(() => {
    sourceRows = [];
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => sourceRows)
    };
    responseRepository = {
      createQueryBuilder: jest.fn(() => queryBuilder)
    } as unknown as jest.Mocked<Repository<ResponseEntity>>;
    workspaceFilesService = {
      getDerivedVariableMetadata: jest.fn().mockResolvedValue({
        metadataAvailable: true,
        derivedVariableMap: new Map(),
        derivedVariablesBySourceMap: new Map()
      })
    };
    service = new EmptyResponseSelectionService(
      responseRepository,
      workspaceFilesService as unknown as WorkspaceFilesService
    );
  });

  it('uses source values for derived targets while preserving base behavior', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED_EMPTY', 'DERIVED_NONEMPTY'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [
          getManualCodingScopeKey('UNIT', 'SOURCE'),
          new Set(['DERIVED_EMPTY', 'DERIVED_NONEMPTY'])
        ]
      ])
    });
    sourceRows = [
      response(10, 2, 'SOURCE', ''),
      response(11, 3, 'SOURCE', 'answered')
    ];
    const candidates = [
      response(1, 1, 'BASE', ''),
      response(2, 2, 'DERIVED_EMPTY', ''),
      response(3, 3, 'DERIVED_NONEMPTY', '')
    ];

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      candidates,
      context
    );

    expect(result.map(item => item.id)).toEqual([1, 2]);
  });

  it('normalizes unit names before identifying derived targets', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['r8s3f7', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('r8s3f7', 'SOURCE'), new Set(['DERIVED'])]
      ])
    });
    sourceRows = [response(10, 1, 'SOURCE', 'answered', 'r8s3f7')];

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'DERIVED', '', 'r8s3f7')],
      context
    );

    expect(context.derivedVariableMap.get('R8S3F7'))
      .toEqual(new Set(['DERIVED']));
    expect(result).toEqual([]);
  });

  it('resolves nested derived variables to their leaf sources', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['INNER', 'OUTER'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'BASE'), new Set(['INNER'])],
        [getManualCodingScopeKey('UNIT', 'INNER'), new Set(['OUTER'])]
      ])
    });
    sourceRows = [response(10, 1, 'BASE', 'answered')];

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'OUTER', '')],
      context
    );

    expect(result).toEqual([]);
  });

  it('checks every leaf source regardless of its coding status', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'AUTO_SOURCE'), new Set(['DERIVED'])],
        [getManualCodingScopeKey('UNIT', 'MANUAL_SOURCE'), new Set(['DERIVED'])]
      ])
    });
    sourceRows = [
      withStatus(response(10, 1, 'AUTO_SOURCE', 'selected'), 5),
      withStatus(
        response(11, 1, 'MANUAL_SOURCE', ''),
        INTENDED_INCOMPLETE_STATUS
      )
    ];

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'DERIVED', '')],
      context
    );

    expect(result).toEqual([]);

    sourceRows[0] = withStatus(
      response(10, 1, 'AUTO_SOURCE', ''),
      5
    );
    await expect(service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'DERIVED', '')],
      context
    )).resolves.toEqual([response(1, 1, 'DERIVED', '')]);

    sourceRows[1] = withStatus(
      response(11, 1, 'MANUAL_SOURCE', 'answered'),
      CODING_INCOMPLETE_STATUS
    );
    await expect(service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'DERIVED', '')],
      context
    )).resolves.toEqual([]);
  });

  it('ignores the technical target value for derived variables', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'SOURCE'), new Set(['DERIVED'])]
      ])
    });
    sourceRows = [response(10, 1, 'SOURCE', '')];

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'DERIVED', 'technical solver value')],
      context
    );

    expect(result.map(item => item.id)).toEqual([1]);
  });

  it('does not classify derived targets when a source response is missing', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'SOURCE'), new Set(['DERIVED'])]
      ])
    });

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'DERIVED', '')],
      context
    );

    expect(result).toEqual([]);
  });

  it('fails closed when derived-variable metadata cannot be loaded', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: false,
      derivedVariableMap: new Map(),
      derivedVariablesBySourceMap: new Map()
    });

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [response(1, 1, 'BASE', '')],
      context
    );

    expect(context.metadataAvailable).toBe(false);
    expect(result).toEqual([]);
    expect(responseRepository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
