import AdmZip from 'adm-zip';
import { Repository } from 'typeorm';
import { ResponseEntity } from '../../entities/response.entity';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';
import {
  CODING_COMPLETE_STATUS,
  CODING_INCOMPLETE_STATUS,
  INTENDED_INCOMPLETE_STATUS
} from '../../utils/manual-coding-candidate.util';
import { statusStringToNumber } from '../../utils/response-status-converter';
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
      alias: 'source',
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
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

  it('selects only displayed GeoGebra files as empty, even when an edited file matches the starting value', async () => {
    const drawing = new AdmZip();
    drawing.addFile('geogebra.xml', Buffer.from('<geogebra><construction/></geogebra>'));
    const construction = drawing.toBuffer().toString('base64');
    const otherArchive = new AdmZip();
    otherArchive.addFile('notes.txt', Buffer.from('Answer'));
    const displayed = statusStringToNumber('DISPLAYED');
    const changed = statusStringToNumber('VALUE_CHANGED');
    const candidates = [
      { ...response(1, 1, 'DRAWING', construction), status: displayed },
      { ...response(2, 2, 'DRAWING', construction), status: changed },
      { ...response(3, 3, 'DRAWING', construction) },
      { ...response(4, 4, 'OTHER', otherArchive.toBuffer().toString('base64')), status: displayed },
      { ...response(5, 5, 'OTHER', 'UEsD-invalid'), status: displayed },
      { ...response(6, 6, 'OTHER', 'Starting text'), status: displayed },
      { ...response(7, 7, 'DRAWING', `data:application/vnd.geogebra.file;base64,${construction}`), status: displayed }
    ];

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(candidates, context);

    expect(result.map(item => item.id)).toEqual([1, 7]);
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

  it('uses empty intended-incomplete sources for mixed MC+reason targets', async () => {
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
      withStatus(
        response(10, 1, 'AUTO_SOURCE', 'selected'),
        CODING_COMPLETE_STATUS
      ),
      {
        ...withStatus(
          response(11, 1, 'MANUAL_SOURCE', ''),
          INTENDED_INCOMPLETE_STATUS
        ),
        status_v2: CODING_COMPLETE_STATUS,
        code_v2: -98,
        score_v2: 0
      }
    ];
    const target = withStatus(
      response(1, 1, 'DERIVED', 'technical solver value'),
      CODING_INCOMPLETE_STATUS
    );

    const context = await service.createContext(17);
    const result = await service.filterEffectivelyEmptyResponses(
      [target],
      context
    );

    expect(result).toEqual([target]);
  });

  it('keeps mixed MC+reason targets open when an intended source is answered', async () => {
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
      withStatus(
        response(10, 1, 'AUTO_SOURCE', ''),
        CODING_COMPLETE_STATUS
      ),
      withStatus(
        response(11, 1, 'MANUAL_SOURCE', 'reason'),
        INTENDED_INCOMPLETE_STATUS
      )
    ];
    const target = withStatus(
      response(1, 1, 'DERIVED', ''),
      CODING_INCOMPLETE_STATUS
    );

    const context = await service.createContext(17);

    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([]);
  });

  it('keeps the all-leaf-sources fallback when no source is intended-incomplete', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'SOURCE_A'), new Set(['DERIVED'])],
        [getManualCodingScopeKey('UNIT', 'SOURCE_B'), new Set(['DERIVED'])]
      ])
    });
    sourceRows = [
      withStatus(response(10, 1, 'SOURCE_A', ''), CODING_COMPLETE_STATUS),
      withStatus(response(11, 1, 'SOURCE_B', ''), CODING_INCOMPLETE_STATUS)
    ];
    const target = withStatus(
      response(1, 1, 'DERIVED', ''),
      CODING_INCOMPLETE_STATUS
    );

    const context = await service.createContext(17);

    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([target]);

    sourceRows[1] = withStatus(
      response(11, 1, 'SOURCE_B', 'answered'),
      CODING_INCOMPLETE_STATUS
    );
    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([]);
  });

  it('fails closed for ambiguous MC+reason source status combinations', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'AUTO_SOURCE'), new Set(['DERIVED'])],
        [getManualCodingScopeKey('UNIT', 'MANUAL_SOURCE'), new Set(['DERIVED'])],
        [getManualCodingScopeKey('UNIT', 'OTHER_SOURCE'), new Set(['DERIVED'])]
      ])
    });
    sourceRows = [
      withStatus(response(10, 1, 'AUTO_SOURCE', ''), CODING_COMPLETE_STATUS),
      withStatus(
        response(11, 1, 'MANUAL_SOURCE', ''),
        INTENDED_INCOMPLETE_STATUS
      ),
      withStatus(response(12, 1, 'OTHER_SOURCE', ''), CODING_INCOMPLETE_STATUS)
    ];
    const target = withStatus(
      response(1, 1, 'DERIVED', ''),
      CODING_INCOMPLETE_STATUS
    );

    const context = await service.createContext(17);

    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([]);

    sourceRows = sourceRows.map(source => withStatus(
      source,
      INTENDED_INCOMPLETE_STATUS
    ));
    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([]);
  });

  it('fails closed for missing source statuses on coding-incomplete targets', async () => {
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
    const target = withStatus(
      response(1, 1, 'DERIVED', ''),
      CODING_INCOMPLETE_STATUS
    );

    const context = await service.createContext(17);

    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([]);

    sourceRows[0] = withStatus(response(10, 1, 'SOURCE', ''), 64);
    await expect(service.filterEffectivelyEmptyResponses(
      [target],
      context
    )).resolves.toEqual([]);
  });

  it('fails closed when a leaf source has multiple response rows', async () => {
    workspaceFilesService.getDerivedVariableMetadata.mockResolvedValue({
      metadataAvailable: true,
      derivedVariableMap: new Map([
        ['UNIT', new Set(['DERIVED'])]
      ]),
      derivedVariablesBySourceMap: new Map([
        [getManualCodingScopeKey('UNIT', 'SOURCE'), new Set(['DERIVED'])]
      ])
    });
    sourceRows = [
      withStatus(response(10, 1, 'SOURCE', ''), CODING_COMPLETE_STATUS),
      withStatus(response(11, 1, 'SOURCE', ''), CODING_COMPLETE_STATUS)
    ];
    const target = withStatus(
      response(1, 1, 'DERIVED', ''),
      CODING_INCOMPLETE_STATUS
    );

    const context = await service.createContext(17);

    await expect(service.filterEffectivelyEmptyResponses(
      [target],
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
