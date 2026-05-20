import { BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ResourcePackage from '../../entities/resource-package.entity';
import { ResourcePackageService } from './resource-package.service';

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
