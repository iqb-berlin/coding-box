import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { Agent, createServer, Server } from 'https';
import axios from 'axios';
import * as path from 'path';
import { AddressInfo } from 'net';
import { ConflictException, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import AdmZip = require('adm-zip');
import { CacheService } from '../../../cache/cache.service';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import FileUpload from '../../entities/file_upload.entity';
import Workspace from '../../entities/workspace.entity';
import { ResponseEntity } from '../../entities/response.entity';
import { CodingUnitFreshness } from '../../entities/coding-unit-freshness.entity';
import { CodingFreshnessService } from '../coding/coding-freshness.service';
import { CodingFreshnessQueryService } from '../coding/coding-freshness-query.service';
import { CodingJobFreshnessService } from '../coding/coding-job-freshness.service';
import { CodingStatisticsService } from '../coding/coding-statistics.service';
import { CodingFileCacheService } from '../coding/coding-file-cache.service';
import { getCodingStatisticsCacheKey } from '../coding/coding-statistics-cache-key.util';
import { getCodingIncompleteVariablesCacheKeys } from '../coding/coding-incomplete-variables-cache-key.util';
import { WorkspaceTestResultsService } from '../test-results/workspace-test-results.service';
import { TestResultsCacheService } from '../test-results/test-results-cache.service';
import { lockWorkspaceFilesMutation, unlockWorkspaceFilesMutation } from '../shared/workspace-files-lock.util';
import { WorkspaceFileMetadataService } from './workspace-file-metadata.service';
import { WorkspaceExclusionService } from './workspace-exclusion.service';
import { WorkspaceStatsCacheService } from './workspace-stats-cache.service';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { WorkspaceXmlSchemaValidationService } from './workspace-xml-schema-validation.service';
import { WorkspaceFilesService } from './workspace-files.service';
import { createWorkspaceFilesService } from './workspace-files-test.factory';
import { EXCLUSION_CACHE_PREFIX, OVERVIEW_STATS_CACHE_PREFIX } from './workspace-constants';

const describePostgres = process.env.POSTGRES_INTEGRATION_TESTS === 'true' ? describe : describe.skip;

describePostgres('Workspace file workflows with PostgreSQL and Redis', () => {
  const databaseName = `workspace_files_${process.pid}_${Date.now()}`;
  const connection = {
    type: 'postgres' as const,
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    username: process.env.POSTGRES_USER || 'root',
    password: process.env.POSTGRES_PASSWORD || 'root-password',
    database: process.env.POSTGRES_DB || 'coding-box',
    extra: { max: 4, connectionTimeoutMillis: 5000 }
  };
  let admin: DataSource;
  let db: DataSource;
  let redis: Redis;
  let cache: CacheService;
  let files: WorkspaceFilesService;
  let xsdServer: Server;
  let xsdUrl: string;
  let created = false;
  let certificateDirectory: string;
  const previousHttpsAgent = axios.defaults.httpsAgent;

  beforeAll(async () => {
    if (!process.env.BULLMQ_TEST_REDIS_HOST || !process.env.BULLMQ_TEST_REDIS_PORT) {
      throw new Error('Explicit disposable test Redis is required.');
    }
    admin = await new DataSource(connection).initialize();
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    created = true;
    const changelogRoot = path.resolve('database/changelog');
    const changelog = readFileSync(path.join(changelogRoot, 'coding-box.changelog-root.xml'), 'utf8');
    for (const [, file] of changelog.matchAll(/<include file="([^"]+)"/g)) {
      const input = readFileSync(path.join(changelogRoot, file), 'utf8').split(/^-- changeset /m).slice(1).map(chunk => {
        const end = chunk.indexOf('\n');
        const sql = chunk.slice(end + 1);
        return chunk.slice(0, end).includes('runInTransaction:false') ? sql : `BEGIN;\n${sql}\nCOMMIT;`;
      })
        .join('\n');
      execFileSync(process.env.PSQL_BIN || 'psql', [
        '-h', connection.host, '-p', String(connection.port), '-U', connection.username,
        '-d', databaseName, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'
      ], { input, stdio: 'pipe', env: { ...process.env, PGPASSWORD: connection.password } });
    }
    db = await new DataSource({
      ...connection,
      database: databaseName,
      synchronize: false,
      entities: [path.resolve(__dirname, '../../entities/*.entity.ts')]
    }).initialize();
    redis = new Redis({
      host: process.env.BULLMQ_TEST_REDIS_HOST,
      port: Number(process.env.BULLMQ_TEST_REDIS_PORT),
      keyPrefix: `${databaseName}:`,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null
    });
    await redis.ping();
    cache = new CacheService(redis);
    const repository = db.getRepository(FileUpload);
    const exclusions = new WorkspaceExclusionService(db.getRepository(Workspace), repository, cache);
    const metadata = new WorkspaceFileMetadataService(repository, cache, exclusions);
    const freshness = new CodingFreshnessService(
      db.getRepository(CodingUnitFreshness), db.getRepository(ResponseEntity), db, new CodingFreshnessQueryService(db.getRepository(CodingUnitFreshness), db.getRepository(ResponseEntity), db, exclusions), new CodingJobFreshnessService(db)
    );
    const statistics = new CodingStatisticsService(db.getRepository(ResponseEntity), cache, {} as never, exclusions, metadata);
    const resultsCache = new TestResultsCacheService({} as never, new WorkspaceStatsCacheService(cache), statistics);
    const results = new WorkspaceTestResultsService(
      {} as never, resultsCache, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never
    );
    // Only unused response-validation/queue paths are omitted; persistence, freshness,
    // XML validation, file metadata and every cache operation exercised here are real.
    files = createWorkspaceFilesService(
      repository, db.getRepository(ResponseEntity), {} as never, {} as never, statistics, new WorkspaceXmlSchemaValidationService(repository), new WorkspaceFileStorageService(), new WorkspaceFileParsingService(), {} as never, {} as never, cache, results, metadata, freshness, new CodingFileCacheService(repository)
    );
    certificateDirectory = mkdtempSync(path.join(tmpdir(), 'workspace-file-xsd-'));
    const key = path.join(certificateDirectory, 'key.pem');
    const cert = path.join(certificateDirectory, 'cert.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'
    ], { stdio: 'pipe' });
    // Trust this fixture certificate only; HTTPS verification remains enabled.
    axios.defaults.httpsAgent = new Agent({ ca: readFileSync(cert) });
    xsdServer = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_request, response) => {
      response.setHeader('Content-Type', 'application/xml');
      response.end(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
        <xs:element name="Unit"><xs:complexType><xs:sequence>
          <xs:element name="Metadata" type="xs:anyType"/>
          <xs:any minOccurs="0" maxOccurs="unbounded" processContents="skip"/>
        </xs:sequence><xs:anyAttribute processContents="skip"/></xs:complexType></xs:element>
      </xs:schema>`);
    });
    await new Promise<void>(resolve => { xsdServer.listen(0, '127.0.0.1', resolve); });
    xsdUrl = `https://127.0.0.1:${(xsdServer.address() as AddressInfo).port}/unit.xsd`;
  }, 60000);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    try {
      if (xsdServer?.listening) await new Promise<void>((resolve, reject) => { xsdServer.close(error => (error ? reject(error) : resolve())); });
      axios.defaults.httpsAgent?.destroy();
      axios.defaults.httpsAgent = previousHttpsAgent;
      if (certificateDirectory) rmSync(certificateDirectory, { recursive: true, force: true });
      if (redis) {
        // Delete only this suite's namespace, never an application cache or Redis DB.
        await cache.deleteByPattern('*');
        redis.disconnect();
      }
    } finally {
      try { if (db?.isInitialized) await db.destroy(); } finally {
        if (admin?.isInitialized) {
          try { if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`); } finally { await admin.destroy(); }
        }
      }
    }
  });

  const insert = async (table: string, values: Record<string, unknown>): Promise<number> => {
    const columns = Object.keys(values);
    const [row] = await db.query(
      `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      Object.values(values)
    );
    return row.id;
  };
  const input = (name: string, data: string | Buffer, mimetype = 'application/octet-stream'): FileIo => ({
    originalname: name, mimetype, buffer: Buffer.from(data), size: Buffer.byteLength(data), fieldname: '', encoding: ''
  });
  const unitXml = (variable = 'VAR') => `<Unit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${xsdUrl}">
    <Metadata><Id>UNIT</Id></Metadata><BaseVariables><Variable id="${variable}" alias="${variable}" type="string"/></BaseVariables><CodingSchemeRef>SCHEME.VOCS</CodingSchemeRef></Unit>`;
  const scheme = (rule = 1) => JSON.stringify({ variableCodings: [{ id: 'VAR', sourceType: 'BASE', rules: [{ value: rule }] }] });
  async function fixture() {
    const workspace = await insert('workspace', { name: 'File workflow fixture' });
    const person = await insert('persons', {
      workspace_id: workspace, group: 'group', login: `person-${workspace}`, code: 'code', consider: true
    });
    const info = await insert('bookletinfo', { name: `BOOKLET-${workspace}` });
    const booklet = await insert('booklet', { personid: person, infoid: info });
    const unit = await insert('unit', { bookletid: booklet, name: 'UNIT' });
    await insert('response', {
      unitid: unit, variableid: 'VAR', status: 3, value: 'answer', status_v1: 4, code_v1: 1, score_v1: 1
    });
    return { workspace, unit };
  }
  const countFiles = (workspace: number) => db.getRepository(FileUpload).countBy({ workspace_id: workspace });

  it('validates XML through a local XSD and rebuilds cached metadata after an overwrite', async () => {
    const { workspace } = await fixture();
    await expect(files.getUnitVariableMap(workspace)).resolves.toEqual(new Map());
    await cache.set(`${OVERVIEW_STATS_CACHE_PREFIX}${workspace}`, { stale: true });
    await cache.set(`${EXCLUSION_CACHE_PREFIX}${workspace}`, { stale: true });
    await cache.set('foreign-workspace-sentinel', { retain: true });
    const uploaded = await files.uploadTestFiles(workspace, [input('unit.xml', unitXml(), 'text/xml')], false);
    expect(uploaded.failedFiles).toBeUndefined();
    expect(uploaded).toMatchObject({ uploaded: 1, failed: 0 });
    expect(await files.getUnitVariableMap(workspace)).toEqual(new Map([['UNIT', new Set(['VAR'])]]));
    expect(await cache.get(`${OVERVIEW_STATS_CACHE_PREFIX}${workspace}`)).toBeNull();
    expect(await cache.get(`${EXCLUSION_CACHE_PREFIX}${workspace}`)).toBeNull();
    expect(await files.uploadTestFiles(workspace, [input('unit.xml', unitXml('CHANGED'), 'text/xml')], true)).toMatchObject({ uploaded: 1 });
    expect(await files.getUnitVariableMap(workspace)).toEqual(new Map([['UNIT', new Set(['CHANGED'])]]));
    expect(await cache.get('foreign-workspace-sentinel')).toEqual({ retain: true });
    const invalid = `<Unit xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${xsdUrl}"/>`;
    expect(await files.uploadTestFiles(workspace, [input('invalid.xml', invalid, 'text/xml')], false)).toMatchObject({ uploaded: 0, failed: 1 });
    expect(await countFiles(workspace)).toBe(1);
  });

  it('persists VOCS changes, reports conflicts and scopes selective overwrites and freshness', async () => {
    const { workspace, unit } = await fixture();
    await files.uploadTestFiles(workspace, [input('unit.xml', unitXml(), 'text/xml')], false);
    await cache.set(getCodingStatisticsCacheKey(workspace, 'v1'), { retainForVocs: true });
    for (const key of getCodingIncompleteVariablesCacheKeys(workspace)) await cache.set(key, { stale: true });
    const first = await files.uploadTestFiles(workspace, [input('SCHEME.VOCS', scheme())], false);
    expect(first).toMatchObject({ uploaded: 1, failed: 0, issues: undefined });
    expect(await db.getRepository(CodingUnitFreshness).findBy({ workspace_id: workspace, unit_id: unit })).toEqual(expect.arrayContaining([
      expect.objectContaining({ version: 'v1', state: 'STALE', reason: 'CODING_SCHEME_CHANGED' })
    ]));
    expect(await cache.get(getCodingStatisticsCacheKey(workspace, 'v1'))).toEqual({ retainForVocs: true });
    for (const key of getCodingIncompleteVariablesCacheKeys(workspace)) expect(await cache.get(key)).toBeNull();
    expect(await files.uploadTestFiles(workspace, [input('SCHEME.VOCS', scheme(2))], false)).toMatchObject({ uploaded: 0, conflicts: [{ fileId: 'SCHEME.VOCS' }] });
    expect(await files.uploadTestFiles(workspace, [input('SCHEME.VOCS', scheme(2))], true, ['OTHER'])).toMatchObject({ uploaded: 0 });
    expect(await files.uploadTestFiles(workspace, [input('SCHEME.VOCS', scheme(2))], true, [' scheme.vocs '])).toMatchObject({ uploaded: 1 });
    const stored = await db.getRepository(FileUpload).findOneByOrFail({ workspace_id: workspace, file_id: 'SCHEME.VOCS' });
    expect(stored.data).toBe(scheme(2));
    expect(stored.file_id_normalized).toBe('SCHEME.VOCS');
  });

  it('rejects competing upload, import, deletion and dummy generation while a real session owns the lock', async () => {
    const { workspace } = await fixture();
    const holder = db.createQueryRunner();
    await holder.connect();
    await lockWorkspaceFilesMutation(holder, workspace);
    try {
      const attempts = await Promise.allSettled([
        files.uploadTestFiles(workspace, [input('data.voud', '{}')], false),
        files.testCenterImport([{
          workspace_id: workspace, file_id: 'NEW', filename: 'new.xml', data: '<Unit/>'
        }]),
        files.deleteTestFiles(workspace, ['1']), files.createDummyTestTakerFile(workspace)
      ]);
      attempts.forEach(result => {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(ConflictException);
      });
      expect(await countFiles(workspace)).toBe(0);
    } finally {
      await unlockWorkspaceFilesMutation(holder, workspace);
      await holder.release();
    }
    expect(await files.uploadTestFiles(workspace, [input('data.voud', '{}')], false)).toMatchObject({ uploaded: 1 });
  });

  it('keeps binary bytes intact through storage, ZIP download and workspace-scoped deletion', async () => {
    const { workspace } = await fixture();
    const foreign = await insert('workspace', { name: 'Foreign workspace' });
    const bytes = Buffer.from([0, 255, 128, 1, 2, 3]);
    expect(await files.uploadTestFiles(workspace, [input('binary.bin', bytes)], false)).toMatchObject({ uploaded: 1 });
    expect(await files.uploadTestFiles(foreign, [input('foreign.bin', bytes)], false)).toMatchObject({ uploaded: 1 });
    const zip = new AdmZip(await files.downloadWorkspaceFilesAsZip(workspace));
    expect(zip.getEntries()).toHaveLength(1);
    expect(zip.getEntries()[0].getData()).toEqual(bytes);
    const ownFile = await db.getRepository(FileUpload).findOneByOrFail({ workspace_id: workspace });
    const foreignFile = await db.getRepository(FileUpload).findOneByOrFail({ workspace_id: foreign });
    await cache.set(getCodingStatisticsCacheKey(workspace, 'v1'), { stale: true });
    expect(await files.deleteTestFiles(workspace, [String(ownFile.id), String(foreignFile.id)])).toBe(false);
    expect(await countFiles(workspace)).toBe(0);
    expect(await countFiles(foreign)).toBe(1);
    expect(await cache.get(getCodingStatisticsCacheKey(workspace, 'v1'))).toBeNull();
  });

  it('imports and overwrites Testcenter entries with normalized references and fresh metadata', async () => {
    const { workspace } = await fixture();
    const entry = {
      workspace_id: workspace, file_id: 'UNIT', filename: 'unit.xml', file_type: 'Unit', file_size: 100, data: unitXml()
    };
    expect(await files.testCenterImport([entry])).toMatchObject({ uploaded: 1 });
    expect(await files.getUnitVariableMap(workspace)).toEqual(new Map([['UNIT', new Set(['VAR'])]]));
    expect(await files.testCenterImport([{ ...entry, data: unitXml('NEW') }])).toMatchObject({ uploaded: 0, conflicts: [{ fileId: 'UNIT' }] });
    expect(await files.testCenterImport([{ ...entry, data: unitXml('NEW') }], ['UNIT'])).toMatchObject({ uploaded: 1 });
    const stored = await db.getRepository(FileUpload).findOneByOrFail({ workspace_id: workspace });
    expect(stored).toMatchObject({ file_id_normalized: 'UNIT', coding_scheme_ref_normalized: 'SCHEME' });
    expect(await files.getUnitVariableMap(workspace)).toEqual(new Map([['UNIT', new Set(['NEW'])]]));
  });

  it('retains the existing partial-import result and stale cache after a later SQL write fails', async () => {
    const { workspace } = await fixture();
    await files.uploadTestFiles(workspace, [input('existing.voud', '{}')], false);
    const sentinel = `${OVERVIEW_STATS_CACHE_PREFIX}${workspace}`;
    await cache.set(sentinel, { stale: true });
    await db.query("ALTER TABLE file_upload ADD CONSTRAINT reject_file_fixture CHECK (filename <> 'reject.voud')");
    try {
      const result = await files.testCenterImport([
        {
          workspace_id: workspace, file_id: 'NEW.VOUD', filename: 'new.voud', file_type: 'Resource', file_size: 2, data: '{}'
        },
        {
          workspace_id: workspace, file_id: 'EXISTING.VOUD', filename: 'reject.voud', file_type: 'Resource', file_size: 2, data: 'changed'
        }
      ], ['EXISTING.VOUD']);
      expect(result).toMatchObject({ total: 2, uploaded: 0, failed: 2 });
      expect(await countFiles(workspace)).toBe(2);
      expect(await cache.get(sentinel)).toEqual({ stale: true });
    } finally { await db.query('ALTER TABLE file_upload DROP CONSTRAINT reject_file_fixture'); }
    // The error path must have released its session advisory lock.
    expect(await files.uploadTestFiles(workspace, [input('after.voud', '{}')], false)).toMatchObject({ uploaded: 1 });
  });

  it('retains the existing HTML fallback overwrite after a real primary-write SQL failure', async () => {
    const { workspace } = await fixture();
    await files.uploadTestFiles(workspace, [input('module.html', 'existing resource')], false);
    const html = '<html><script type="application/ld+json">{"id":"PLAYER","version":"1.0.0"}</script></html>';
    await db.query("ALTER TABLE file_upload ADD CONSTRAINT reject_player_fixture CHECK (file_id <> 'PLAYER-1.0.0')");
    try {
      const result = await files.uploadTestFiles(workspace, [input('module.html', html, 'text/html')], false);
      expect(result).toMatchObject({ uploaded: 1, failed: 0, uploadedFiles: [{ fileId: 'MODULE.HTML', fileType: 'Resource' }] });
      const stored = await db.getRepository(FileUpload).findOneByOrFail({ workspace_id: workspace, file_id: 'MODULE.HTML' });
      // Characterize the legacy fallback: it replaces its existing target despite overwrite=false.
      expect(stored.data).toBe(html);
      expect(await countFiles(workspace)).toBe(1);
    } finally { await db.query('ALTER TABLE file_upload DROP CONSTRAINT reject_player_fixture'); }
  });

  it('returns a freshness warning while retaining the file after a real freshness SQL failure', async () => {
    const { workspace } = await fixture();
    await files.uploadTestFiles(workspace, [input('unit.xml', unitXml(), 'text/xml')], false);
    await db.query(`ALTER TABLE coding_unit_freshness ADD CONSTRAINT reject_freshness_fixture CHECK (workspace_id <> ${workspace})`);
    try {
      const result = await files.uploadTestFiles(workspace, [input('SCHEME.VOCS', scheme())], false);
      expect(result).toMatchObject({ uploaded: 1, failed: 0, issues: [{ level: 'warning', category: 'coding_freshness' }] });
      expect(await db.getRepository(FileUpload).findOneBy({ workspace_id: workspace, file_id: 'SCHEME.VOCS' })).not.toBeNull();
    } finally { await db.query('ALTER TABLE coding_unit_freshness DROP CONSTRAINT reject_freshness_fixture'); }
    expect(await files.uploadTestFiles(workspace, [input('SCHEME.VOCS', scheme(2))], true)).toMatchObject({ uploaded: 1, issues: undefined });
  });
});
