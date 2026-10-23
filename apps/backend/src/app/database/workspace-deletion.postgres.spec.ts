import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as AdmZip from 'adm-zip';
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import Workspace from './entities/workspace.entity';
import ResourcePackage from './entities/resource-package.entity';
import { WorkspaceCoreService } from './services/workspace/workspace-core.service';
import { ResourcePackageService } from './services/workspace/resource-package.service';
import { WorkspaceDeletionService } from './services/workspace/workspace-deletion.service';
import { WorkspaceWorkerHost } from '../job-queue/workspace-worker-host';
import { withWorkspaceDeletionLocks, withWorkspaceJobLock } from './services/shared/workspace-lifecycle-lock.util';

const testServerUrl = process.env.WORKSPACE_DELETION_TEST_DATABASE_URL;
const describePostgres = testServerUrl ? describe : describe.skip;

class TestWorker extends WorkspaceWorkerHost {
  operation = jest.fn(async () => 'published');

  async processWorkspaceJob(): Promise<string> {
    return this.operation();
  }
}

describePostgres('Workspace deletion against the complete Liquibase SQL schema', () => {
  let admin: DataSource;
  let db: DataSource;
  let databaseName: string;
  let databaseUrl: string;
  let core: WorkspaceCoreService;
  let worker: TestWorker;
  let ownedColumns: { table_name: string; column_name: string }[];
  const fixtureIds: Record<number, Record<string, number>> = {};
  const changelogRoot = path.resolve('database/changelog');
  const cleanup = { prepare: jest.fn(async () => ({ jobs: [], packageNames: [] })), cleanup: jest.fn() };

  const applySql = (file: string) => {
    const source = fs.readFileSync(path.join(changelogRoot, file), 'utf8');
    const input = source.split(/^-- changeset /m).slice(1).map(chunk => {
      const end = chunk.indexOf('\n');
      const options = chunk.slice(0, end);
      const statements = chunk.slice(end + 1);
      return options.includes('runInTransaction:false') ? statements : `BEGIN;\n${statements}\nCOMMIT;`;
    }).join('\n');
    return execFileSync(process.env.PSQL_BIN || 'psql', [
      databaseUrl, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'
    ], { input, stdio: 'pipe' });
  };

  async function insert(table: string, values: Record<string, unknown>): Promise<number> {
    const columns = Object.keys(values);
    const rows = await db.query(
      `INSERT INTO public."${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      Object.values(values)
    ) as { id: number }[];
    return rows[0].id ?? 0;
  }

  async function seed(workspaceId: number, orphan = false): Promise<void> {
    const ids: Record<string, number> = {};
    fixtureIds[workspaceId] = ids;
    if (!orphan) await db.query('INSERT INTO public.workspace(id, name) VALUES ($1, $2)', [workspaceId, `Workspace ${workspaceId}`]);
    ids.missings_profile = await insert('missings_profile', { workspace_id: workspaceId, label: 'Test', missings: '[]' });
    ids.persons = await insert('persons', {
      workspace_id: workspaceId, group: 'group', login: `login-${workspaceId}`, code: 'code'
    });
    ids.bookletinfo = await insert('bookletinfo', { name: `Booklet ${workspaceId}` });
    ids.booklet = await insert('booklet', { personid: ids.persons, infoid: ids.bookletinfo });
    ids.unit = await insert('unit', { bookletid: ids.booklet, name: 'unit' });
    ids.response = await insert('response', { unitid: ids.unit, variableid: 'variable', status: 1 });
    for (const table of ['bookletlog', 'session']) ids[table] = await insert(table, { bookletid: ids.booklet, ...(table === 'bookletlog' ? { key: 'key' } : {}) });
    for (const table of ['unitlog', 'unitlaststate', 'chunk']) ids[table] = await insert(table, { unitid: ids.unit, key: 'key' });
    ids.unit_note = await insert('unit_note', { unitId: ids.unit, note: 'test' });
    ids.unit_tag = await insert('unit_tag', { unitId: ids.unit, tag: 'test' });
    ids.variable_bundle = await insert('variable_bundle', { workspace_id: workspaceId, name: 'bundle', variables: '[]' });
    ids.coder_training = await insert('coder_training', { workspace_id: workspaceId, label: 'training' });
    ids.job_definitions = await insert('job_definitions', {
      workspace_id: workspaceId, name: 'definition', distribution_seed: 'test', missings_profile_id: ids.missings_profile
    });
    ids.coding_job = await insert('coding_job', {
      workspace_id: workspaceId, name: 'job', job_definition_id: ids.job_definitions, training_id: ids.coder_training, missings_profile_id: ids.missings_profile
    });
    ids.coding_job_unit = await insert('coding_job_unit', {
      coding_job_id: ids.coding_job,
      response_id: ids.response,
      workspace_id: null,
      unit_name: 'unit',
      variable_id: 'variable',
      variable_anchor: '',
      booklet_name: 'booklet',
      person_login: 'login',
      person_code: 'code'
    });
    ids.coding_job_coder = await insert('coding_job_coder', { coding_job_id: ids.coding_job, user_id: 1 });
    ids.coding_job_variable = await insert('coding_job_variable', { coding_job_id: ids.coding_job, unit_name: 'unit', variable_id: 'variable' });
    ids.coding_job_variable_bundle = await insert('coding_job_variable_bundle', { coding_job_id: ids.coding_job, variable_bundle_id: ids.variable_bundle });
    ids.coder_training_variable = await insert('coder_training_variable', { coder_training_id: ids.coder_training, unit_name: 'unit', variable_id: 'variable' });
    ids.coder_training_bundle = await insert('coder_training_bundle', { coder_training_id: ids.coder_training, variable_bundle_id: ids.variable_bundle });
    ids.coder_training_coder = await insert('coder_training_coder', { coder_training_id: ids.coder_training, user_id: 1 });
    ids.coder_training_discussion_result = await insert('coder_training_discussion_result', { workspace_id: workspaceId, training_id: ids.coder_training, response_id: ids.response });
    ids.coding_unit_freshness = await insert('coding_unit_freshness', {
      workspace_id: workspaceId, unit_id: ids.unit, version: 'v1', state: 'PENDING', reason: 'TEST_RESULTS_CHANGED'
    });
    ids.job = await insert('job', { workspace_id: workspaceId, type: 'validation-task', status: 'pending' });
    for (const table of ['variable_analysis_job', 'test_person_coding_job']) ids[table] = await insert(table, { workspace_id: workspaceId, status: 'pending' });
    ids.file_upload = await insert('file_upload', { workspace_id: workspaceId });
    ids.replay_statistics = await insert('replay_statistics', { workspace_id: workspaceId, unit_id: 'unit', duration_milliseconds: 10 });
    ids.journal_entries = await insert('journal_entries', {
      workspace_id: workspaceId, user_id: '1', action_type: 'test', entity_type: 'test'
    });
    ids.resource_package = await insert('resource_package', { workspaceId: workspaceId, name: `package-${workspaceId}`, scope: 'workspace' });
    await db.query('INSERT INTO public.workspace_test_results_revision(workspace_id) VALUES ($1)', [workspaceId]);
    if (!orphan) {
      await db.query('INSERT INTO public.workspace_user(workspace_id, user_id) VALUES ($1, 1)', [workspaceId]);
      await db.query("INSERT INTO public.testcenter_import_run(workspace_id, import_run_id, progress) VALUES ($1, 'test', '{}')", [workspaceId]);
      ids.double_coding_review_decision = await insert('double_coding_review_decision', {
        workspace_id: workspaceId, response_id: ids.response, manager_key: 'test', manager_name: 'Test', state: 'draft'
      });
    }
  }

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: testServerUrl }).initialize();
    databaseName = `workspace_deletion_${process.pid}_${Date.now()}`;
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    const url = new URL(testServerUrl!);
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    db = await new DataSource({
      type: 'postgres',
      url: databaseUrl,
      entities: [path.join(__dirname, 'entities/*.entity.ts')],
      synchronize: false,
      extra: { max: 2 }
    }).initialize();
    const root = fs.readFileSync(path.join(changelogRoot, 'coding-box.changelog-root.xml'), 'utf8');
    for (const [, file] of root.matchAll(/<include file="([^"]+)"/g)) {
      if (file.includes('workspace-deletion')) break;
      applySql(file);
    }
    await insert('user', {
      id: 1, username: 'tester', identity: 'tester', issuer: 'test'
    });
    await seed(7);
    await seed(8);
    await seed(999, true);
    // Reproduce the old deletion before applying the repair, then roll back the fixture.
    const runner = db.createQueryRunner();
    await runner.startTransaction();
    await runner.query('DELETE FROM public.file_upload WHERE workspace_id=7');
    await runner.query('DELETE FROM public.persons WHERE workspace_id=7');
    await runner.query('DELETE FROM public.workspace WHERE id=7');
    expect(await runner.query('SELECT id FROM public.coding_job WHERE workspace_id=7')).toHaveLength(1);
    expect(await runner.query('SELECT id FROM public.job_definitions WHERE workspace_id=7')).toHaveLength(1);
    await runner.rollbackTransaction();
    await runner.release();
    applySql('coding-box.changelog-workspace-deletion.sql');
    ownedColumns = await db.query(`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND column_name IN ('workspace_id', 'workspaceId') ORDER BY table_name`);
    core = new WorkspaceCoreService(db.getRepository(Workspace), db, {} as never, {} as never, cleanup as never);
    const module = await Test.createTestingModule({
      providers: [TestWorker, { provide: getDataSourceToken(), useValue: db }]
    }).compile();
    worker = module.get(TestWorker);
  }, 60000);

  afterAll(async () => {
    await db?.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.destroy();
    }
  });

  it('cleans pre-existing orphans and enforces a cascade for every scoped table', async () => {
    for (const { table_name: table, column_name: column } of ownedColumns) {
      expect(await db.query(`SELECT * FROM public."${table}" WHERE "${column}"=999`)).toEqual([]);
      if (table === 'resource_package') continue;
      const constraints = await db.query(`SELECT c.confdeltype FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
        WHERE c.conrelid=$1::regclass AND c.confrelid='public.workspace'::regclass AND a.attname=$2`, [table, column]);
      expect(constraints).toEqual([{ confdeltype: 'c' }]);
    }
    expect(await db.query('SELECT workspace_id FROM public.coding_job_unit WHERE coding_job_id=$1', [fixtureIds[7].coding_job])).toEqual([{ workspace_id: 7 }]);
    await expect(db.query("INSERT INTO public.job(workspace_id,type,status) VALUES(999,'validation-task','pending')")).rejects.toMatchObject({ code: '23503' });
  });

  it('maps entity workspace relations to the Liquibase cascade columns', () => {
    for (const metadata of db.entityMetadatas) {
      if (!metadata.columns.some(c => c.databaseName === 'workspace_id' || c.databaseName === 'workspaceId')) continue;
      if (metadata.tableName === 'logs') continue; // obsolete entity; table removed in 1.5.0
      const owner = metadata.parentEntityMetadata ?? metadata;
      expect({ entity: metadata.name, cascade: owner.foreignKeys.some(fk => fk.referencedTablePath === 'workspace' && fk.onDelete === 'CASCADE') }).toEqual({ entity: metadata.name, cascade: true });
    }
  });

  it.each(['upload-first', 'cleanup-first'])('preserves shared package files during a concurrent upload (%s)', async order => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-package-race-'));
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(directory);
    const repository = db.getRepository(ResourcePackage);
    const packages = new ResourcePackageService(repository, {} as never, {} as never);
    (packages as unknown as { resourcePackagesPath: string }).resourcePackagesPath = path.join(directory, 'packages');
    const deletion = new WorkspaceDeletionService(db, {
      getJobsForWorkspaceDeletion: async () => []
    } as never, {} as never);
    const zip = new AdmZip();
    zip.addFile('data.txt', Buffer.from('shared content'));
    const upload = { originalname: 'SharedRace.itcr.zip', buffer: zip.toBuffer() } as Express.Multer.File;
    let release = () => {};
    let entered!: () => void;
    const paused = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    let boundary: jest.SpyInstance | undefined;
    try {
      await db.query("INSERT INTO public.workspace(id,name) VALUES(41,'old owner'),(42,'new owner')");
      await packages.create(41, upload);
      const resources = await deletion.prepare([41]);
      if (order === 'upload-first') {
        // Pause after the upload has found the original files, before publishing its reference.
        boundary = jest.spyOn(repository, 'save').mockImplementationOnce(async entity => {
          entered();
          await resume;
          return db.manager.save(ResourcePackage, entity);
        });
        first = packages.create(42, upload);
        await paused;
        await db.query('DELETE FROM public.workspace WHERE id=41');
        second = deletion.cleanup(resources);
      } else {
        await db.query('DELETE FROM public.workspace WHERE id=41');
        // Pause after cleanup sees zero references, before it removes the shared directory.
        const builder = repository.createQueryBuilder('p');
        const count = builder.getCount.bind(builder);
        jest.spyOn(builder, 'getCount').mockImplementationOnce(async () => {
          const result = await count();
          entered();
          await resume;
          return result;
        });
        boundary = jest.spyOn(repository, 'createQueryBuilder').mockReturnValueOnce(builder);
        first = deletion.cleanup(resources);
        await paused;
        // The database's case-insensitive package-name lookup must use the same lock.
        second = packages.create(42, { ...upload, originalname: 'sharedrace.itcr.zip' });
      }
      let waiting = false;
      for (let attempt = 0; attempt < 200; attempt++) {
        const rows = await db.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=774020255 AND NOT granted");
        if (rows.length > 0) { waiting = true; break; }
        await new Promise(resolve => { setTimeout(resolve, 10); });
      }
      expect(waiting).toBe(true);
      release();
      await Promise.all([first, second]);
      const references = await repository.find({ where: { workspaceId: 42 } });
      expect(references).toHaveLength(1);
      expect(fs.readFileSync(path.join(directory, 'packages', references[0].name, 'data.txt'), 'utf8')).toBe('shared content');
    } finally {
      release();
      await Promise.allSettled([first, second]);
      boundary?.mockRestore();
      await db.query('DELETE FROM public.workspace WHERE id IN (41,42)');
      cwd.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('blocks deletion throughout worker execution without exhausting a two-connection application pool', async () => {
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    worker.operation.mockImplementationOnce(async () => {
      await db.query('SELECT 1');
      started();
      await new Promise<void>(resolve => { finish = resolve; });
      return 'published';
    });
    const running = worker.process({ data: { workspaceId: 7 } } as Job);
    await ready;
    try {
      await expect(core.remove([7])).rejects.toBeInstanceOf(ConflictException);
      expect(cleanup.prepare).not.toHaveBeenCalled();
    } finally {
      finish();
      await running;
    }
  });

  it('deletes all scoped rows and dependent trees while preserving another workspace and global resources', async () => {
    const global = await insert('resource_package', { workspaceId: 0, name: 'global', scope: 'global' });
    await core.remove([7]);
    for (const { table_name: table, column_name: column } of ownedColumns) {
      expect(await db.query(`SELECT * FROM public."${table}" WHERE "${column}"=7`)).toEqual([]);
      expect(await db.query(`SELECT * FROM public."${table}" WHERE "${column}"=8`)).not.toHaveLength(0);
    }
    for (const [table, id] of Object.entries(fixtureIds[7])) {
      if (table === 'bookletinfo' || id === 0) continue; // shared catalogue, not owned by a workspace
      expect(await db.query(`SELECT * FROM public."${table}" WHERE id=$1`, [id])).toEqual([]);
    }
    for (const table of ['unitlog', 'unitlaststate', 'chunk']) {
      expect(await db.query(`SELECT * FROM public.${table} WHERE unitid=$1`, [fixtureIds[7].unit])).toEqual([]);
    }
    expect(await db.query('SELECT id FROM public.resource_package WHERE id=$1', [global])).toHaveLength(1);
    const calls = worker.operation.mock.calls.length;
    await expect(worker.process({ data: { workspaceId: 7 } } as Job)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(worker.process({ queueName: 'validation-task', data: { taskId: fixtureIds[7].job } } as Job)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(worker.operation).toHaveBeenCalledTimes(calls);
  });

  it('rejects a worker that arrives after the exclusive deletion lock is acquired', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    const operation = jest.fn(async () => 'late artifact');
    let late!: Promise<unknown>;
    try {
      await withWorkspaceDeletionLocks(runner, [8], async () => {
        late = withWorkspaceJobLock(db, 8, operation);
        await runner.query('DELETE FROM public.workspace WHERE id=8');
      });
      await expect(late).rejects.toBeInstanceOf(UnrecoverableError);
      expect(operation).not.toHaveBeenCalled();
    } finally {
      await runner.release();
    }
  });
});
