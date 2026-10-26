import { DataSource } from 'typeorm';
import { withPostgresLockSession } from './postgres-lock-session.util';

const RESOURCE_PACKAGE_LOCK_NAMESPACE = 774020255;

// Package directories are shared across workspaces, and names are case insensitive.
export async function withResourcePackageLock<T>(connection: DataSource, name: string, callback: () => Promise<T>): Promise<T> {
  return withPostgresLockSession(connection, async runner => {
    const key = [RESOURCE_PACKAGE_LOCK_NAMESPACE, name];
    await runner.query('SELECT pg_advisory_lock($1::int, hashtext(LOWER($2::text)))', key);
    try {
      return await callback();
    } finally {
      await runner.query('SELECT pg_advisory_unlock($1::int, hashtext(LOWER($2::text)))', key);
    }
  });
}
