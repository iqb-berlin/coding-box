import { Logger } from '@nestjs/common';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { getManualCodingScopeKey } from '../../utils/manual-coding-scope.util';

describe('WorkspaceFileMetadataService.onModuleInit', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFileMetadataService>;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawMany: jest.fn()
  };

  const mockFileUploadRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
  };

  function makeService(): WorkspaceFileMetadataService {
    return new WorkspaceFileMetadataService(mockFileUploadRepository as unknown as CtorParams[0],
      { delete: jest.fn() } as unknown as CtorParams[1],
      undefined as never
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should refresh the startup unit variable cache for raw workspace_id values', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([{ workspace_id: '1' }]);
    const service = makeService();
    const refreshSpy = jest
      .spyOn(service, 'refreshUnitVariableCache')
      .mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(1);
    expect(refreshSpy).not.toHaveBeenCalledWith(undefined);
  });

  it('should skip invalid startup workspace ids', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([{ workspace_id: null }]);
    const service = makeService();
    const refreshSpy = jest
      .spyOn(service, 'refreshUnitVariableCache')
      .mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error');

    await service.onModuleInit();

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      'Skipping unit variable cache refresh for invalid workspace id: null'
    );
  });

  it('should reuse one unit variable cache refresh for concurrent workspace requests', async () => {
    const service = makeService();
    let resolveRefresh: () => void = () => undefined;
    const refreshSpy = jest
      .spyOn(
        service as unknown as {
          refreshUnitVariableCacheInternal: (workspaceId: number) => Promise<void>;
        },
        'refreshUnitVariableCacheInternal'
      )
      .mockImplementation(
        () => new Promise<void>(resolve => {
          resolveRefresh = resolve;
        })
      );

    const firstRefresh = service.refreshUnitVariableCache(4);
    const secondRefresh = service.refreshUnitVariableCache(4);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(4);

    resolveRefresh();
    await Promise.all([firstRefresh, secondRefresh]);
  });
});

describe('WorkspaceFileMetadataService.getUnitVariableDetails', () => {
  type CtorParams = ConstructorParameters<typeof WorkspaceFileMetadataService>;
  const cacheStore = new Map<string, unknown>();

  const unitXml = `
    <Unit>
      <Metadata><Id>UnitA</Id></Metadata>
      <BaseVariables>
        <Variable id="B1" alias="base_alias" type="string" multiple="1" nullable="false">
          <Values complete="1">
            <Value><label>Alpha</label><value>A</value></Value>
            <Value><label>Beta</label><value>B</value></Value>
          </Values>
          <ValuePositionLabels>
            <ValuePositionLabel>First option</ValuePositionLabel>
            <ValuePositionLabel>Second option</ValuePositionLabel>
          </ValuePositionLabels>
        </Variable>
        <Variable id="04" alias="02" type="string" />
        <Variable id="07" alias="04" type="string" />
        <Variable alias="derived_alias" type="integer" />
      </BaseVariables>
      <DerivedVariables>
        <Variable id="DX" alias="xml_derived_alias" type="boolean" />
      </DerivedVariables>
    </Unit>
  `;

  const codingScheme = {
    version: '3.2',
    variableCodings: [
      {
        id: 'B1',
        alias: 'base_alias',
        sourceType: 'BASE',
        type: 'string',
        processing: ['TAKE_EMPTY_AS_VALID'],
        codes: []
      },
      {
        id: '04',
        alias: '02',
        sourceType: 'BASE',
        type: 'string',
        codes: []
      },
      {
        id: '07',
        alias: '04',
        sourceType: 'BASE',
        type: 'string',
        codes: []
      },
      {
        id: 'D1',
        alias: 'derived_alias',
        sourceType: 'MANUAL',
        type: 'integer',
        deriveSources: ['B1'],
        codes: [{
          id: 1,
          label: 'Code 1',
          score: 1,
          manualInstruction: '<p>Manual</p>'
        }]
      },
      {
        id: 'DX',
        alias: 'xml_derived_alias',
        sourceType: 'MANUAL',
        type: 'boolean',
        deriveSources: ['base_alias'],
        codes: []
      },
      {
        id: 'S1',
        alias: 'scheme_only_alias',
        sourceType: 'SUM_SCORE',
        type: 'number',
        codes: [{ id: 2, label: 'Code 2', score: 2 }]
      },
      {
        id: 'G1',
        alias: 'general_instruction_only',
        sourceType: 'MANUAL',
        type: 'string',
        manualInstruction: '<p>General instruction only</p>',
        codes: [{
          id: 3,
          label: 'Code 3',
          score: 3,
          manualInstruction: ''
        }]
      },
      {
        id: 'N1',
        alias: 'excluded_alias',
        sourceType: 'BASE_NO_VALUE',
        type: 'string',
        codes: []
      }
    ]
  };

  const unitFiles = [
    {
      workspace_id: 1,
      file_type: 'Unit',
      file_id: 'UnitA',
      data: Buffer.from(unitXml)
    }
  ];

  const codingSchemes = [
    {
      workspace_id: 1,
      file_type: 'Resource',
      file_id: 'UnitA.VOCS',
      data: JSON.stringify(codingScheme)
    }
  ];

  const mockFileUploadRepository = {
    find: jest.fn()
  };
  const mockCacheService = {
    get: jest.fn((key: string) => Promise.resolve(cacheStore.get(key) || null)),
    set: jest.fn((key: string, value: unknown) => {
      cacheStore.set(key, value);
      return Promise.resolve(true);
    }),
    delete: jest.fn((key: string) => {
      cacheStore.delete(key);
      return Promise.resolve(true);
    })
  };

  function makeService(): WorkspaceFileMetadataService {
    return new WorkspaceFileMetadataService(mockFileUploadRepository as unknown as CtorParams[0],
      mockCacheService as unknown as CtorParams[1],
      undefined as never
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    cacheStore.clear();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockFileUploadRepository.find.mockImplementation(({ where }) => {
      if (where.file_type === 'Unit') {
        return Promise.resolve(unitFiles);
      }
      if (where.file_type === 'Resource') {
        return Promise.resolve(codingSchemes);
      }
      return Promise.resolve([]);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should mark base XML variables as derived when the VOCS sourceType is derived', async () => {
    const service = makeService();

    const [unit] = await service.getUnitVariableDetails(1);
    const derivedFromScheme = unit.variables.find(variable => variable.alias === 'derived_alias');
    const baseVariable = unit.variables.find(variable => variable.alias === 'base_alias');

    expect(baseVariable).toMatchObject({
      id: 'B1',
      alias: 'base_alias',
      isDerived: false,
      multiple: true,
      nullable: false,
      processing: ['TAKE_EMPTY_AS_VALID'],
      valuesComplete: true,
      values: [
        { value: 'A', label: 'Alpha' },
        { value: 'B', label: 'Beta' }
      ],
      valuePositionLabels: ['First option', 'Second option']
    });
    expect(derivedFromScheme).toMatchObject({
      id: 'D1',
      alias: 'derived_alias',
      type: 'integer',
      isDerived: true
    });
  });

  it('should keep schema ids separate from aliases when ids collide with other aliases', async () => {
    const service = makeService();

    const [unit] = await service.getUnitVariableDetails(1);
    const visibleVariable02 = unit.variables.find(variable => variable.alias === '02');
    const visibleVariable04 = unit.variables.find(variable => variable.alias === '04');

    expect(visibleVariable02).toMatchObject({
      id: '04',
      alias: '02',
      sourceType: 'BASE'
    });
    expect(visibleVariable04).toMatchObject({
      id: '07',
      alias: '04',
      sourceType: 'BASE'
    });
  });

  it('should include XML-derived and scheme-only derived variables', async () => {
    const service = makeService();

    const [unit] = await service.getUnitVariableDetails(1);
    const xmlDerived = unit.variables.find(variable => variable.alias === 'xml_derived_alias');
    const schemeOnlyDerived = unit.variables.find(variable => variable.alias === 'scheme_only_alias');
    const excludedVariable = unit.variables.find(variable => variable.alias === 'excluded_alias');

    expect(xmlDerived).toMatchObject({
      id: 'DX',
      alias: 'xml_derived_alias',
      isDerived: true
    });
    expect(schemeOnlyDerived).toMatchObject({
      id: 'S1',
      alias: 'scheme_only_alias',
      type: 'number',
      isDerived: true
    });
    expect(excludedVariable).toBeUndefined();
  });

  it('should resolve derived variable source mappings from deriveSources', async () => {
    const service = makeService();

    const sourceMap = await service.getDerivedVariablesBySourceMap(1);

    expect(sourceMap.get(getManualCodingScopeKey('UnitA', 'base_alias')))
      .toEqual(new Set(['derived_alias', 'xml_derived_alias']));
    expect(mockCacheService.set).toHaveBeenCalledWith(
      'workspace_files:v2:derived_variables_by_source:1',
      {
        [getManualCodingScopeKey('UnitA', 'base_alias')]: [
          'derived_alias',
          'xml_derived_alias'
        ]
      }
    );
  });

  it('should expose derived metadata only after a complete refresh', async () => {
    const service = makeService();

    const metadata = await service.getDerivedVariableMetadata(1);

    expect(metadata.metadataAvailable).toBe(true);
    expect(metadata.derivedVariableMap.get('UnitA')).toEqual(new Set([
      'derived_alias',
      'xml_derived_alias',
      'scheme_only_alias',
      'general_instruction_only'
    ]));
    expect(
      metadata.derivedVariablesBySourceMap.get(
        getManualCodingScopeKey('UnitA', 'base_alias')
      )
    ).toEqual(new Set(['derived_alias', 'xml_derived_alias']));
    expect(cacheStore.get(
      'workspace_files:v2:derived_variable_metadata_complete:1'
    )).toBe(true);
  });

  it('should mark derived metadata unavailable after a parsing error', async () => {
    mockFileUploadRepository.find.mockImplementation(({ where }) => {
      if (where.file_type === 'Unit') {
        return Promise.resolve(unitFiles);
      }
      if (where.file_type === 'Resource') {
        return Promise.resolve([{
          ...codingSchemes[0],
          data: '{invalid json'
        }]);
      }
      return Promise.resolve([]);
    });
    const service = makeService();

    const metadata = await service.getDerivedVariableMetadata(1);

    expect(metadata).toEqual({
      metadataAvailable: false,
      derivedVariableMap: new Map(),
      derivedVariablesBySourceMap: new Map()
    });
    expect(cacheStore.get(
      'workspace_files:v2:derived_variable_metadata_complete:1'
    )).toBe(false);
  });

  it('should cache variables with manual instructions by response alias', async () => {
    const service = makeService();

    const manualInstructionMap = await service.getManualInstructionVariableMap(1);

    expect(manualInstructionMap.get('UnitA')).toEqual(new Set(['derived_alias']));
    expect(mockCacheService.set).toHaveBeenCalledWith(
      'workspace_files:v2:manual_instruction_variables:1',
      {
        UnitA: ['derived_alias']
      }
    );
  });

  it('should not treat variable-level instructions as selectable manual codes', async () => {
    const service = makeService();

    const manualInstructionMap = await service.getManualInstructionVariableMap(1);

    expect(manualInstructionMap.get('UnitA'))
      .not.toContain('general_instruction_only');
  });
});
