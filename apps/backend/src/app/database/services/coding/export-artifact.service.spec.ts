import AdmZip = require('adm-zip');
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CacheService } from '../../../cache/cache.service';
import { ExportArtifactService } from './export-artifact.service';

describe('ExportArtifactService', () => {
  const tempDirs: string[] = [];

  const createService = () => {
    const values = new Map<string, unknown>();
    const cacheService = {
      get: jest.fn((key: string) => Promise.resolve(values.get(key) || null)),
      set: jest.fn((key: string, value: unknown) => {
        values.set(key, value);
        return Promise.resolve(true);
      }),
      delete: jest.fn((key: string) => {
        values.delete(key);
        return Promise.resolve(true);
      })
    };
    return {
      service: new ExportArtifactService(
        cacheService as unknown as CacheService
      ),
      cacheService,
      values
    };
  };

  const createTempDir = (): string => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'item-matrix-artifact-')
    );
    tempDirs.push(tempDir);
    return tempDir;
  };

  afterEach(() => {
    tempDirs.splice(0).forEach(tempDir => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  it('publishes, caches and resolves a completed export artifact', async () => {
    const { service, cacheService } = createService();
    const tempDir = createTempDir();
    const workingDir = fs.mkdtempSync(path.join(tempDir, '.working-'));
    const workingFilePath = path.join(workingDir, 'export_job-1.csv');
    fs.writeFileSync(workingFilePath, 'person;item\r\n1;2\r\n');
    const checkCancellation = jest.fn().mockResolvedValue(undefined);

    const result = await service.publishArtifact({
      jobId: 'job-1',
      workingFilePath,
      tempDir,
      fileName: 'export.csv',
      workspaceId: 7,
      userId: 3,
      exportType: 'detailed',
      checkCancellation
    });

    expect(result).toEqual(expect.objectContaining({
      fileId: 'job-1',
      fileName: 'export.csv',
      filePath: path.join(tempDir, 'export_job-1.csv'),
      fileSize: Buffer.byteLength('person;item\r\n1;2\r\n'),
      workspaceId: 7,
      userId: 3,
      exportType: 'detailed'
    }));
    expect(fs.existsSync(workingFilePath)).toBe(false);
    expect(checkCancellation).toHaveBeenCalledTimes(3);
    expect(cacheService.set).toHaveBeenCalledWith(
      ExportArtifactService.getExportResultCacheKey('job-1'),
      result,
      ExportArtifactService.ttlSeconds
    );
    await expect(service.getArtifact('job-1')).resolves.toEqual(result);
  });

  it('rolls back a completed artifact when caching fails', async () => {
    const { service, cacheService } = createService();
    const tempDir = createTempDir();
    const workingDir = fs.mkdtempSync(path.join(tempDir, '.working-'));
    const workingFilePath = path.join(workingDir, 'export_job-1.csv');
    const publishedFilePath = path.join(tempDir, 'export_job-1.csv');
    fs.writeFileSync(workingFilePath, 'data');
    cacheService.set.mockResolvedValueOnce(false);

    await expect(service.publishArtifact({
      jobId: 'job-1',
      workingFilePath,
      tempDir,
      fileName: 'export.csv',
      workspaceId: 7,
      userId: 3,
      exportType: 'detailed',
      checkCancellation: jest.fn().mockResolvedValue(undefined)
    })).rejects.toThrow('Export artifact could not be published');

    expect(fs.existsSync(publishedFilePath)).toBe(false);
    expect(cacheService.delete).toHaveBeenCalledWith(
      ExportArtifactService.getExportResultCacheKey('job-1')
    );
  });

  it('packages, publishes and caches an incomplete matrix atomically', async () => {
    const { service, cacheService } = createService();
    const tempDir = createTempDir();
    const workingDir = fs.mkdtempSync(path.join(tempDir, '.working-'));
    const matrixPath = path.join(workingDir, 'export_job-1.csv');
    fs.writeFileSync(matrixPath, 'person;item\r\n1;\r\n');
    const checkCancellation = jest.fn().mockResolvedValue(undefined);

    const result = await service.publishIncompleteArtifact({
      jobId: 'job-1',
      matrixPath,
      matrixExtension: 'csv',
      tempDir,
      workspaceId: 7,
      userId: 3,
      exportType: 'item-matrix',
      version: 'v2',
      matrixValue: 'score',
      missingsProfileId: 5,
      diagnostics: {
        total: 1,
        sampleLimit: 20,
        groups: [{
          reasonCode: 'missing-score',
          bookletName: 'BOOKLET-1',
          columnName: 'UNIT1_1',
          count: 1,
          sampleRowNumbers: [2]
        }]
      },
      checkCancellation
    });

    expect(fs.existsSync(matrixPath)).toBe(false);
    expect(fs.existsSync(result.filePath)).toBe(true);
    expect(checkCancellation).toHaveBeenCalledTimes(4);
    expect(new AdmZip(result.filePath).getEntries().map(entry => entry.entryName))
      .toEqual(expect.arrayContaining([
        'Itemdatensatz-UNVOLLSTAENDIG-' +
          `${new Date(result.createdAt).toISOString().slice(0, 10)}.csv`,
        'diagnose.csv',
        'README.txt'
      ]));
    expect(cacheService.set).toHaveBeenCalledTimes(2);
    await expect(service.getDiagnostics('job-1')).resolves.toEqual(
      expect.objectContaining({ total: 1 })
    );
    await expect(service.getErrorDetails('job-1', 99)).resolves.toEqual(
      expect.objectContaining({
        total: 1,
        groupCount: 1,
        diagnosticsAvailable: true,
        incompleteDownloadAvailable: true
      })
    );
  });

  it('reports unavailable packages when cached files are gone', async () => {
    const { service, values } = createService();
    values.set(
      ExportArtifactService.getIncompleteResultCacheKey('job-1'),
      { filePath: path.join(createTempDir(), 'missing.zip') }
    );

    await expect(service.getIncompleteArtifact('job-1')).resolves.toBeNull();
    await expect(service.getErrorDetails('job-1', 12)).resolves.toEqual({
      total: 12,
      groupCount: 0,
      sampleLimit: 20,
      diagnosticsAvailable: false,
      incompleteDownloadAvailable: false
    });
  });

  it('deletes files and cache entries idempotently', async () => {
    const { service, cacheService, values } = createService();
    const filePath = path.join(createTempDir(), 'export_job-1.zip');
    fs.writeFileSync(filePath, 'zip');
    values.set(
      ExportArtifactService.getIncompleteResultCacheKey('job-1'),
      { filePath }
    );

    await service.deleteArtifacts('job-1');
    await service.deleteArtifacts('job-1');

    expect(fs.existsSync(filePath)).toBe(false);
    expect(cacheService.delete).toHaveBeenCalledTimes(6);
  });

  it('removes only expired published artifacts', () => {
    const { service } = createService();
    const tempDir = createTempDir();
    const expiredPath = path.join(tempDir, 'export_old.zip');
    const freshPath = path.join(tempDir, 'export_fresh.csv');
    const unrelatedPath = path.join(tempDir, 'README.txt');
    [expiredPath, freshPath, unrelatedPath].forEach(filePath => {
      fs.writeFileSync(filePath, 'data');
    });
    const expiredDate = new Date(
      Date.now() - (ExportArtifactService.ttlSeconds + 1) * 1000
    );
    fs.utimesSync(expiredPath, expiredDate, expiredDate);

    service.cleanupExpiredArtifacts(tempDir);

    expect(fs.existsSync(expiredPath)).toBe(false);
    expect(fs.existsSync(freshPath)).toBe(true);
    expect(fs.existsSync(unrelatedPath)).toBe(true);
  });
});
