import { NotFoundException } from '@nestjs/common';
import { WorkspaceSettingsService } from './workspace-settings.service';
import { JournalService } from '../database/services/shared/journal.service';

describe('WorkspaceSettingsService transactions', () => {
  const store = new Map<string, { key: string; content: string }>();
  let service: WorkspaceSettingsService;
  let recordEvent: jest.SpyInstance;
  let transaction: jest.Mock;
  let save: jest.Mock;
  let manager: { getRepository: jest.Mock };

  beforeEach(() => {
    store.clear();
    recordEvent = jest.spyOn(JournalService, 'recordEventInTransaction').mockResolvedValue({} as never);
    transaction = jest.fn(async callback => {
      const pending = new Map([...store].map(([key, value]) => [key, { ...value }]));
      save = jest.fn(async value => { pending.set(value.key, value); return value; });
      manager = {
        getRepository: jest.fn(() => ({
          findOne: jest.fn(async ({ where }) => pending.get(where.key) ?? null),
          create: jest.fn(value => value),
          save,
          delete: jest.fn(async ({ key }) => ({ affected: pending.delete(key) ? 1 : 0 }))
        }))
      };
      const result = await callback(manager);
      store.clear();
      pending.forEach((value, key) => store.set(key, value));
      return result;
    });
    service = new WorkspaceSettingsService({
      manager: { transaction },
      findOne: jest.fn(async ({ where }) => store.get(where.key) ?? null)
    } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('records single writes with the actor inside their only transaction', async () => {
    await service.createWorkspaceSetting(5, { key: 'evaluation-mode', value: '{"enabled":true}' }, 9);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith(manager, expect.objectContaining({
      workspaceId: 5,
      actorUserId: 9,
      actorType: 'user',
      eventType: 'WORKSPACE_SETTINGS_CHANGED',
      details: { keys: ['workspace-5-evaluation-mode'], operation: 'save' }
    }));
    expect(store.get('workspace-5-evaluation-mode')?.content).toBe('{"enabled":true}');
  });
  it('keeps batch writes atomic if their transactional audit fails', async () => {
    store.set('workspace-5-first', { key: 'workspace-5-first', content: 'before' });
    recordEvent.mockRejectedValueOnce(new Error('Synthetic transaction failure'));
    await expect(service.createWorkspaceSettings(5, {
      settings: [{ key: 'first', value: 'after' }, { key: 'second', value: 'new' }]
    }, 9)).rejects.toThrow('Synthetic transaction failure');
    expect(store.get('workspace-5-first')?.content).toBe('before');
    expect(store.has('workspace-5-second')).toBe(false);
    expect(recordEvent).toHaveBeenCalledWith(manager, expect.objectContaining({
      details: { keys: ['workspace-5-first', 'workspace-5-second'], operation: 'save' }
    }));
  });
  it('does not write an audit event for an empty batch', async () => {
    expect(await service.createWorkspaceSettings(5, { settings: [] }, 9)).toEqual([]);
    expect(recordEvent).not.toHaveBeenCalled();
  });
  it('retains update and delete actor metadata and the same manager', async () => {
    store.set('workspace-5-mode', { key: 'workspace-5-mode', content: 'old' });
    await service.updateWorkspaceSetting(5, 'workspace-5-mode', { value: 'new' }, 9);
    expect(recordEvent).toHaveBeenLastCalledWith(manager, expect.objectContaining({
      actorUserId: 9, details: { keys: ['workspace-5-mode'], operation: 'update' }
    }));
    await service.deleteWorkspaceSetting(5, 'workspace-5-mode', 9);
    expect(recordEvent).toHaveBeenLastCalledWith(manager, expect.objectContaining({
      actorUserId: 9, details: { keys: ['workspace-5-mode'], operation: 'delete' }
    }));
    expect(store.size).toBe(0);
  });
  it('preserves missing-update and missing-delete behavior without audit writes', async () => {
    await expect(service.updateWorkspaceSetting(5, 'workspace-5-missing', { value: 'new' }, 9))
      .rejects.toBeInstanceOf(NotFoundException);
    await expect(service.deleteWorkspaceSetting(5, 'workspace-5-missing', 9)).rejects.toBeInstanceOf(NotFoundException);
    expect(recordEvent).not.toHaveBeenCalled();
  });
});
