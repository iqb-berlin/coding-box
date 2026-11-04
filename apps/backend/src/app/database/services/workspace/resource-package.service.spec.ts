import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import AdmZip from 'adm-zip';
import fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { spawnSync } from 'child_process';
import ResourcePackage from '../../entities/resource-package.entity';
import { ResourcePackageService } from './resource-package.service';
import { RESOURCE_PACKAGE_LIMITS } from './resource-package-limits';

// PostgreSQL integration tests exercise the actual cross-process package lease.
jest.mock('../shared/resource-package-lock.util', () => ({
  withResourcePackageLock: jest.fn((_connection, _name, callback: () => Promise<unknown>) => callback())
}));

describe('ResourcePackageService', () => {
  let packagesPath: string;
  let packages: ResourcePackage[];
  let repository: Repository<ResourcePackage>;
  let httpService: {
    axiosRef: {
      get: jest.Mock;
    };
  };
  let configService: {
    get: jest.Mock;
  };
  let service: ResourcePackageService;
  let nextId: number;

  beforeEach(() => {
    packagesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kodierbox-packages-'));
    packages = [];
    nextId = 1;
    repository = createResourcePackageRepository();
    httpService = {
      axiosRef: {
        get: jest.fn()
      }
    };
    configService = {
      get: jest.fn()
    };
    service = new ResourcePackageService(
      repository,
      httpService as unknown as HttpService,
      configService as unknown as ConfigService
    );
    (
      service as unknown as {
        resourcePackagesPath: string;
      }
    ).resourcePackagesPath = packagesPath;
  });

  afterEach(() => {
    fs.rmSync(packagesPath, { recursive: true, force: true });
  });

  it('rejects a corrupt later ZIP entry without an uncaught exception or partial package', () => {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, 'resource-package-extraction.fixture.cjs'), process.cwd()
    ], { encoding: 'utf8', timeout: 10000 });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ rejected: true, leftovers: [] });
  });

  it('preserves ordinary package content and empty directories without privileged permission bits', async () => {
    const zip = new AdmZip();
    const binary = Buffer.from([0, 255, 128, 13, 10]);
    zip.addFile('empty/', Buffer.alloc(0), '', 0o2700);
    zip.addFile('data/ä.txt', Buffer.from('Grüße'), '', 0o4600);
    zip.addFile('data/image.bin', binary);
    const buffer = zip.toBuffer();

    await service.create(7, createUpload('Ordinary.itcr.zip', buffer));

    const directory = path.join(packagesPath, 'Ordinary');
    expect(fs.readFileSync(path.join(directory, 'data/ä.txt'), 'utf8')).toBe('Grüße');
    expect(fs.readFileSync(path.join(directory, 'data/image.bin'))).toEqual(binary);
    expect(fs.readdirSync(path.join(directory, 'empty'))).toEqual([]);
    expect(fs.statSync(path.join(directory, 'empty')).mode % 4096).toBe(0o700);
    expect(fs.statSync(path.join(directory, 'data/ä.txt')).mode % 4096).toBe(0o600);
    expect(fs.readFileSync(path.join(directory, 'Ordinary.itcr.zip'))).toEqual(buffer);
    expect(packages[0]).toMatchObject({ name: 'Ordinary', workspaceId: 7, scope: 'workspace' });
  });

  describe('archive limits', () => {
    beforeEach(() => {
      // Exercise real archive parsing and decompression with small fixtures.
      jest.replaceProperty(RESOURCE_PACKAGE_LIMITS, 'maxArchiveBytes', 4096);
      jest.replaceProperty(RESOURCE_PACKAGE_LIMITS, 'maxEntryBytes', 2048);
      jest.replaceProperty(RESOURCE_PACKAGE_LIMITS, 'maxExtractedBytes', 4096);
      jest.replaceProperty(RESOURCE_PACKAGE_LIMITS, 'maxEntries', 12);
    });

    afterEach(() => jest.restoreAllMocks());

    it('rejects an oversized buffer even when the upload reports a small size', async () => {
      const upload = createUpload('Large.itcr.zip', Buffer.alloc(4097));
      upload.size = 0;
      await expect(service.create(7, upload)).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(repository.save).not.toHaveBeenCalled();
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('rejects the declared entry count before parsing missing directory entries', async () => {
      const buffer = createZip({ 'a.txt': 'a' });
      const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      buffer.writeUInt16LE(13, end + 8);
      buffer.writeUInt16LE(13, end + 10);
      await expect(service.create(7, createUpload('Entries.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('rejects a real archive with too many entries', async () => {
      const buffer = createZip(Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`${i}.txt`, 'a'])));
      await expect(service.create(7, createUpload('Entries.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(PayloadTooLargeException);
    });

    it.each([
      'a'.repeat(1025),
      'ä'.repeat(513),
      `${'dir/'.repeat(32)}file.txt`,
      `${'dir\\'.repeat(32)}file.txt`
    ])('bounds path metadata before implicit directory expansion: %s', async entryName => {
      const buffer = createZip({ [entryName]: 'a' });
      await expect(service.create(7, createUpload('Paths.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('counts implicit directory prefixes before adm-zip allocates them', () => {
      const buffer = createZip({
        'a/a/a/a/a/a/file.txt': 'a',
        'b/b/b/b/b/b/file.txt': 'b'
      });
      const zip = (service as unknown as { readZip: (value: Buffer) => AdmZip }).readZip(buffer);
      expect(zip.getEntryCount()).toBe(2);
      expect(() => zip.getEntries()).toThrow(PayloadTooLargeException);
      // A post-expansion guard would leave 14 internally allocated entries.
      expect(zip.getEntryCount()).toBe(2);
    });

    it('bounds a chunked remote GeoGebra response before buffering it completely', async () => {
      const server = createServer((_request, response) => {
        response.write(Buffer.alloc(2048));
        response.end(Buffer.alloc(2049));
      });
      await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
      const address = server.address() as AddressInfo;
      configService.get.mockReturnValue(`http://127.0.0.1:${address.port}/bundle.zip`);
      const remoteService = new ResourcePackageService(repository, new HttpService(), configService as unknown as ConfigService);
      (remoteService as unknown as { resourcePackagesPath: string }).resourcePackagesPath = packagesPath;
      try {
        await expect(remoteService.installGeoGebraBundle()).rejects.toBeInstanceOf(BadRequestException);
        expect(repository.save).not.toHaveBeenCalled();
        expect(fs.readdirSync(packagesPath)).toEqual([]);
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close(error => { if (error) reject(error); else resolve(); });
        });
      }
    });

    it('rejects a highly compressed oversized entry before extraction', async () => {
      const buffer = createZip({ 'large.txt': 'a'.repeat(2049) });
      await expect(service.create(7, createUpload('Large.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('rejects excessive total uncompressed size across individually valid entries', async () => {
      const buffer = createZip({ a: 'a'.repeat(2048), b: 'b'.repeat(2048), c: 'c' });
      await expect(service.create(7, createUpload('Total.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects a STORED entry whose compressed extent disagrees with its declared size', async () => {
      const zip = new AdmZip();
      zip.addFile('stored.txt', Buffer.from('content'));
      zip.getEntry('stored.txt')!.header.method = 0;
      const buffer = zip.toBuffer();
      const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      buffer.writeUInt32LE(0, central + 24);
      await expect(service.create(7, createUpload('Stored.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('rejects DEFLATED output exceeding a forged declared size without leaving files', async () => {
      const buffer = createZip({ 'deflated.txt': 'a'.repeat(2048) });
      const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      buffer.writeUInt32LE(1, central + 24);
      await expect(service.create(7, createUpload('Forged.itcr.zip', buffer))).rejects.toThrow();
      expect(packages).toHaveLength(0);
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('rejects actual output shorter than its declared size', async () => {
      const buffer = createZip({ 'short.txt': 'short' });
      const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      buffer.writeUInt32LE(20, central + 24);
      await expect(service.create(7, createUpload('Short.itcr.zip', buffer)))
        .rejects.toBeInstanceOf(BadRequestException);
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('bounds GeoGebra version HTML and every entry excluded from global normalization', async () => {
      for (const oversizedName of ['GeoGebra/HTML5/5.0/GeoGebra.html', 'outside.txt']) {
        const buffer = createZip({
          'GeoGebra/deployggb.js': 'deploy',
          'GeoGebra/HTML5/5.0/GeoGebra.html': 'latestVersion = "1.0"',
          [oversizedName]: 'x'.repeat(2049)
        });
        await expect(service.create(7, createUpload('Geogebra.itcr.zip', buffer)))
          .rejects.toBeInstanceOf(PayloadTooLargeException);
      }
      expect(fs.readdirSync(packagesPath)).toEqual([]);
    });

    it('accepts entries at the byte limits and streams the original ZIP back', async () => {
      const buffer = createZip({ a: 'a'.repeat(2048), b: 'b'.repeat(2048) });
      await service.create(7, createUpload('Boundary.itcr.zip', buffer));
      const { stream, size } = await service.getZippedResourcePackage(7, 'Boundary');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(Buffer.concat(chunks)).toEqual(buffer);
      expect(size).toBe(buffer.length);
      expect(packages).toHaveLength(1);
    });
  });

  it.each(['Legacy.itcs.zip', 'OTHER.ITCR.ZIP'])('streams and hashes legacy ZIP %s with case-insensitive directory lookup', async filename => {
    const buffer = createZip({ a: 'content' });
    fs.mkdirSync(path.join(packagesPath, 'legacy'));
    fs.writeFileSync(path.join(packagesPath, 'legacy', filename), buffer);
    packages.push({
      id: 1, name: 'Legacy', workspaceId: 7, scope: 'workspace'
    } as ResourcePackage);

    const { stream } = await service.getZippedResourcePackage(7, 'Legacy');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(buffer);
    await service.create(7, createUpload('Legacy.itcr.zip', buffer));
    expect(packages).toHaveLength(1);
    expect(packages[0].contentHash).toBe(createHash('sha256').update(buffer).digest('hex'));
  });

  it('should install the current GeoGebra bundle ZIP layout', async () => {
    const bundle = createGeoGebraBundle('GeoGebra', '6.0.1');

    const id = await service.create(1, createUpload('Geogebra.itcr.zip', bundle));

    expect(id).toBe(1);
    expect(packages[0]).toMatchObject({
      name: 'Geogebra',
      workspaceId: 0,
      packageType: 'geogebra',
      scope: 'global',
      detectedVersion: '6.0.1'
    });
    expect(packages[0].elements).toEqual(expect.arrayContaining([
      'GeoGebra/deployggb.js',
      'GeoGebra/HTML5/5.0/GeoGebra.html'
    ]));
    expect(fs.existsSync(path.join(
      packagesPath,
      'Geogebra',
      'GeoGebra',
      'deployggb.js'
    ))).toBe(true);
  });

  it('should normalize nested GeoGebra bundle ZIP layouts', async () => {
    const bundle = createGeoGebraBundle('geogebra-math-apps-bundle/GeoGebra', '6.0.2');

    await service.create(1, createUpload('Geogebra.itcr.zip', bundle));

    expect(packages[0].elements).toEqual(expect.arrayContaining([
      'GeoGebra/deployggb.js',
      'GeoGebra/HTML5/5.0/GeoGebra.html',
      'GeoGebra/HTML5/5.0/web3d/web3d.nocache.js'
    ]));
    expect(fs.existsSync(path.join(
      packagesPath,
      'Geogebra',
      'GeoGebra',
      'HTML5',
      '5.0',
      'GeoGebra.html'
    ))).toBe(true);
    expect(fs.existsSync(path.join(
      packagesPath,
      'Geogebra',
      'geogebra-math-apps-bundle'
    ))).toBe(false);
  });

  it('should preserve non-GeoGebra files in workspace packages that contain GeoGebra bundles', async () => {
    const bundle = createZip({
      'GeoGebra/deployggb.js': 'deploy',
      'GeoGebra/HTML5/5.0/GeoGebra.html': 'latestVersion = "6.0.3"',
      'images/foo.png': 'image'
    });

    await service.create(7, createUpload('Mixed.itcr.zip', bundle));

    expect(packages[0]).toMatchObject({
      name: 'Mixed',
      workspaceId: 7,
      packageType: 'geogebra',
      scope: 'workspace',
      detectedVersion: '6.0.3'
    });
    expect(packages[0].elements).toEqual(expect.arrayContaining([
      'GeoGebra/deployggb.js',
      'GeoGebra/HTML5/5.0/GeoGebra.html',
      'images/foo.png'
    ]));
    expect(fs.existsSync(path.join(
      packagesPath,
      'Mixed',
      'images',
      'foo.png'
    ))).toBe(true);
  });

  it('should reject global GeoGebra packages with split or missing bundle files', async () => {
    const zip = createZip({
      'GeoGebra/deployggb.js': 'deploy',
      'Other/HTML5/5.0/GeoGebra.html': '<html></html>'
    });

    await expect(service.create(1, createUpload('Geogebra.itcr.zip', zip)))
      .rejects
      .toBeInstanceOf(BadRequestException);

    expect(packages).toHaveLength(0);
    expect(fs.existsSync(path.join(packagesPath, 'Geogebra'))).toBe(false);
  });

  it('should use a configured GeoGebra download URL and report download failures', async () => {
    configService.get.mockReturnValue('https://mirror.example/geogebra.zip');
    httpService.axiosRef.get.mockRejectedValue(new Error('not found'));

    await expect(service.installGeoGebraBundle())
      .rejects
      .toBeInstanceOf(BadRequestException);

    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://mirror.example/geogebra.zip',
      {
        responseType: 'arraybuffer',
        maxContentLength: RESOURCE_PACKAGE_LIMITS.maxArchiveBytes,
        timeout: 120000
      }
    );
    expect(packages).toHaveLength(0);
  });

  it('should keep an invalid existing GeoGebra package when replacement download fails', async () => {
    packages.push({
      id: nextId,
      name: 'Geogebra',
      workspaceId: 0,
      packageType: 'geogebra',
      scope: 'global',
      elements: ['GeoGebra/deployggb.js'],
      packageSize: 12,
      createdAt: new Date()
    } as ResourcePackage);
    nextId += 1;
    fs.mkdirSync(path.join(packagesPath, 'Geogebra', 'GeoGebra'), { recursive: true });
    fs.writeFileSync(path.join(packagesPath, 'Geogebra', 'GeoGebra', 'deployggb.js'), 'deploy');
    httpService.axiosRef.get.mockRejectedValue(new Error('not found'));

    await expect(service.installGeoGebraBundle())
      .rejects
      .toBeInstanceOf(BadRequestException);

    expect(packages).toHaveLength(1);
    expect(packages[0].elements).toEqual(['GeoGebra/deployggb.js']);
    expect(fs.existsSync(path.join(packagesPath, 'Geogebra', 'GeoGebra', 'deployggb.js'))).toBe(true);
  });

  it('should replace invalid existing global GeoGebra packages during installation', async () => {
    packages.push({
      id: nextId,
      name: 'Geogebra',
      workspaceId: 0,
      packageType: 'geogebra',
      scope: 'global',
      elements: ['GeoGebra/deployggb.js'],
      packageSize: 12,
      createdAt: new Date()
    } as ResourcePackage);
    nextId += 1;
    fs.mkdirSync(path.join(packagesPath, 'Geogebra', 'GeoGebra'), { recursive: true });
    fs.writeFileSync(path.join(packagesPath, 'Geogebra', 'GeoGebra', 'deployggb.js'), 'deploy');
    httpService.axiosRef.get.mockResolvedValue({
      data: createGeoGebraBundle('GeoGebra', '6.0.4')
    });

    const installedPackage = await service.installGeoGebraBundle();

    expect(httpService.axiosRef.get).toHaveBeenCalled();
    expect(installedPackage).toMatchObject({
      name: 'Geogebra',
      workspaceId: 0,
      packageType: 'geogebra',
      scope: 'global',
      detectedVersion: '6.0.4'
    });
    expect(packages).toHaveLength(1);
    expect(packages[0].elements).toEqual(
      expect.arrayContaining(['GeoGebra/deployggb.js', 'GeoGebra/HTML5/5.0/GeoGebra.html'])
    );
    expect(
      fs.existsSync(path.join(packagesPath, 'Geogebra', 'GeoGebra', 'HTML5', '5.0', 'GeoGebra.html'))
    ).toBe(true);
  });

  function createResourcePackageRepository(): Repository<ResourcePackage> {
    return {
      manager: { connection: {} },
      create: jest.fn((resourcePackage: ResourcePackage) => resourcePackage),
      save: jest.fn(async (resourcePackage: ResourcePackage) => {
        if (!resourcePackage.id) {
          resourcePackage.id = nextId;
          nextId += 1;
        }
        const existingIndex = packages.findIndex(pkg => pkg.id === resourcePackage.id);
        if (existingIndex === -1) {
          packages.push(resourcePackage);
        } else {
          packages[existingIndex] = resourcePackage;
        }
        return resourcePackage;
      }),
      findOne: jest.fn(async (options?: { where?: Partial<ResourcePackage> | Partial<ResourcePackage>[] }) => {
        const whereConditions = Array.isArray(options?.where) ? options.where : [options?.where];
        return (
          packages.find(resourcePackage => whereConditions.some(
            where => where && matchesWhere(resourcePackage, where)
          )
          ) || null
        );
      }),
      createQueryBuilder: jest.fn(() => createQueryBuilder())
    } as unknown as Repository<ResourcePackage>;
  }

  function createQueryBuilder() {
    const params: Record<string, unknown> = {};
    let isDeleteQuery = false;
    const builder = {
      where: jest.fn((_condition: string, queryParams?: Record<string, unknown>) => {
        Object.assign(params, queryParams || {});
        return builder;
      }),
      andWhere: jest.fn((_condition: string, queryParams?: Record<string, unknown>) => {
        Object.assign(params, queryParams || {});
        return builder;
      }),
      orderBy: jest.fn(() => builder),
      addOrderBy: jest.fn(() => builder),
      getMany: jest.fn(async () => packages.filter(resourcePackage => matchesParams(
        resourcePackage,
        params
      ))),
      getOne: jest.fn(async () => packages.find(resourcePackage => matchesParams(
        resourcePackage,
        params
      )) || null),
      getCount: jest.fn(async () => packages.filter(resourcePackage => matchesParams(
        resourcePackage,
        params
      )).length),
      delete: jest.fn(() => {
        isDeleteQuery = true;
        return builder;
      }),
      from: jest.fn(() => builder),
      execute: jest.fn(async () => {
        if (!isDeleteQuery) {
          return { affected: 0 };
        }
        const beforeDelete = packages.length;
        const remainingPackages = packages.filter(resourcePackage => !matchesParams(resourcePackage, {
          name: params.packageName,
          scope: params.scope,
          retainedId: params.retainedId
        }));
        packages.splice(0, packages.length, ...remainingPackages);
        return { affected: beforeDelete - packages.length };
      })
    };
    return builder;
  }

  function matchesWhere(
    resourcePackage: ResourcePackage,
    where: Partial<ResourcePackage>
  ): boolean {
    const resourcePackageRecord = resourcePackage as unknown as Record<string, unknown>;
    return Object.entries(where).every(([key, value]) => resourcePackageRecord[key] === value);
  }

  function matchesParams(
    resourcePackage: ResourcePackage,
    params: Record<string, unknown>
  ): boolean {
    const name = typeof params.name === 'string' ? params.name : null;
    const scope = typeof params.scope === 'string' ? params.scope : null;
    const workspaceId = typeof params.workspaceId === 'number' ? params.workspaceId : null;
    const retainedId = typeof params.retainedId === 'number' ? params.retainedId : null;
    return (!name || resourcePackage.name.toLowerCase() === name.toLowerCase()) &&
      (!scope || resourcePackage.scope === scope) &&
      (retainedId === null || resourcePackage.id !== retainedId) &&
      (workspaceId === null ||
        resourcePackage.workspaceId === workspaceId ||
        resourcePackage.scope === scope);
  }

  function createGeoGebraBundle(bundleRoot: string, version: string): Buffer {
    return createZip({
      [`${bundleRoot}/deployggb.js`]: 'deploy',
      [`${bundleRoot}/HTML5/5.0/GeoGebra.html`]: `latestVersion = "${version}"`,
      [`${bundleRoot}/HTML5/5.0/web3d/web3d.nocache.js`]: 'web3d'
    });
  }

  function createZip(files: Record<string, string>): Buffer {
    const zip = new AdmZip();
    Object.entries(files).forEach(([filename, content]) => {
      zip.addFile(filename, Buffer.from(content));
    });
    return zip.toBuffer();
  }

  function createUpload(originalname: string, buffer: Buffer): Express.Multer.File {
    return {
      originalname,
      mimetype: 'application/zip',
      buffer,
      size: buffer.length
    } as Express.Multer.File;
  }
});
