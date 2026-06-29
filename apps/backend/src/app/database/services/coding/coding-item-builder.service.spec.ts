import { ResponseEntity } from '../../entities/response.entity';
import { CodingFileCacheService } from './coding-file-cache.service';
import { CodingItemBuilderService } from './coding-item-builder.service';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';

describe('CodingItemBuilderService', () => {
  const createService = (replayAnchor?: string) => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;
    const replayAnchorService = replayAnchor ?
      {
        resolveVariableAnchor: jest.fn().mockResolvedValue(replayAnchor)
      } as unknown as CodingReplayAnchorService :
      undefined;

    return new CodingItemBuilderService(fileCacheService, replayAnchorService);
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

  it('builds versioned export items from raw rows', async () => {
    await expect(
      createService().buildCodingItemWithVersionRow(
        {
          id: 1,
          unitKey: 'UNIT1',
          unitAlias: 'Unit 1',
          personLogin: 'login',
          personCode: 'code',
          personGroup: 'group',
          bookletName: 'BOOKLET1',
          variableId: 'VAR1',
          value: 'Antwort',
          statusV1: 8,
          codeV1: 1,
          scoreV1: 2,
          statusV2: null,
          codeV2: null,
          scoreV2: null,
          statusV3: null,
          codeV3: null,
          scoreV3: null
        },
        'v1',
        'token',
        'http://server',
        1
      )
    ).resolves.toMatchObject({
      unit_key: 'UNIT1',
      unit_alias: 'Unit 1',
      person_login: 'login',
      person_code: 'code',
      person_group: 'group',
      booklet_name: 'BOOKLET1',
      variable_id: 'VAR1',
      value: 'Antwort',
      status_v1: 'CODING_INCOMPLETE',
      code_v1: 1,
      score_v1: 2
    });
  });

  it('encodes replay anchor overrides in replay URLs', async () => {
    await expect(
      createService('TEXT/Anchor 1').buildCodingItem(
        createResponse('Antwort'),
        'token',
        'http://server',
        1
      )
    ).resolves.toMatchObject({
      variable_anchor: 'TEXT/Anchor 1',
      url: 'http://server/#/replay/login@code@group@BOOKLET1/UNIT1/0/TEXT%2FAnchor%201?auth=token'
    });
  });

  it('uses provided replay anchor maps without resolving anchors per item', async () => {
    const fileCacheService = {
      loadVoudData: jest.fn().mockResolvedValue(new Map())
    } as unknown as CodingFileCacheService;
    const replayAnchorService = {
      resolveVariableAnchor: jest.fn().mockResolvedValue('SHOULD_NOT_BE_USED')
    } as unknown as CodingReplayAnchorService;
    const service = new CodingItemBuilderService(fileCacheService, replayAnchorService);
    const variableAnchorMaps = new Map([
      ['UNIT1', new Map([['VAR1', 'BATCH/Anchor 1']])]
    ]);

    await expect(
      service.buildCodingItem(
        createResponse('Antwort'),
        'token',
        'http://server',
        1,
        variableAnchorMaps
      )
    ).resolves.toMatchObject({
      variable_anchor: 'BATCH/Anchor 1',
      url: 'http://server/#/replay/login@code@group@BOOKLET1/UNIT1/0/BATCH%2FAnchor%201?auth=token'
    });
    expect(replayAnchorService.resolveVariableAnchor).not.toHaveBeenCalled();
  });
});
