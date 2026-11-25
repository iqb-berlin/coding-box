import { randomUUID } from 'node:crypto';
import {
  mkdir, readdir, rename, rm, stat, utimes
} from 'node:fs/promises';
import { join } from 'node:path';
import sqlite3 from 'sqlite3';

export type AnalysisResultList = 'empty' | 'duplicates' | 'occurrences';
export const ANALYSIS_RESULT_TTL_SECONDS = 600;
const RESULT_GRACE_MS = 60_000;
const STAGING_TTL_MS = 60 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

function resultRoot(): string {
  return join(process.cwd(), 'temp', 'response-analysis');
}

function workspaceDirectory(workspaceId: number): string {
  if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) throw new Error('Invalid response analysis workspace');
  return join(resultRoot(), String(workspaceId));
}

export async function removeWorkspaceCodingAnalysisResults(workspaceId: number): Promise<void> {
  await rm(workspaceDirectory(workspaceId), { recursive: true, force: true });
}

function openDatabase(file: string, mode?: number): Promise<sqlite3.Database> {
  return new Promise((resolve, reject) => {
    const onOpen = (error: Error | null) => (error ? reject(error) : resolve(database));
    const database = mode === undefined ? new sqlite3.Database(file, onOpen) : new sqlite3.Database(file, mode, onOpen);
  });
}

function run(database: sqlite3.Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(sql, params, error => (error ? reject(error) : resolve()));
  });
}

function read<T>(database: sqlite3.Database, sql: string, params: unknown[]): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

function close(database: sqlite3.Database): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close(error => (error ? reject(error) : resolve()));
  });
}

export type ReadAnalysisResultItems = <T>(list: AnalysisResultList, start: number, limit: number) => Promise<T[]>;

async function readItems<T>(
  database: sqlite3.Database, list: AnalysisResultList, start: number, limit: number
): Promise<T[]> {
  if (limit <= 0) return [];
  const rows = await read<{ payload: string }>(
    database, `SELECT payload FROM ${list} WHERE seq > ? AND seq <= ? ORDER BY seq`, [start, start + limit]
  );
  return rows.map(row => JSON.parse(row.payload) as T);
}

export async function readCodingAnalysisResult<T>(
  workspaceId: number,
  resultId: string,
  readResult: (getItems: ReadAnalysisResultItems) => Promise<T>
): Promise<T | null> {
  if (!UUID_PATTERN.test(resultId)) return null;
  const file = join(workspaceDirectory(workspaceId), resultId, 'result.sqlite');
  const database = await openDatabase(file, sqlite3.OPEN_READONLY).catch(async error => {
    // A result may expire or be removed between reading its Redis pointer and opening the file.
    if ((error as { code?: string }).code === 'SQLITE_CANTOPEN' &&
        !(await stat(file).catch((cause: NodeJS.ErrnoException) => {
          if (cause.code === 'ENOENT') return null;
          throw cause;
        }))) return null;
    throw error;
  });
  if (!database) return null;
  try {
    return await readResult((list, start, limit) => readItems(database, list, start, limit));
  } finally {
    await close(database);
  }
}

export class CodingAnalysisResultWriter {
  private closed = false;

  // A private, per-run database avoids writing candidate data into the queue's Redis.
  // TEMP uses a disk-backed B-tree with a bounded page cache.
  private constructor(
    readonly resultId: string,
    private readonly staging: string,
    private readonly resultDirectory: string,
    private readonly database: sqlite3.Database
  ) {}

  static async create(workspaceId: number): Promise<CodingAnalysisResultWriter> {
    const id = randomUUID();
    const workspace = workspaceDirectory(workspaceId);
    const directory = join(workspace, `.working-${id}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const database = await openDatabase(join(directory, 'result.sqlite'));
      const writer = new CodingAnalysisResultWriter(id, directory, join(workspace, id), database);
      try {
        await writer.initialize();
        return writer;
      } catch (error) {
        await close(database);
        throw error;
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  private async initialize(): Promise<void> {
    await run(this.database, 'PRAGMA temp_store = FILE');
    await run(this.database, 'CREATE TEMP TABLE candidates (payload TEXT PRIMARY KEY) WITHOUT ROWID');
    await run(this.database, 'PRAGMA temp.cache_size = -8192');
    for (const list of ['empty', 'duplicates', 'occurrences'] as const) {
      await run(this.database, `CREATE TABLE ${list} (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL)`);
    }
    // The file only becomes visible after a successful commit and close.
    await run(this.database, 'BEGIN');
  }

  async appendCandidates(items: unknown[]): Promise<void> {
    if (items.length === 0) return;
    await run(this.database, 'INSERT INTO candidates SELECT value FROM json_each(?)', [JSON.stringify(items)]);
  }

  async readCandidatePage(after: string, limit: number): Promise<string[]> {
    const rows = await read<{ payload: string }>(
      this.database, 'SELECT payload FROM candidates WHERE payload > ? ORDER BY payload LIMIT ?', [after, limit]
    );
    return rows.map(row => row.payload);
  }

  async appendItems(list: AnalysisResultList, items: unknown[]): Promise<void> {
    if (items.length === 0) return;
    await run(this.database, `INSERT INTO ${list} (payload) SELECT value FROM json_each(?)`, [
      JSON.stringify(items)
    ]);
  }

  async refreshLease(): Promise<void> {
    const now = new Date();
    await utimes(this.staging, now, now);
  }

  async finish(): Promise<void> {
    try {
      await run(this.database, 'COMMIT');
    } finally {
      await this.close();
    }
    await this.refreshLease();
    await rename(this.staging, this.resultDirectory);
  }

  private async close(): Promise<void> {
    if (this.closed) return;
    await close(this.database);
    this.closed = true;
  }

  async discard(): Promise<void> {
    await this.close();
    // Only used before publication or after Redis explicitly rejected the run marker.
    await Promise.all([
      rm(this.staging, { recursive: true, force: true }),
      rm(this.resultDirectory, { recursive: true, force: true })
    ]);
  }
}

async function listDirectories(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
}

export async function cleanExpiredCodingAnalysisResults(now = Date.now()): Promise<void> {
  const root = resultRoot();
  const workspaces = (await listDirectories(root)).filter(name => /^[1-9]\d*$/.test(name));
  for (const workspace of workspaces) {
    const workspacePath = join(root, workspace);
    for (const name of await listDirectories(workspacePath)) {
      const staging = name.startsWith('.working-');
      const id = staging ? name.slice('.working-'.length) : name;
      if (!UUID_PATTERN.test(id)) continue;
      const directory = join(workspacePath, name);
      const status = await stat(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const lifetime = staging ? STAGING_TTL_MS : ANALYSIS_RESULT_TTL_SECONDS * 1000 + RESULT_GRACE_MS;
      if (status && now - status.mtimeMs >= lifetime) await rm(directory, { recursive: true, force: true });
    }
  }
}
