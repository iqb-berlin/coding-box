import { ResponseEntity } from '../../entities/response.entity';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingItemBuilderService } from './coding-item-builder.service';

describe('CodingItemBuilderService', () => {
  const createService = () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;

    return new CodingItemBuilderService(fileCacheService);
  };

  const createResponse = (value: string): ResponseEntity => ({
    id: 1,
    variableid: 'VAR1',
    value,
    status_v1: null,
    code_v1: null,
    score_v1: null,
    unit: {
      name: 'UNIT1',
      alias: 'Unit 1',
      booklet: {
        person: { login: 'login', code: 'code', group: 'group' },
        bookletinfo: { name: 'BOOKLET1' }
      }
    }
  } as unknown as ResponseEntity);

  it('replaces GeoGebra response values with a placeholder by default', async () => {
    await expect(
      createService().buildCodingItemWithVersions(
        createResponse('UEsDBA=='),
        'v1',
        'token',
        'http://server',
        1
      )
    ).resolves.toMatchObject({
      value: '[GeoGebra]'
    });
  });

  it('includes raw GeoGebra response values when explicitly enabled', async () => {
    await expect(
      createService().buildCodingItemWithVersions(
        createResponse('UEsDBA=='),
        'v1',
        'token',
        'http://server',
        1,
        false,
        true,
        true
      )
    ).resolves.toMatchObject({
      value: 'UEsDBA=='
    });
  });
});
