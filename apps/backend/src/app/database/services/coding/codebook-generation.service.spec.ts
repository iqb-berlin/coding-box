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
  const missingsProfilesService = {
    getMissingsProfileDetails: jest.fn()
  };
  let service: CodebookGenerationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CodebookGenerationService(
      repository as never,
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
