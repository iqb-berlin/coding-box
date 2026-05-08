import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import * as AdmZip from 'adm-zip';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import ResourcePackage from '../../entities/resource-package.entity';
import { ResourcePackageDto } from '../../../../../../../api-dto/resource-package/resource-package-dto';
import { ResourcePackageNotFoundException } from '../../../exceptions/resource-package-not-found.exception';

@Injectable()
export class ResourcePackageService {
  private static readonly geogebraPackageName = 'Geogebra';
  private static readonly geogebraBundleDownloadUrl = 'https://download.geogebra.org/package/geogebra-math-apps-bundle';

  private readonly logger = new Logger(ResourcePackageService.name);
  private resourcePackagesPath = './packages';

  constructor(
    @InjectRepository(ResourcePackage)
    private resourcePackageRepository: Repository<ResourcePackage>,
    private httpService: HttpService
  ) {
  }

  async findResourcePackages(workspaceId: number): Promise<ResourcePackageDto[]> {
    this.logger.log(`Returning resource packages for workspace ${workspaceId}.`);
    const resourcePackages = await this.resourcePackageRepository
      .find({
        where: [
          { workspaceId },
          { scope: 'global' }
        ],
        order: { createdAt: 'DESC' }
      });
    return this.deduplicateGlobalPackages(resourcePackages);
  }

  async removeResourcePackages(workspaceId: number, ids: number[]): Promise<void> {
    await Promise.all(ids.map(async id => this.removeResourcePackage(workspaceId, id)));
  }

  async removeResourcePackage(workspaceId: number, id: number): Promise<void> {
    this.logger.log(`Deleting resource package with id ${id} from workspace ${workspaceId}.`);
    const resourcePackage = await this.resourcePackageRepository
      .findOne({
        where: [
          { id: id, workspaceId: workspaceId },
          { id: id, scope: 'global' }
        ]
    });
    if (resourcePackage) {
      if (resourcePackage.scope === 'global') {
        await this.deleteGlobalPackageReferences(resourcePackage.name);
        this.removePackageDirectory(resourcePackage.name);
        return;
      }

      await this.resourcePackageRepository.delete(resourcePackage.id);
      const remainingReferences = await this.countPackageReferences(resourcePackage.name);
      if (remainingReferences === 0) {
        this.removePackageDirectory(resourcePackage.name);
      }
    } else {
      throw new ResourcePackageNotFoundException(id, 'DELETE');
    }
  }

  async create(workspaceId: number, zippedResourcePackage: Express.Multer.File): Promise<number> {
    this.logger.log(`Creating resource package for workspace ${workspaceId}.`);
    this.ensurePackagesDirectoryExists();
    const zip = new AdmZip(zippedResourcePackage.buffer);
    const packageName = this.getPackageNameFromFilename(zippedResourcePackage.originalname);
    this.assertSafePackageName(packageName);
    const packageFiles = this.getSafeZipEntryNames(zip);
    const contentHash = this.getContentHash(zippedResourcePackage.buffer);
    const isGlobalGeoGebraPackage = this.isGlobalGeoGebraPackage(packageName);
    const packageType = this.isGeoGebraPackage(packageFiles) ? 'geogebra' : 'resource';
    if (isGlobalGeoGebraPackage) {
      this.assertGeoGebraPackage(packageFiles);
    }
    const detectedVersion = packageType === 'geogebra' ?
      this.detectGeoGebraVersion(zip) :
      null;

    const existingPackages = await this.findPackagesByName(packageName);
    const existingPackage = await this.findMatchingPackageByContentHash(existingPackages, contentHash);
    if (existingPackage) {
      return this.createOrReturnExistingReference(
        workspaceId,
        existingPackage,
        packageFiles,
        zippedResourcePackage,
        contentHash,
        packageType,
        isGlobalGeoGebraPackage ? 'global' : 'workspace',
        detectedVersion
      );
    }

    if (existingPackages.length > 0) {
      throw new ConflictException(
        `Ein Ressourcenpaket mit dem Namen "${packageName}" existiert bereits mit anderem Inhalt. Bitte verwenden Sie einen anderen Paketnamen.`
      );
    }

    await this.extractAndStorePackage(packageName, zip, zippedResourcePackage);
    const newResourcePackage = await this.saveResourcePackageReference(
      isGlobalGeoGebraPackage ? 0 : workspaceId,
      packageName,
      packageFiles,
      zippedResourcePackage,
      contentHash,
      packageType,
      isGlobalGeoGebraPackage ? 'global' : 'workspace',
      detectedVersion
    );
    return newResourcePackage.id;
  }

  async getZippedResourcePackage(workspaceId: number, name: string): Promise<Buffer> {
    this.logger.log(`Returning zipped resource package ${name} for workspace ${workspaceId}.`);

    // Check if the resource package exists for the given workspace
    const resourcePackage = await this.resourcePackageRepository.findOne({
      where: [
        { name, workspaceId },
        { name, scope: 'global' }
      ]
    });

    if (!resourcePackage) {
      throw new ResourcePackageNotFoundException(0, 'GET', `Resource package ${name} not found in workspace ${workspaceId}`);
    }

    const zipPath = this.findStoredZipPath(resourcePackage);
    if (!zipPath) {
      throw new ResourcePackageNotFoundException(0, 'GET', `ZIP file for resource package ${name} not found`);
    }
    return fs.readFileSync(zipPath);
  }

  async installGeoGebraBundle(): Promise<ResourcePackageDto> {
    const existingGeoGebraPackage = await this.findGlobalGeoGebraPackage();
    if (existingGeoGebraPackage) {
      return existingGeoGebraPackage;
    }

    this.logger.log('Downloading GeoGebra Math Apps Bundle.');
    const response = await this.httpService.axiosRef.get<ArrayBuffer>(
      ResourcePackageService.geogebraBundleDownloadUrl,
      {
        responseType: 'arraybuffer',
        timeout: 120000
      }
    );
    const buffer = Buffer.from(response.data);
    const uploadedFile = {
      originalname: `${ResourcePackageService.geogebraPackageName}.itcr.zip`,
      mimetype: 'application/zip',
      buffer,
      size: buffer.length
    } as Express.Multer.File;

    await this.create(0, uploadedFile);
    const installedPackage = await this.findGlobalGeoGebraPackage();
    if (!installedPackage) {
      throw new Error('GeoGebra installation did not create a resource package entry');
    }
    return installedPackage;
  }

  async findGlobalGeoGebraPackage(): Promise<ResourcePackageDto | null> {
    const resourcePackage = await this.resourcePackageRepository
      .createQueryBuilder('resourcePackage')
      .where('LOWER(resourcePackage.name) = LOWER(:name)', {
        name: ResourcePackageService.geogebraPackageName
      })
      .andWhere('resourcePackage.scope = :scope', { scope: 'global' })
      .orderBy('resourcePackage.createdAt', 'DESC')
      .getOne();
    return resourcePackage || null;
  }

  private async createOrReturnExistingReference(
    workspaceId: number,
    existingPackage: ResourcePackage,
    packageFiles: string[],
    zippedResourcePackage: Express.Multer.File,
    contentHash: string,
    packageType: 'resource' | 'geogebra',
    scope: 'workspace' | 'global',
    detectedVersion: string | null
  ): Promise<number> {
    if (existingPackage.scope === 'global' || scope === 'global') {
      return existingPackage.id;
    }

    const existingWorkspaceReference = await this.resourcePackageRepository.findOne({
      where: {
        workspaceId,
        name: existingPackage.name
      }
    });
    if (existingWorkspaceReference) {
      return existingWorkspaceReference.id;
    }
    const newReference = await this.saveResourcePackageReference(
      workspaceId,
      existingPackage.name,
      packageFiles,
      zippedResourcePackage,
      contentHash,
      packageType,
      scope,
      detectedVersion
    );
    return newReference.id;
  }

  private async saveResourcePackageReference(
    workspaceId: number,
    packageName: string,
    packageFiles: string[],
    zippedResourcePackage: Express.Multer.File,
    contentHash: string,
    packageType: 'resource' | 'geogebra',
    scope: 'workspace' | 'global',
    detectedVersion: string | null
  ): Promise<ResourcePackage> {
    const packageSize = zippedResourcePackage.buffer.length;
    const newResourcePackage = this.resourcePackageRepository.create({
      workspaceId,
      name: packageName,
      elements: packageFiles,
      packageSize,
      packageType,
      scope,
      detectedVersion,
      contentHash,
      originalFilename: `${packageName}.itcr.zip`,
      createdAt: new Date()
    });
    return this.resourcePackageRepository.save(newResourcePackage);
  }

  private async extractAndStorePackage(
    packageName: string,
    zip: AdmZip,
    zippedResourcePackage: Express.Multer.File
  ): Promise<void> {
    const packageDirectoryPath = this.getPackageDirectoryPath(packageName);
    const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync.bind(zip));
    await zipExtractAllToAsync(packageDirectoryPath, true, true);
    fs.writeFileSync(
      path.join(packageDirectoryPath, `${packageName}.itcr.zip`),
      zippedResourcePackage.buffer
    );
  }

  private async findPackagesByName(packageName: string): Promise<ResourcePackage[]> {
    return this.resourcePackageRepository
      .createQueryBuilder('resourcePackage')
      .where('LOWER(resourcePackage.name) = LOWER(:name)', { name: packageName })
      .orderBy('resourcePackage.createdAt', 'DESC')
      .getMany();
  }

  private async findMatchingPackageByContentHash(
    existingPackages: ResourcePackage[],
    contentHash: string
  ): Promise<ResourcePackage | null> {
    for (const resourcePackage of existingPackages) {
      const existingHash = await this.getStoredContentHash(resourcePackage);
      if (existingHash === contentHash) {
        return resourcePackage;
      }
    }
    return null;
  }

  private async getStoredContentHash(resourcePackage: ResourcePackage): Promise<string | null> {
    if (resourcePackage.contentHash) {
      return resourcePackage.contentHash;
    }
    const zipPath = this.findStoredZipPath(resourcePackage);
    if (!zipPath) {
      return null;
    }
    const contentHash = this.getContentHash(fs.readFileSync(zipPath));
    resourcePackage.contentHash = contentHash;
    await this.resourcePackageRepository.save(resourcePackage);
    return contentHash;
  }

  private getPackageNameFromFilename(filename: string): string {
    const match = path.basename(filename).match(/^(.+)\.itcr\.zip$/i);
    if (!match) {
      throw new BadRequestException('Bitte laden Sie ein Ressourcenpaket mit der Endung .itcr.zip hoch.');
    }
    return match[1];
  }

  private assertSafePackageName(packageName: string): void {
    if (!/^[a-zA-Z0-9._-]+$/.test(packageName)) {
      throw new BadRequestException('Der Paketname darf nur Buchstaben, Zahlen, Punkte, Unterstriche und Bindestriche enthalten.');
    }
  }

  private getSafeZipEntryNames(zip: AdmZip): string[] {
    return zip.getEntries()
      .map(entry => entry.entryName.replace(/\\/g, '/'))
      .map(entryName => {
        if (
          path.posix.isAbsolute(entryName) ||
          entryName.split('/').includes('..')
        ) {
          throw new BadRequestException('Das ZIP enthält unsichere Dateipfade.');
        }
        return entryName;
      });
  }

  private assertGeoGebraPackage(packageFiles: string[]): void {
    if (
      !packageFiles.includes('GeoGebra/deployggb.js') ||
      !packageFiles.includes('GeoGebra/HTML5/5.0/GeoGebra.html')
    ) {
      throw new BadRequestException('Das GeoGebra-Paket muss GeoGebra/deployggb.js und GeoGebra/HTML5/5.0/GeoGebra.html enthalten.');
    }
  }

  private detectGeoGebraVersion(zip: AdmZip): string | null {
    const geoGebraHtml = zip.getEntry('GeoGebra/HTML5/5.0/GeoGebra.html');
    if (!geoGebraHtml) {
      return null;
    }
    const htmlContent = geoGebraHtml.getData().toString('utf8');
    const versionMatch = htmlContent.match(/latestVersion\s*=\s*["']([^"']+)["']/);
    return versionMatch?.[1] || null;
  }

  private isGeoGebraPackage(packageFiles: string[]): boolean {
    return packageFiles.includes('GeoGebra/deployggb.js');
  }

  private isGlobalGeoGebraPackage(packageName: string): boolean {
    return packageName.toLowerCase() === ResourcePackageService.geogebraPackageName.toLowerCase();
  }

  private findStoredZipPath(resourcePackage: ResourcePackage): string | null {
    const packageDirectoryPath = this.getExistingPackageDirectoryPath(resourcePackage.name);
    const preferredFilename = resourcePackage.originalFilename || `${resourcePackage.name}.itcr.zip`;
    const preferredZipPath = path.join(packageDirectoryPath, preferredFilename);
    if (fs.existsSync(preferredZipPath)) {
      return preferredZipPath;
    }
    const legacyZipPath = path.join(packageDirectoryPath, `${resourcePackage.name}.itcs.zip`);
    if (fs.existsSync(legacyZipPath)) {
      return legacyZipPath;
    }
    if (!fs.existsSync(packageDirectoryPath)) {
      return null;
    }
    const matchingZipFile = fs.readdirSync(packageDirectoryPath)
      .find(file => file.toLowerCase().endsWith('.itcr.zip'));
    return matchingZipFile ? path.join(packageDirectoryPath, matchingZipFile) : null;
  }

  private async deleteGlobalPackageReferences(packageName: string): Promise<void> {
    await this.resourcePackageRepository
      .createQueryBuilder()
      .delete()
      .from(ResourcePackage)
      .where('LOWER(name) = LOWER(:packageName)', { packageName })
      .andWhere('scope = :scope', { scope: 'global' })
      .execute();
  }

  private async countPackageReferences(packageName: string): Promise<number> {
    return this.resourcePackageRepository
      .createQueryBuilder('resourcePackage')
      .where('LOWER(resourcePackage.name) = LOWER(:packageName)', { packageName })
      .getCount();
  }

  private removePackageDirectory(packageName: string): void {
    const elementPath = this.getExistingPackageDirectoryPath(packageName);
    if (fs.existsSync(elementPath)) {
      fs.rmSync(elementPath, { recursive: true, force: true });
    }
  }

  private getContentHash(buffer: Buffer): string {
    return crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex');
  }

  private getPackageDirectoryPath(packageName: string): string {
    return path.join(this.resourcePackagesPath, packageName);
  }

  private getExistingPackageDirectoryPath(packageName: string): string {
    const exactPackageDirectoryPath = this.getPackageDirectoryPath(packageName);
    if (fs.existsSync(exactPackageDirectoryPath) || !fs.existsSync(this.resourcePackagesPath)) {
      return exactPackageDirectoryPath;
    }
    const matchingDirectory = fs.readdirSync(this.resourcePackagesPath, { withFileTypes: true })
      .find(entry => entry.isDirectory() && entry.name.toLowerCase() === packageName.toLowerCase());
    return matchingDirectory ?
      path.join(this.resourcePackagesPath, matchingDirectory.name) :
      exactPackageDirectoryPath;
  }

  private ensurePackagesDirectoryExists(): void {
    fs.mkdirSync(this.resourcePackagesPath, { recursive: true });
  }

  private deduplicateGlobalPackages(resourcePackages: ResourcePackage[]): ResourcePackageDto[] {
    const seenGlobalPackages = new Set<string>();
    return resourcePackages.filter(resourcePackage => {
      if (resourcePackage.scope !== 'global') {
        return true;
      }
      const key = resourcePackage.name.toLowerCase();
      if (seenGlobalPackages.has(key)) {
        return false;
      }
      seenGlobalPackages.add(key);
      return true;
    });
  }
}
