import {
  mkdtemp, rm, writeFile, utimes
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeExpiredWorkspaceDatabase, WORKSPACE_SQLITE_RETENTION_MS } from './database-export-retention';

describe('workspace SQLite export retention', () => {
  it('removes expired or orphaned files while preserving current, recently finished and unrelated files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'database-retention-'));
    const old = new Date(Date.now() - WORKSPACE_SQLITE_RETENTION_MS - 10000);
    const getWorkspaceJob = jest.fn();
    const queues = { getWorkspaceJob } as never;
    try {
      const file = join(dir, 'workspace-7-database-export-test-job-123.sqlite');
      await writeFile(file, 'data');
      await removeExpiredWorkspaceDatabase(file, queues);
      expect(getWorkspaceJob).not.toHaveBeenCalled();
      await utimes(file, old, old);
      for (const job of [{}, { finishedOn: Date.now() }]) {
        getWorkspaceJob.mockResolvedValue(job);
        await removeExpiredWorkspaceDatabase(file, queues);
        expect(existsSync(file)).toBe(true);
      }
      for (const job of [{ finishedOn: old.getTime() }, null]) {
        await writeFile(file, 'data');
        await utimes(file, old, old);
        getWorkspaceJob.mockResolvedValue(job);
        await removeExpiredWorkspaceDatabase(file, queues);
        expect(getWorkspaceJob).toHaveBeenCalledWith(7, 'database-export', 'test-job');
        expect(existsSync(file)).toBe(false);
      }
      const systemFile = join(dir, 'database-export-job-123.sqlite');
      await writeFile(systemFile, 'data');
      await utimes(systemFile, old, old);
      await removeExpiredWorkspaceDatabase(systemFile, queues);
      expect(existsSync(systemFile)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
