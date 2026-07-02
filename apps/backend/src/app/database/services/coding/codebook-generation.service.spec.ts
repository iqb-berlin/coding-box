import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CodebookGenerationService } from './codebook-generation.service';
import { CodebookGenerator } from '../../../admin/code-book/codebook-generator.class';
import { CodeBookContentSetting } from '../../../admin/code-book/codebook.interfaces';

jest.mock('../../../admin/code-book/codebook-generator.class', () => ({
  CodebookGenerator: {
    generateCodebook: jest.fn()
  }
}));

const contentOptions: CodeBookContentSetting = {
  exportFormat: 'json',
  missingsProfile: '',
  hasOnlyManualCoding: false,
  hasGeneralInstructions: true,
  hasDerivedVars: true,
  hasOnlyVarsWithCodes: false,
  hasClosedVars: true,
  codeLabelToUpper: false,
  showScore: true,
  hideItemVarRelation: false
};

describe('CodebookGenerationService', () => {
  const repository = {
    find: jest.fn()
  };
  const jobDefinitionRepository = {
    findOne: jest.fn()
  };
  const variableBundleRepository = {
    find: jest.fn()
  };
  const missingsProfilesService = {
    getMissingsProfileDetails: jest.fn()
  };
  let service: CodebookGenerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CodebookGenerationService(
      repository as never,
      jobDefinitionRepository as never,
      variableBundleRepository as never,
      missingsProfilesService as never
    );
    (CodebookGenerator.generateCodebook as jest.Mock).mockResolvedValue(
      Buffer.from('[]')
    );
  });

  it('loads codebook units only from the requested workspace and preserves request order', async () => {
    repository.find.mockResolvedValue([
      {
        id: 2,
        file_id: 'UNIT-B.VOCS',
        filename: 'unit-b.vocs',
        data: '{}',
        structured_data: { metadata: { items: [{ key: 'I1', label: 'Item 1' }] } }
      },
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: '{}',
        structured_data: null
      }
    ]);

    await service.generateCodebook(7, 0, contentOptions, [1, 2, 1]);

    const query = repository.find.mock.calls[0][0];
    expect(query.where).toMatchObject({
      workspace_id: 7,
      file_type: 'Resource'
    });
    expect(query.where.id.value).toEqual([1, 2]);
    expect(query.where.file_id.value).toBe('%.VOCS');
    expect(CodebookGenerator.generateCodebook).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: 1, key: 'UNIT-A.VOCS', name: 'unit-a' }),
        expect.objectContaining({
          id: 2,
          key: 'UNIT-B.VOCS',
          name: 'unit-b',
          metadata: { items: [{ key: 'I1', label: 'Item 1' }] }
        })
      ],
      contentOptions,
      []
    );
  });

  it('limits generated codebook variables to the selected job definition', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            {
              id: 'VAR_A',
              alias: 'PUBLIC_A',
              sourceType: 'BASE',
              codes: []
            },
            {
              id: 'VAR_B',
              alias: 'PUBLIC_B',
              sourceType: 'BASE',
              codes: []
            }
          ]
        }),
        structured_data: null
      },
      {
        id: 2,
        file_id: 'UNIT-B.VOCS',
        filename: 'unit-b.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'VAR_C', sourceType: 'BASE', codes: [] }
          ]
        }),
        structured_data: null
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue({
      assigned_variables: [
        { unitName: 'UNIT-A', variableId: 'PUBLIC_B' }
      ],
      assigned_variable_bundles: [
        {
          id: 5,
          name: 'Bundle'
        }
      ]
    });
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 5,
        workspace_id: 7,
        name: 'Bundle',
        variables: [{ unitName: 'UNIT-B', variableId: 'VAR_C' }]
      }
    ]);

    await service.generateCodebook(7, 0, {
      ...contentOptions,
      jobDefinitionId: 12
    }, [1, 2]);

    expect(jobDefinitionRepository.findOne).toHaveBeenCalledWith({
      where: { id: 12, workspace_id: 7 }
    });
    expect(variableBundleRepository.find).toHaveBeenCalledWith({
      where: { id: expect.objectContaining({ value: [5] }), workspace_id: 7 }
    });
    const scopedUnits = (CodebookGenerator.generateCodebook as jest.Mock)
      .mock.calls[0][0] as Array<{ key: string; scheme: string }>;
    expect(scopedUnits.map(unit => unit.key)).toEqual([
      'UNIT-A.VOCS',
      'UNIT-B.VOCS'
    ]);
    expect(JSON.parse(scopedUnits[0].scheme).variableCodings).toEqual([
      expect.objectContaining({ id: 'VAR_B' })
    ]);
    expect(JSON.parse(scopedUnits[1].scheme).variableCodings).toEqual([
      expect.objectContaining({ id: 'VAR_C' })
    ]);
  });

  it('prefers public aliases over colliding technical ids when filtering codebook variables', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'DHB003.VOCS',
        filename: 'DHB003.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            {
              id: '04',
              alias: '02',
              sourceType: 'BASE',
              codes: []
            },
            {
              id: '07',
              alias: '04',
              sourceType: 'BASE',
              codes: []
            }
          ]
        }),
        structured_data: null
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue({
      assigned_variables: [
        { unitName: 'DHB003', variableId: '04' }
      ],
      assigned_variable_bundles: []
    });
    variableBundleRepository.find.mockResolvedValue([]);

    await service.generateCodebook(7, 0, {
      ...contentOptions,
      jobDefinitionId: 12
    }, [1]);

    const scopedUnits = (CodebookGenerator.generateCodebook as jest.Mock)
      .mock.calls[0][0] as Array<{ key: string; scheme: string }>;
    expect(JSON.parse(scopedUnits[0].scheme).variableCodings).toEqual([
      expect.objectContaining({ id: '07', alias: '04' })
    ]);
  });

  it('limits generated codebook variables to selected variable bundles', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'VAR_A', sourceType: 'BASE', codes: [] }
          ]
        }),
        structured_data: null
      },
      {
        id: 2,
        file_id: 'UNIT-B.VOCS',
        filename: 'unit-b.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'VAR_B', sourceType: 'BASE', codes: [] },
            { id: 'VAR_C', sourceType: 'BASE', codes: [] }
          ]
        }),
        structured_data: null
      }
    ]);
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 8,
        workspace_id: 7,
        name: 'Bundle',
        variables: [{ unitName: 'UNIT-B', variableId: 'VAR_C' }]
      }
    ]);

    await service.generateCodebook(7, 0, {
      ...contentOptions,
      variableBundleIds: [8]
    }, [1, 2]);

    expect(jobDefinitionRepository.findOne).not.toHaveBeenCalled();
    expect(variableBundleRepository.find).toHaveBeenCalledWith({
      where: { id: expect.objectContaining({ value: [8] }), workspace_id: 7 }
    });
    const scopedUnits = (CodebookGenerator.generateCodebook as jest.Mock)
      .mock.calls[0][0] as Array<{ key: string; scheme: string }>;
    expect(scopedUnits.map(unit => unit.key)).toEqual(['UNIT-B.VOCS']);
    expect(JSON.parse(scopedUnits[0].scheme).variableCodings).toEqual([
      expect.objectContaining({ id: 'VAR_C' })
    ]);
  });

  it('combines job definition and variable bundle filters as an intersection', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'VAR_A', sourceType: 'BASE', codes: [] }
          ]
        }),
        structured_data: null
      },
      {
        id: 2,
        file_id: 'UNIT-B.VOCS',
        filename: 'unit-b.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            {
              id: 'VAR_B',
              alias: 'PUBLIC_B',
              sourceType: 'BASE',
              codes: []
            }
          ]
        }),
        structured_data: null
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue({
      assigned_variables: [
        { unitName: 'UNIT-A', variableId: 'VAR_A' },
        { unitName: 'UNIT-B', variableId: 'PUBLIC_B' }
      ],
      assigned_variable_bundles: []
    });
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 8,
        workspace_id: 7,
        name: 'Bundle',
        variables: [{ unitName: 'UNIT-B', variableId: 'VAR_B' }]
      }
    ]);

    await service.generateCodebook(7, 0, {
      ...contentOptions,
      jobDefinitionId: 12,
      variableBundleIds: [8]
    }, [1, 2]);

    const scopedUnits = (CodebookGenerator.generateCodebook as jest.Mock)
      .mock.calls[0][0] as Array<{ key: string; scheme: string }>;
    expect(scopedUnits.map(unit => unit.key)).toEqual(['UNIT-B.VOCS']);
    expect(JSON.parse(scopedUnits[0].scheme).variableCodings).toEqual([
      expect.objectContaining({ id: 'VAR_B' })
    ]);
  });

  it('uses hydrated job definition bundle variables instead of stale stored bundle variables', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'OLD_VAR', sourceType: 'BASE', codes: [] },
            { id: 'NEW_VAR', sourceType: 'BASE', codes: [] }
          ]
        }),
        structured_data: null
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue({
      assigned_variables: [],
      assigned_variable_bundles: [
        {
          id: 5,
          name: 'Bundle',
          variables: [{ unitName: 'UNIT-A', variableId: 'OLD_VAR' }]
        }
      ]
    });
    variableBundleRepository.find.mockResolvedValue([
      {
        id: 5,
        workspace_id: 7,
        name: 'Bundle',
        variables: [{ unitName: 'UNIT-A', variableId: 'NEW_VAR' }]
      }
    ]);

    await service.generateCodebook(7, 0, {
      ...contentOptions,
      jobDefinitionId: 12
    }, [1]);

    const scopedUnits = (CodebookGenerator.generateCodebook as jest.Mock)
      .mock.calls[0][0] as Array<{ key: string; scheme: string }>;
    expect(JSON.parse(scopedUnits[0].scheme).variableCodings).toEqual([
      expect.objectContaining({ id: 'NEW_VAR' })
    ]);
  });

  it('rejects missing variable bundles referenced by a selected job definition', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'VAR_A', sourceType: 'BASE', codes: [] }
          ]
        }),
        structured_data: null
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue({
      assigned_variables: [{ unitName: 'UNIT-A', variableId: 'VAR_A' }],
      assigned_variable_bundles: [
        {
          id: 5,
          name: 'Deleted Bundle',
          variables: [{ unitName: 'UNIT-A', variableId: 'VAR_A' }]
        }
      ]
    });
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(
      service.generateCodebook(7, 0, {
        ...contentOptions,
        jobDefinitionId: 12
      }, [1])
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(CodebookGenerator.generateCodebook).not.toHaveBeenCalled();
  });

  it('rejects unknown variable bundle filters', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            { id: 'VAR_A', sourceType: 'BASE', codes: [] }
          ]
        })
      }
    ]);
    variableBundleRepository.find.mockResolvedValue([]);

    await expect(
      service.generateCodebook(7, 0, {
        ...contentOptions,
        variableBundleIds: [99]
      }, [1])
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(CodebookGenerator.generateCodebook).not.toHaveBeenCalled();
  });

  it('rejects unknown job definition filters', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: '{}'
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue(null);

    await expect(
      service.generateCodebook(7, 0, { ...contentOptions, jobDefinitionId: 99 }, [1])
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(CodebookGenerator.generateCodebook).not.toHaveBeenCalled();
  });

  it('rejects job definition filters without matching selected variables', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: JSON.stringify({
          version: '3.0',
          variableCodings: [
            {
              id: 'VAR_A',
              sourceType: 'BASE',
              codes: []
            }
          ]
        }),
        structured_data: null
      }
    ]);
    jobDefinitionRepository.findOne.mockResolvedValue({
      assigned_variables: [
        { unitName: 'UNIT-B', variableId: 'VAR_B' }
      ],
      assigned_variable_bundles: []
    });

    await expect(
      service.generateCodebook(7, 0, { ...contentOptions, jobDefinitionId: 12 }, [1])
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(CodebookGenerator.generateCodebook).not.toHaveBeenCalled();
  });

  it('rejects missing or foreign unit IDs', async () => {
    repository.find.mockResolvedValue([
      {
        id: 1,
        file_id: 'UNIT-A.VOCS',
        filename: 'unit-a.vocs',
        data: '{}'
      }
    ]);

    await expect(
      service.generateCodebook(7, 0, contentOptions, [1, 99])
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(CodebookGenerator.generateCodebook).not.toHaveBeenCalled();
  });

  it.each([
    [1, -2],
    [true],
    [' '],
    [1.2],
    [0]
  ])('rejects invalid unit IDs before querying: %p', async unitIds => {
    await expect(
      service.generateCodebook(7, 0, contentOptions, unitIds as never)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.find).not.toHaveBeenCalled();
  });
});
