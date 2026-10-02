import { DataSource } from 'typeorm';
import { createPostgresPoolSnapshotProvider } from './postgres-pool-monitor';

describe('createPostgresPoolSnapshotProvider', () => {
  it('returns PostgreSQL pool counters', () => {
    const dataSource = {
      driver: {
        master: {
          totalCount: 10,
          idleCount: 3,
          waitingCount: 2
        }
      }
    } as unknown as DataSource;

    expect(createPostgresPoolSnapshotProvider(dataSource)()).toEqual({
      totalCount: 10,
      idleCount: 3,
      waitingCount: 2
    });
  });

  it('returns undefined for unsupported or incomplete drivers', () => {
    const unsupported = {
      driver: {}
    } as unknown as DataSource;
    const incomplete = {
      driver: {
        master: {
          totalCount: 10,
          idleCount: 3
        }
      }
    } as unknown as DataSource;

    expect(createPostgresPoolSnapshotProvider(unsupported)()).toBeUndefined();
    expect(createPostgresPoolSnapshotProvider(incomplete)()).toBeUndefined();
  });
});
