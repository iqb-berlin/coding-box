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
});
