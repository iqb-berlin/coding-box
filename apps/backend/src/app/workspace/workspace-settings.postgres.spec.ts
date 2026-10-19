import { DataSource } from 'typeorm';
import { BadRequestException, Logger } from '@nestjs/common';
import { Setting } from '../database/entities/setting.entity';
import { JournalEntry } from '../database/entities/journal-entry.entity';
import { WorkspaceSettingsService } from './workspace-settings.service';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Workspace settings with PostgreSQL', () => {
  const schema = `settings_${process.pid}_${Date.now()}`;
  let db: DataSource;
  let service: WorkspaceSettingsService;

  beforeAll(async () => {
    db = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: Number(process.env.POSTGRES_PORT || 5432),
      username: process.env.POSTGRES_USER || 'root',
      password: process.env.POSTGRES_PASSWORD || 'root-password',
      database: process.env.POSTGRES_DB || 'coding-box',
      schema,
      entities: [Setting, JournalEntry],
      synchronize: false,
      extra: { max: 2, connectionTimeoutMillis: 2000 }
    });
    await db.initialize();
    await db.query(`CREATE SCHEMA "${schema}"`);
    // Dedicated fixture tables only; never synchronize or reset an application schema.
    await db.query(`CREATE TABLE "${schema}".setting (
      key VARCHAR PRIMARY KEY, content TEXT NOT NULL,
      CONSTRAINT reject_fixture CHECK (content <> 'reject-fixture'))`);
    await db.query(`CREATE TABLE "${schema}".journal_entries (
      id SERIAL PRIMARY KEY, timestamp TIMESTAMP NOT NULL DEFAULT now(),
      user_id VARCHAR NOT NULL, actor_user_id INTEGER, actor_type VARCHAR(20) NOT NULL DEFAULT 'user',
      workspace_id INTEGER NOT NULL, action_type VARCHAR NOT NULL, event_type VARCHAR(100),
      entity_type VARCHAR NOT NULL, entity_id VARCHAR(255), result VARCHAR(20) NOT NULL DEFAULT 'success',
      summary TEXT, correlation_id VARCHAR(255), job_id VARCHAR(255), details JSONB)`);
    service = new WorkspaceSettingsService(db.getRepository(Setting));
  });
  beforeEach(async () => {
    await db.query(`TRUNCATE "${schema}".setting, "${schema}".journal_entries`);
  });
  afterAll(async () => {
    if (db?.isInitialized) {
      try { await db.query(`DROP SCHEMA "${schema}" CASCADE`); } finally { await db.destroy(); }
    }
  });

  it('reads existing keys and commits CRUD with the actor and journal events', async () => {
    await db.getRepository(Setting).save({ key: 'workspace-5-existing', content: 'before' });
    expect(await service.getWorkspaceSetting(5, 'existing')).toMatchObject({ value: 'before' });
    await service.createWorkspaceSettings(5, {
      settings: [
        { key: 'existing', value: 'after' }, { key: 'enable-regex-search', value: '{"enabled":true}' }
      ]
    }, 9);
    expect(await service.isRegexSearchEnabled(5)).toBe(true);
    await service.updateWorkspaceSetting(5, 'workspace-5-existing', { value: 'updated' }, 9);
    await service.deleteWorkspaceSetting(5, 'workspace-5-existing', 9);
    expect(await db.getRepository(Setting).findOneBy({ key: 'workspace-5-existing' })).toBeNull();
    const entries = await db.getRepository(JournalEntry).find({ order: { id: 'ASC' } });
    expect(entries.map(entry => entry.details?.operation)).toEqual(['save', 'update', 'delete']);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        workspaceId: 5, actorUserId: 9, actorType: 'user', eventType: 'WORKSPACE_SETTINGS_CHANGED'
      });
    }
  });
  it('rolls back earlier settings if a later database write fails', async () => {
    await db.getRepository(Setting).save({ key: 'workspace-5-first', content: 'before' });
    await expect(service.createWorkspaceSettings(5, {
      settings: [
        { key: 'first', value: 'after' }, { key: 'second', value: 'reject-fixture' }
      ]
    }, 9)).rejects.toThrow();
    expect(await db.getRepository(Setting).find()).toEqual([{ key: 'workspace-5-first', content: 'before' }]);
    expect(await db.getRepository(JournalEntry).count()).toBe(0);
  });
  it('rolls back settings if the audit insert fails in the same transaction', async () => {
    await db.query(`ALTER TABLE "${schema}".journal_entries ADD CONSTRAINT reject_audit CHECK (workspace_id <> 17)`);
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      await expect(service.createWorkspaceSetting(17, { key: 'mode', value: 'new' }, 9))
        .rejects.toThrow('Failed to record audit journal event');
      expect(await db.getRepository(Setting).count()).toBe(0);
      expect(await db.getRepository(JournalEntry).count()).toBe(0);
    } finally {
      log.mockRestore();
      await db.query(`ALTER TABLE "${schema}".journal_entries DROP CONSTRAINT reject_audit`);
    }
  });
  it('rejects foreign workspace keys without changing persistence or journal', async () => {
    await db.getRepository(Setting).save({ key: 'workspace-6-mode', content: 'unchanged' });
    await expect(service.updateWorkspaceSetting(5, 'workspace-6-mode', { value: 'new' }, 9))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.deleteWorkspaceSetting(5, 'workspace-6-mode', 9)).rejects.toBeInstanceOf(BadRequestException);
    expect(await db.getRepository(Setting).findOneByOrFail({ key: 'workspace-6-mode' }))
      .toMatchObject({ content: 'unchanged' });
    expect(await db.getRepository(JournalEntry).count()).toBe(0);
  });
});
