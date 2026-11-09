import { IsNull } from 'typeorm';
import FileUpload, { NO_CODING_SCHEME_REF_NORMALIZED } from '../../entities/file_upload.entity';
import { excludeUnitsWithoutCodingScheme } from './coding-freshness-schema-scope.util';

describe('Automatic freshness scope for tasks without a schema', () => {
  it.each([
    { data: '<Unit/>', excluded: true },
    { data: '<Unit><CodingSchemeRef/></Unit>', excluded: true },
    { data: '<Unit><CodingSchemeRef> \n\t </CodingSchemeRef></Unit>', excluded: true },
    { data: '<Unit><CodingSchemeRef> MISSING.VOCS </CodingSchemeRef></Unit>', excluded: false },
    { data: '<div>not a unit file</div>', excluded: false },
    { data: null, excluded: false }
  ])('verifies actual Unit data before excluding it ($data)', async ({ data, excluded }) => {
    const repository = { find: jest.fn().mockResolvedValue([{ file_id: 'UNIT', data } as FileUpload]) };
    const query = { andWhere: jest.fn() };
    await excludeUnitsWithoutCodingScheme(7, query as never, repository as never);

    expect(repository.find).toHaveBeenCalledWith({
      where: [
        { workspace_id: 7, file_type: 'Unit', coding_scheme_ref_normalized: NO_CODING_SCHEME_REF_NORMALIZED },
        { workspace_id: 7, file_type: 'Unit', coding_scheme_ref_normalized: IsNull() }
      ],
      select: ['file_id', 'data']
    });
    if (excluded) {
      expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('freshness.version = :manualFreshnessVersion'), {
        manualFreshnessVersion: 'v2', noCodingSchemeFileIds: ['UNIT']
      });
    } else {
      expect(query.andWhere).not.toHaveBeenCalled();
    }
  });

  it('does not exclude missing Unit files', async () => {
    const query = { andWhere: jest.fn() };
    await excludeUnitsWithoutCodingScheme(7, query as never, { find: async () => [] } as never);
    expect(query.andWhere).not.toHaveBeenCalled();
  });

  it('propagates repository failures instead of treating them as intentional omissions', async () => {
    await expect(excludeUnitsWithoutCodingScheme(7, {} as never, {
      find: async () => { throw new Error('database unavailable'); }
    } as never)).rejects.toThrow('database unavailable');
  });
});
