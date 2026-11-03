import { ConflictException, Logger } from '@nestjs/common';
import AdmZip = require('adm-zip');
import FileUpload from '../../entities/file_upload.entity';
import { FileIo } from '../../../admin/workspace/file-io.interface';
import { WorkspaceFileParsingService } from './workspace-file-parsing.service';
import { WorkspaceFileStorageService } from './workspace-file-storage.service';
import { WorkspaceTestTakersValidationService } from './workspace-test-takers-validation.service';
import { createWorkspaceFilesService, xmlUploads, resourceUploads } from './workspace-files-test.factory';

const file = (name: string, data: string | Buffer, mimetype = 'application/octet-stream'): FileIo => ({
  originalname: name, mimetype, buffer: Buffer.from(data), size: Buffer.byteLength(data), fieldname: '', encoding: ''
});

function fixture() {
  const events: string[] = [];
  const query = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    execute: jest.fn(async () => { events.push('execute'); return { affected: 1 }; })
  };
  const lockedFiles = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn(value => value),
    createQueryBuilder: jest.fn(() => query),
    save: jest.fn(async value => { events.push('save'); return value; }),
    upsert: jest.fn(async () => { events.push('upsert'); })
  };
  const manager = { getRepository: jest.fn(() => lockedFiles) };
  const runner = {
    manager,
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql: string) => {
      events.push(sql.includes('pg_try') ? 'lock' : 'unlock');
      return [{ locked: true }];
    }),
    release: jest.fn(async () => { events.push('release'); })
  };
  const ordinaryFiles = {
    manager: { connection: { createQueryRunner: jest.fn(() => runner) } },
    findOne: jest.fn(),
    find: jest.fn(),
    upsert: jest.fn(),
    createQueryBuilder: jest.fn()
  };
  const metadata = { invalidateMetadataCache: jest.fn(async () => { events.push('metadata'); }) };
  const cache = { delete: jest.fn(async () => { events.push('exclusion'); }) };
  const results = { invalidateWorkspaceStatsCache: jest.fn(async () => { events.push('stats'); }) };
  const statistics = {
    invalidateCache: jest.fn(async () => { events.push('statistics'); }),
    invalidateIncompleteVariablesCache: jest.fn(async () => { events.push('incomplete'); })
  };
  const codingFreshness = { markUnitsStaleAfterCodingSchemeChange: jest.fn(async () => { events.push('freshness'); }) };
  const codingCache = { clearCaches: jest.fn(() => events.push('coding-cache')) };
  const processCache = { invalidateWorkspaceCaches: jest.fn(() => events.push('process-cache')) };
  const schema = { validateXmlViaXsdUrl: jest.fn().mockResolvedValue({ schemaValid: true, errors: [] }) };
  const service = createWorkspaceFilesService(
    ordinaryFiles as never, {} as never, {} as never, {} as never, statistics as never, schema as never, new WorkspaceFileStorageService(), new WorkspaceFileParsingService(), {} as never, {} as never, cache as never, results as never, metadata as never, codingFreshness as never, codingCache as never, processCache as never
  );
  return {
    service, events, query, runner, manager, lockedFiles, ordinaryFiles, metadata, cache, results, statistics, codingFreshness, codingCache, processCache, schema
  };
}

describe('workspace file workflow boundaries', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['upload', 'delete', 'dummy', 'testcenter'])('rejects a competing %s before touching files or caches', async operation => {
    const f = fixture();
    f.runner.query.mockResolvedValue([{ locked: false }]);
    const action = {
      upload: () => f.service.uploadTestFiles(7, [file('A.VOCS', '{}')], false),
      delete: () => f.service.deleteTestFiles(7, ['1']),
      dummy: () => f.service.createDummyTestTakerFile(7),
      testcenter: () => f.service.testCenterImport([{ workspace_id: 7, file_id: 'A.VOCS' }])
    }[operation];
    await expect(action()).rejects.toBeInstanceOf(ConflictException);
    expect(f.runner.release).toHaveBeenCalledTimes(1);
    expect(f.runner.query).toHaveBeenCalledTimes(1);
    expect(f.manager.getRepository).not.toHaveBeenCalled();
    expect(f.lockedFiles.upsert).not.toHaveBeenCalled();
    expect(f.cache.delete).not.toHaveBeenCalled();
  });

  it('writes and marks freshness through the held lock manager, then invalidates caches before release', async () => {
    const f = fixture();
    const result = await f.service.uploadTestFiles(7, [file('A.VOCS', '{"variableCodings":[{"id":"v"}]}')], false);
    expect(result).toEqual(expect.objectContaining({ total: 1, uploaded: 1, failed: 0 }));
    expect(f.manager.getRepository).toHaveBeenCalledWith(FileUpload);
    expect(f.ordinaryFiles.findOne).not.toHaveBeenCalled();
    expect(f.ordinaryFiles.upsert).not.toHaveBeenCalled();
    expect(f.codingFreshness.markUnitsStaleAfterCodingSchemeChange).toHaveBeenCalledWith(
      7, { autoCodingSchemeRefs: ['A'], manualCodingSchemeRefs: ['A'] }, f.manager
    );
    expect(f.events).toEqual(['lock', 'upsert', 'freshness', 'metadata', 'exclusion', 'stats', 'coding-cache', 'process-cache', 'incomplete', 'unlock', 'release']);
    expect(f.statistics.invalidateCache).not.toHaveBeenCalled();
  });

  it('collects nested ZIP successes, conflicts and schema failures in entry order', async () => {
    const f = fixture();
    const zip = new AdmZip();
    zip.addFile('folder/1.vocs', Buffer.from('{"variableCodings":[]}'));
    zip.addFile('folder/2.xml', Buffer.from('<Unit><Metadata><Id>U2</Id></Metadata></Unit>'));
    zip.addFile('folder/3.xml', Buffer.from('<Unit/>'));
    zip.addFile('folder/4.voud', Buffer.from('{}'));
    f.lockedFiles.findOne.mockImplementation(async ({ where }) => (where.file_id === '4.VOUD' ? { data: '{}' } : null));
    f.schema.validateXmlViaXsdUrl.mockImplementation(async content => (content === '<Unit/>' ?
      { schemaValid: false, errors: ['missing Metadata'] } : { schemaValid: true, errors: [] }));
    const result = await f.service.uploadTestFiles(7, [file('all.zip', zip.toBuffer(), 'application/zip')], false);
    expect(result).toEqual({
      total: 1,
      uploaded: 2,
      failed: 1,
      uploadedFiles: [
        { fileId: '1.VOCS', filename: '1.vocs', fileType: 'Resource' },
        { fileId: 'U2', filename: '2.xml', fileType: 'Unit' }
      ],
      conflicts: [{ fileId: '4.VOUD', filename: '4.voud', fileType: 'Resource' }],
      failedFiles: [{ filename: '3.xml', reason: 'XSD validation failed: 3.xml', details: ['missing Metadata'] }],
      issues: undefined
    });
    expect(f.lockedFiles.upsert).toHaveBeenCalledTimes(2);
    expect(f.statistics.invalidateCache).toHaveBeenCalledWith(7);
    expect(f.statistics.invalidateIncompleteVariablesCache).toHaveBeenCalledWith(7);
    expect(f.runner.release).toHaveBeenCalledTimes(1);
  });

  it.each(['schemer', 'player'])('keeps HTML %s identification and overwrite filtering', async kind => {
    const f = fixture();
    const metadata = {
      '@type': kind, '@id': 'MODULE', id: 'MODULE', version: '1.0.0'
    };
    const html = file('module.html', `<html><script type="application/ld+json">${JSON.stringify(metadata)}</script></html>`, 'text/html');
    f.lockedFiles.findOne.mockResolvedValue({ data: 'old' });
    const conflict = await f.service.uploadTestFiles(7, [html], false);
    expect(conflict.conflicts).toEqual([{ fileId: 'MODULE-1.0.0', filename: 'module.html', fileType: kind === 'schemer' ? 'Schemer' : 'Resource' }]);
    const skipped = await f.service.uploadTestFiles(7, [html], true, ['OTHER']);
    expect(skipped.uploaded).toBe(0);
    expect(f.lockedFiles.upsert).not.toHaveBeenCalled();
    const uploaded = await f.service.uploadTestFiles(7, [html], true, [' module-1.0.0 ']);
    expect(uploaded.uploaded).toBe(1);
    expect(f.lockedFiles.upsert).toHaveBeenCalledWith(expect.objectContaining({
      file_id: 'MODULE-1.0.0', file_type: kind === 'schemer' ? 'Schemer' : 'Resource', structured_data: { metadata }
    }), ['file_id', 'workspace_id']);
  });

  it('retains the generic HTML fallback when normal persistence fails', async () => {
    const f = fixture();
    f.ordinaryFiles.findOne.mockResolvedValue(null);
    f.ordinaryFiles.upsert.mockRejectedValueOnce(new Error('first write failed')).mockResolvedValueOnce(undefined);
    const html = file('fallback.html', '<html/>', 'text/html');
    await expect(resourceUploads(f.service).handleHtmlFile(7, html, false)).resolves.toEqual({
      fileId: 'FALLBACK.HTML', filename: 'fallback.html', fileType: 'Resource'
    });
    expect(f.ordinaryFiles.upsert).toHaveBeenCalledTimes(2);
    expect(f.ordinaryFiles.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ structured_data: { metadata: {} } }), ['file_id', 'workspace_id']);
  });

  it('keeps failures returned by handlers in order with rejected ZIP tasks', async () => {
    const f = fixture();
    jest.spyOn(Reflect.get(f.service, 'uploads'), 'handleZipFile').mockRejectedValueOnce(new Error('ZIP task rejected'));
    const failedZip = file('broken.zip', 'not a zip', 'application/zip');
    const result = await f.service.uploadTestFiles(7, [file('first', '', 'unsupported'), failedZip], false);
    expect(result.failedFiles?.map(failed => failed.filename)).toEqual(['first', 'broken.zip']);
    expect(result.uploaded).toBe(0);
    expect(f.statistics.invalidateCache).not.toHaveBeenCalled();
    expect(f.statistics.invalidateIncompleteVariablesCache).not.toHaveBeenCalled();
    expect(f.metadata.invalidateMetadataCache).toHaveBeenCalledWith(7);
  });

  it('starts at most five top-level uploads before the next batch', async () => {
    const f = fixture();
    const finish: (() => void)[] = [];
    const started: string[] = [];
    jest.spyOn(xmlUploads(f.service), 'handleXmlFile').mockImplementation(async (_workspace, input) => {
      started.push(input.originalname);
      await new Promise<void>(resolve => { finish.push(resolve); });
      return { fileId: input.originalname, filename: input.originalname, fileType: 'Unit' };
    });
    const promise = f.service.uploadTestFiles(7, Array.from({ length: 6 }, (_, i) => file(`${i}.xml`, '<Unit/>', 'text/xml')), false);
    // Allow the lock acquisition and the first upload batch to start.
    await new Promise(resolve => { setImmediate(resolve); });
    expect(started).toEqual(['0.xml', '1.xml', '2.xml', '3.xml', '4.xml']);
    finish.splice(0).forEach(resolve => resolve());
    await new Promise(resolve => { setImmediate(resolve); });
    expect(started).toHaveLength(6);
    finish.splice(0).forEach(resolve => resolve());
    await expect(promise).resolves.toEqual(expect.objectContaining({ uploaded: 6 }));
  });

  it('scopes deletion to the workspace and invalidates even after a partial deletion', async () => {
    const f = fixture();
    await expect(f.service.deleteTestFiles(7, ['1', '2', '1', '0', '1 OR 1=1', '9007199254740993'])).resolves.toBe(false);
    expect(f.query.where).toHaveBeenCalledWith('workspace_id = :workspaceId', { workspaceId: 7 });
    expect(f.query.andWhere).toHaveBeenCalledWith('id IN (:...ids)', { ids: [1, 2] });
    expect(f.ordinaryFiles.createQueryBuilder).not.toHaveBeenCalled();
    expect(f.events).toEqual(['lock', 'execute', 'metadata', 'exclusion', 'stats', 'coding-cache', 'process-cache', 'statistics', 'unlock', 'release']);
  });

  it('returns false if the second dummy-file save fails and still releases the lock', async () => {
    const f = fixture();
    f.lockedFiles.find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ file_id: 'U1' }]);
    f.lockedFiles.save.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('write failed'));
    await expect(f.service.createDummyTestTakerFile(7)).resolves.toBe(false);
    expect(f.lockedFiles.save).toHaveBeenNthCalledWith(1, expect.objectContaining({ file_type: 'Booklet', data: expect.stringContaining('<Unit id="U1"/>') }));
    expect(f.lockedFiles.save).toHaveBeenNthCalledWith(2, expect.objectContaining({ file_type: 'TestTakers' }));
    expect(f.events.slice(-2)).toEqual(['unlock', 'release']);
  });

  it('inserts new Testcenter files before overwrites, freshness and invalidation', async () => {
    const f = fixture();
    f.query.getMany.mockResolvedValue([{ file_id: 'A.VOCS', filename: 'A.vocs', file_type: 'Resource' }]);
    f.lockedFiles.find.mockResolvedValue([{ file_id: 'A.VOCS', data: '{"variableCodings":[]}' }]);
    const data = '{"variableCodings":[{"id":"v1"}]}';
    const result = await f.service.testCenterImport([
      {
        workspace_id: 7, file_id: 'B.VOCS', filename: 'B.vocs', file_type: 'Resource', data
      },
      {
        workspace_id: 7, file_id: 'A.VOCS', filename: 'A.vocs', file_type: 'Resource', data
      }
    ], ['A.VOCS']);
    expect(result.uploadedFiles?.map(upload => upload.fileId)).toEqual(['B.VOCS', 'A.VOCS']);
    expect(f.query.orIgnore).toHaveBeenCalledTimes(1);
    expect(f.lockedFiles.upsert).toHaveBeenCalledWith([expect.objectContaining({ file_id: 'A.VOCS', file_id_normalized: 'A.VOCS' })], ['file_id', 'workspace_id']);
    expect(f.events).toEqual(['lock', 'execute', 'upsert', 'freshness', 'freshness', 'metadata', 'exclusion', 'stats', 'coding-cache', 'process-cache', 'unlock', 'release']);
    expect(f.statistics.invalidateCache).not.toHaveBeenCalled();
    expect(f.codingFreshness.markUnitsStaleAfterCodingSchemeChange).toHaveBeenCalledWith(7, expect.anything(), f.manager);
  });

  it('returns the existing import failure result after an overwrite fails and releases the lock', async () => {
    const f = fixture();
    f.query.getMany.mockResolvedValue([{ file_id: 'A', filename: 'A', file_type: 'Unit' }]);
    f.lockedFiles.upsert.mockRejectedValueOnce(new Error('overwrite failed'));
    const result = await f.service.testCenterImport([
      {
        workspace_id: 7, file_id: 'B', filename: 'B', file_type: 'Unit', data: '<Unit/>'
      },
      {
        workspace_id: 7, file_id: 'A', filename: 'A', file_type: 'Unit', data: '<Unit/>'
      }
    ], ['A']);
    expect(result).toEqual(expect.objectContaining({
      total: 2, uploaded: 0, failed: 2, failedFiles: [{ filename: 'Testcenter import', reason: 'overwrite failed' }]
    }));
    expect(f.events).toEqual(['lock', 'execute', 'unlock', 'release']);
    expect(f.metadata.invalidateMetadataCache).not.toHaveBeenCalled();
  });

  it('preserves cache failure propagation and does not clear later local caches', async () => {
    const f = fixture();
    f.metadata.invalidateMetadataCache.mockRejectedValueOnce(new Error('cache failed'));
    await expect(f.service.invalidateWorkspaceFileCaches(7)).rejects.toThrow('cache failed');
    expect(f.cache.delete).toHaveBeenCalled();
    expect(f.results.invalidateWorkspaceStatsCache).not.toHaveBeenCalled();
    expect(f.codingCache.clearCaches).not.toHaveBeenCalled();
    expect(f.processCache.invalidateWorkspaceCaches).not.toHaveBeenCalled();
  });
});

describe('TestTakers validation after workflow extraction', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  const xml = `<TestTakers>
    <Group id="G1"><Login name="L1" mode="run-hot-return"><Booklet codes="a"/><Booklet/><Booklet codes="b"/></Login><Login name="ignored" mode="run-review"/></Group>
    <Group id="G2"><Login name="L2" mode="run-hot-restart"/></Group>
    <Group id="G3"><Login name="ignored" mode="run-review"/></Group>
  </TestTakers>`;
  const makeValidation = () => {
    const files = { find: jest.fn().mockResolvedValue([{ data: xml }]) };
    const persons = { find: jest.fn().mockResolvedValue([]) };
    const unitsQuery = { innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue([]) };
    const units = { createQueryBuilder: jest.fn(() => unitsQuery) };
    const responses = { count: jest.fn().mockResolvedValue(0) };
    return {
      files, persons, units, unitsQuery, responses, service: new WorkspaceTestTakersValidationService(files as never, persons as never, units as never, responses as never)
    };
  };

  it('counts all groups, only accepted login modes and nonempty booklet codes', async () => {
    const f = makeValidation();
    f.persons.find.mockResolvedValue([{ group: 'G1', login: 'L1', code: 'a' }, { group: 'G3', login: 'ignored', code: 'b' }]);
    const progress = jest.fn();
    await expect(f.service.validateTestTakers(7, progress)).resolves.toEqual({
      testTakersFound: true,
      totalGroups: 3,
      totalLogins: 2,
      totalBookletCodes: 2,
      missingPersons: [{
        group: 'G3', login: 'ignored', code: 'b', reason: 'Person not found in TestTakers XML'
      }]
    });
    expect(progress.mock.calls).toEqual([[10], [30], [60]]);
    expect(f.persons.find).toHaveBeenCalledWith({ where: { workspace_id: 7, consider: true } });
  });

  it('paginates only eligible groups while reporting totals and progress for all groups', async () => {
    const f = makeValidation();
    f.persons.find.mockResolvedValueOnce([{ id: 10 }]).mockResolvedValueOnce([]);
    f.unitsQuery.getMany.mockResolvedValueOnce([{ id: 100 }]);
    f.responses.count.mockResolvedValueOnce(2);
    const progress = jest.fn();
    await expect(f.service.validateGroupResponses(7, 2, 1, progress)).resolves.toEqual({
      testTakersFound: true,
      groupsWithResponses: [{ group: 'G2', hasResponse: false }],
      allGroupsHaveResponses: false,
      total: 2,
      totalGroupsWithoutResponses: 1,
      page: 2,
      limit: 1
    });
    expect(f.persons.find.mock.calls).toEqual([
      [{ where: { workspace_id: 7, group: 'G1', consider: true } }],
      [{ where: { workspace_id: 7, group: 'G2', consider: true } }]
    ]);
    expect(progress.mock.calls).toEqual([[10], [20], [40], [67], [95]]);
    expect(f.responses.count).toHaveBeenCalledTimes(1);
  });

  it('retains 1000-ID query batches for persons and responses', async () => {
    const f = makeValidation();
    f.files.find.mockResolvedValue([{ data: '<TestTakers><Group id="G"><Login mode="run-hot-return"/></Group></TestTakers>' }]);
    f.persons.find.mockResolvedValue(Array.from({ length: 1001 }, (_, id) => ({ id })));
    f.unitsQuery.getMany.mockResolvedValueOnce(Array.from({ length: 1000 }, (_, id) => ({ id }))).mockResolvedValueOnce([{ id: 1000 }]);
    f.responses.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    await expect(f.service.validateGroupResponses(7)).resolves.toEqual(expect.objectContaining({ allGroupsHaveResponses: true }));
    expect(f.unitsQuery.where.mock.calls[0][1].personIdsBatch).toHaveLength(1000);
    expect(f.unitsQuery.where.mock.calls[1][1].personIdsBatch).toEqual([1000]);
    expect(f.responses.count).toHaveBeenCalledTimes(2);
  });

  it('preserves early empty results without normalizing requested pagination', async () => {
    const f = makeValidation();
    await expect(f.service.validateGroupResponses(0, 0, 0)).resolves.toEqual({
      testTakersFound: false,
      groupsWithResponses: [],
      allGroupsHaveResponses: false,
      total: 0,
      totalGroupsWithoutResponses: 0,
      page: 0,
      limit: 0
    });
    expect(f.files.find).not.toHaveBeenCalled();
    f.files.find.mockResolvedValue([{ data: '<TestTakers><Group id="G"/></TestTakers>' }]);
    await expect(f.service.validateGroupResponses(7, 0, 0)).resolves.toEqual(expect.objectContaining({ testTakersFound: true, page: 0, limit: 0 }));
  });

  it('retains validation error messages on database failure', async () => {
    const f = makeValidation();
    f.files.find.mockRejectedValue(new Error('read failed'));
    await expect(f.service.validateTestTakers(7)).rejects.toThrow('Error validating TestTakers for workspace 7: read failed');
    await expect(f.service.validateGroupResponses(7)).rejects.toThrow('Error validating group responses for workspace 7: read failed');
  });
});
