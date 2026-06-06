import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';
import { CodingReplayAnchorService } from './coding-replay-anchor.service';

describe('CodingReplayAnchorService', () => {
  function createRepository(setting: Setting | null = null) {
    const store = new Map<string, Setting>();
    if (setting) {
      store.set(setting.key, setting);
    }

    return {
      findOne: jest.fn(({ where }: { where: { key: string } }) => (
        Promise.resolve(store.get(where.key) ?? null)
      )),
      create: jest.fn((data: Partial<Setting>) => data as Setting),
      save: jest.fn((data: Setting) => {
        store.set(data.key, data);
        return Promise.resolve(data);
      })
    } as unknown as Repository<Setting> & {
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };
  }

  it('returns configured replay anchors for a unit variable', async () => {
    const repository = createRepository({
      key: 'workspace-7-replay-anchor-overrides',
      content: JSON.stringify([
        { unitName: 'UNIT', variableId: 'VAR', replayAnchor: 'TEXT_ANCHOR' }
      ])
    });
    const service = new CodingReplayAnchorService(repository);

    await expect(
      service.resolveVariableAnchor(7, 'UNIT', 'VAR')
    ).resolves.toBe('TEXT_ANCHOR');
  });

  it('builds multiple unit anchor maps from one settings read', async () => {
    const repository = createRepository({
      key: 'workspace-7-replay-anchor-overrides',
      content: JSON.stringify([
        { unitName: 'UNIT_A', variableId: 'VAR_A', replayAnchor: 'ANCHOR_A' },
        { unitName: 'UNIT_B', variableId: 'VAR_B', replayAnchor: 'ANCHOR_B' }
      ])
    });
    const service = new CodingReplayAnchorService(repository);

    const maps = await service.getVariableAnchorMaps(['UNIT_A', 'UNIT_B'], 7);

    expect(maps.get('UNIT_A')?.get('VAR_A')).toBe('ANCHOR_A');
    expect(maps.get('UNIT_B')?.get('VAR_B')).toBe('ANCHOR_B');
    expect(repository.findOne).toHaveBeenCalledTimes(1);
  });

  it('falls back to the variable id without an override', async () => {
    const service = new CodingReplayAnchorService(createRepository());

    await expect(
      service.resolveVariableAnchor(7, 'UNIT', 'VAR')
    ).resolves.toBe('VAR');
  });

  it('stores one override per unit variable', async () => {
    const repository = createRepository({
      key: 'workspace-7-replay-anchor-overrides',
      content: JSON.stringify([
        { unitName: 'UNIT', variableId: 'VAR', replayAnchor: 'OLD_ANCHOR' }
      ])
    });
    const service = new CodingReplayAnchorService(repository);

    await service.upsertOverride(7, {
      unitName: 'UNIT',
      variableId: 'VAR',
      replayAnchor: 'NEW_ANCHOR'
    });

    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        content: JSON.stringify([
          { unitName: 'UNIT', variableId: 'VAR', replayAnchor: 'NEW_ANCHOR' }
        ])
      })
    );
  });

  it('reads updates written by another service instance after an empty read', async () => {
    const repository = createRepository();
    const codingListInstance = new CodingReplayAnchorService(repository);
    const adminInstance = new CodingReplayAnchorService(repository);

    await expect(
      codingListInstance.resolveVariableAnchor(7, 'UNIT', 'VAR')
    ).resolves.toBe('VAR');

    await adminInstance.upsertOverride(7, {
      unitName: 'UNIT',
      variableId: 'VAR',
      replayAnchor: 'TEXT/Anchor 1'
    });

    await expect(
      codingListInstance.resolveVariableAnchor(7, 'UNIT', 'VAR')
    ).resolves.toBe('TEXT/Anchor 1');
  });

  it('reads updates written with a route-string workspace id', async () => {
    const repository = createRepository();
    const codingListInstance = new CodingReplayAnchorService(repository);
    const adminInstance = new CodingReplayAnchorService(repository);
    const routeWorkspaceId = '7' as unknown as number;

    await expect(
      codingListInstance.resolveVariableAnchor(7, 'UNIT', 'VAR')
    ).resolves.toBe('VAR');

    await adminInstance.upsertOverride(routeWorkspaceId, {
      unitName: 'UNIT',
      variableId: 'VAR',
      replayAnchor: 'TEXT/Anchor 1'
    });

    await expect(
      codingListInstance.resolveVariableAnchor(7, 'UNIT', 'VAR')
    ).resolves.toBe('TEXT/Anchor 1');
  });
});
