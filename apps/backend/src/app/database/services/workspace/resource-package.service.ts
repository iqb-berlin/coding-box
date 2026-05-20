import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
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
import { GeoGebraPackageStatus } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { ResourcePackageNotFoundException } from '../../../exceptions/resource-package-not-found.exception';

type SafeZipEntry = {
  entry: AdmZip.IZipEntry;
  entryName: string;
};

type GeoGebraPackageLayout = {
  bundleRoot: string;
  packageFiles: string[];
  geoGebraHtmlEntryName: string;
};

type PreparedResourcePackageUpload = {
  zip: AdmZip;
  packageName: string;
  packageFiles: string[];
  safeZipEntries: SafeZipEntry[];
  geoGebraPackageLayout: GeoGebraPackageLayout | null;
  contentHash: string;
  packageType: 'resource' | 'geogebra';
  scope: 'workspace' | 'global';
  detectedVersion: string | null;
};

@Injectable()
export class ResourcePackageService {
  private static readonly geogebraPackageName = 'Geogebra';
  private static readonly geogebraDirectoryName = 'GeoGebra';
  private static readonly geogebraBundleDownloadUrlConfigKey = 'GEOGEBRA_BUNDLE_DOWNLOAD_URL';
  private static readonly defaultGeogebraBundleDownloadUrl = 'https://download.geogebra.org/package/geogebra-math-apps-bundle';
  private static readonly geogebraDeployFileName = 'deployggb.js';
  private static readonly geogebraHtmlRelativePath = 'HTML5/5.0/GeoGebra.html';
  private static readonly requiredGeoGebraPackageFiles = [
    'GeoGebra/deployggb.js',
    'GeoGebra/HTML5/5.0/GeoGebra.html'
  ];

  private readonly logger = new Logger(ResourcePackageService.name);
  private resourcePackagesPath = './packages';

  constructor(
    @InjectRepository(ResourcePackage)
    private resourcePackageRepository: Repository<ResourcePackage>,
    private httpService: HttpService,
    private configService: ConfigService
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
    const preparedUpload = this.prepareResourcePackageUpload(zippedResourcePackage);

    const existingPackages = await this.findPackagesByName(preparedUpload.packageName);
    const existingPackage = await this.findMatchingPackageByContentHash(existingPackages, preparedUpload.contentHash);
    if (existingPackage) {
      return this.createOrReturnExistingReference(
        workspaceId,
        existingPackage,
        preparedUpload.packageFiles,
        zippedResourcePackage,
        preparedUpload.contentHash,
        preparedUpload.packageType,
        preparedUpload.scope,
        preparedUpload.detectedVersion
      );
    }

    if (existingPackages.length > 0) {
      throw new ConflictException(
        `Ein Ressourcenpaket mit dem Namen "${preparedUpload.packageName}" existiert bereits mit anderem Inhalt. Bitte verwenden Sie einen anderen Paketnamen.`
      );
    }

    await this.extractAndStorePackage(
      preparedUpload.packageName,
      preparedUpload.zip,
      zippedResourcePackage,
      preparedUpload.safeZipEntries,
      preparedUpload.geoGebraPackageLayout
    );
    const newResourcePackage = await this.saveResourcePackageReference(
      preparedUpload.scope === 'global' ? 0 : workspaceId,
      preparedUpload.packageName,
      preparedUpload.packageFiles,
      zippedResourcePackage,
      preparedUpload.contentHash,
      preparedUpload.packageType,
      preparedUpload.scope,
      preparedUpload.detectedVersion
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
      const existingErrors = this.validateGeoGebraPackageReference(existingGeoGebraPackage);
      if (existingErrors.length === 0) {
        return existingGeoGebraPackage;
      }
      this.logger.warn(
        `Existing GeoGebra package is invalid and will be replaced: ${existingErrors.join(' ')}`
      );
      const uploadedFile = await this.downloadGeoGebraBundleAsUpload();
      return this.replaceGlobalGeoGebraPackage(uploadedFile);
    }

    const uploadedFile = await this.downloadGeoGebraBundleAsUpload();

    await this.create(0, uploadedFile);
    const installedPackage = await this.findGlobalGeoGebraPackage();
    if (!installedPackage) {
      throw new Error('GeoGebra installation did not create a resource package entry');
    }
    return installedPackage;
  }

  private async downloadGeoGebraBundleAsUpload(): Promise<Express.Multer.File> {
    const downloadUrl = this.getGeoGebraBundleDownloadUrl();
    this.logger.log(`Downloading GeoGebra Math Apps Bundle from ${downloadUrl}.`);
    let response;
    try {
      response = await this.httpService.axiosRef.get<ArrayBuffer>(
        downloadUrl,
        {
          responseType: 'arraybuffer',
          timeout: 120000
        }
      );
    } catch (error) {
      this.logger.error(
        `GeoGebra Math Apps Bundle download failed: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new BadRequestException(
        `GeoGebra Math Apps Bundle konnte nicht von ${downloadUrl} heruntergeladen werden.`
      );
    }
    const buffer = Buffer.from(response.data);
    return {
      originalname: `${ResourcePackageService.geogebraPackageName}.itcr.zip`,
      mimetype: 'application/zip',
      buffer,
      size: buffer.length
    } as Express.Multer.File;
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

  async getGeoGebraPackageStatus(
    workspaceId: number
  ): Promise<GeoGebraPackageStatus> {
    const packages = await this.resourcePackageRepository
      .createQueryBuilder('resourcePackage')
      .where('LOWER(resourcePackage.name) = LOWER(:name)', {
        name: ResourcePackageService.geogebraPackageName
      })
      .andWhere(
        '(resourcePackage.workspaceId = :workspaceId OR resourcePackage.scope = :scope)',
        { workspaceId, scope: 'global' }
      )
      .orderBy(
        "CASE WHEN resourcePackage.scope = 'global' THEN 0 ELSE 1 END",
        'ASC'
      )
      .addOrderBy('resourcePackage.createdAt', 'DESC')
      .getMany();

    if (packages.length === 0) {
      return {
        exists: false,
        valid: false,
        errors: ['GeoGebra Math Apps Bundle ist nicht installiert.']
      };
    }

    const evaluatedPackages = packages.map(resourcePackage => {
      const errors = this.validateGeoGebraPackageReference(resourcePackage);
      return { resourcePackage, errors };
    });

    const validPackage = evaluatedPackages.find(pkg => pkg.errors.length === 0);
    const selected = validPackage || evaluatedPackages[0];

    return {
      exists: true,
      valid: selected.errors.length === 0,
      name: selected.resourcePackage.name,
      scope: selected.resourcePackage.scope,
      detectedVersion: selected.resourcePackage.detectedVersion,
      errors:
        selected.errors.length > 0 ? selected.errors : undefined
    };
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

  private prepareResourcePackageUpload(
    zippedResourcePackage: Express.Multer.File
  ): PreparedResourcePackageUpload {
    const zip = this.readZip(zippedResourcePackage.buffer);
    const packageName = this.getPackageNameFromFilename(zippedResourcePackage.originalname);
    this.assertSafePackageName(packageName);
    const safeZipEntries = this.getSafeZipEntries(zip);
    const originalPackageFiles = safeZipEntries.map(entry => entry.entryName);
    const geoGebraPackageLayout = this.detectGeoGebraPackageLayout(originalPackageFiles);
    const contentHash = this.getContentHash(zippedResourcePackage.buffer);
    const isGlobalGeoGebraPackage = this.isGlobalGeoGebraPackage(packageName);
    const normalizedGeoGebraPackageLayout = isGlobalGeoGebraPackage ? geoGebraPackageLayout : null;
    const packageType = geoGebraPackageLayout ? 'geogebra' : 'resource';
    if (isGlobalGeoGebraPackage) {
      this.assertGeoGebraPackage(geoGebraPackageLayout, originalPackageFiles);
    }
    const detectedVersion = packageType === 'geogebra' ?
      this.detectGeoGebraVersion(zip, geoGebraPackageLayout) :
      null;
    const packageFiles = normalizedGeoGebraPackageLayout ?
      normalizedGeoGebraPackageLayout.packageFiles :
      originalPackageFiles;

    return {
      zip,
      packageName,
      packageFiles,
      safeZipEntries,
      geoGebraPackageLayout: normalizedGeoGebraPackageLayout,
      contentHash,
      packageType,
      scope: isGlobalGeoGebraPackage ? 'global' : 'workspace',
      detectedVersion
    };
  }

  private async replaceGlobalGeoGebraPackage(
    zippedResourcePackage: Express.Multer.File
  ): Promise<ResourcePackageDto> {
    this.ensurePackagesDirectoryExists();
    const preparedUpload = this.prepareResourcePackageUpload(zippedResourcePackage);
    if (preparedUpload.scope !== 'global') {
      throw new BadRequestException('Das GeoGebra Math Apps Bundle muss als globales GeoGebra-Paket installiert werden.');
    }

    await this.extractAndStorePackage(
      preparedUpload.packageName,
      preparedUpload.zip,
      zippedResourcePackage,
      preparedUpload.safeZipEntries,
      preparedUpload.geoGebraPackageLayout
    );
    const newResourcePackage = await this.saveResourcePackageReference(
      0,
      preparedUpload.packageName,
      preparedUpload.packageFiles,
      zippedResourcePackage,
      preparedUpload.contentHash,
      preparedUpload.packageType,
      'global',
      preparedUpload.detectedVersion
    );
    await this.deleteGlobalPackageReferencesExcept(
      preparedUpload.packageName,
      newResourcePackage.id
    );
    return newResourcePackage;
  }

  private async extractAndStorePackage(
    packageName: string,
    zip: AdmZip,
    zippedResourcePackage: Express.Multer.File,
    safeZipEntries: SafeZipEntry[],
    geoGebraPackageLayout: GeoGebraPackageLayout | null
  ): Promise<void> {
    const packageDirectoryPath = this.getPackageDirectoryPath(packageName);
    const tempPackageDirectoryPath = `${packageDirectoryPath}.tmp-${process.pid}-${Date.now()}`;
    const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync.bind(zip));
    fs.rmSync(tempPackageDirectoryPath, { recursive: true, force: true });

    try {
      if (geoGebraPackageLayout) {
        this.extractNormalizedGeoGebraPackage(
          tempPackageDirectoryPath,
          safeZipEntries,
          geoGebraPackageLayout
        );
      } else {
        await zipExtractAllToAsync(tempPackageDirectoryPath, true, true);
      }
      fs.writeFileSync(
        path.join(tempPackageDirectoryPath, `${packageName}.itcr.zip`),
        zippedResourcePackage.buffer
      );
      fs.rmSync(packageDirectoryPath, { recursive: true, force: true });
      fs.renameSync(tempPackageDirectoryPath, packageDirectoryPath);
    } catch (error) {
      fs.rmSync(tempPackageDirectoryPath, { recursive: true, force: true });
      throw error;
    }
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

  private readZip(buffer: Buffer): AdmZip {
    try {
      return new AdmZip(buffer);
    } catch {
      throw new BadRequestException('Die hochgeladene Datei ist kein lesbares ZIP-Archiv.');
    }
  }

  private getSafeZipEntries(zip: AdmZip): SafeZipEntry[] {
    let zipEntries: AdmZip.IZipEntry[];
    try {
      zipEntries = zip.getEntries();
    } catch {
      throw new BadRequestException('Die hochgeladene Datei ist kein lesbares ZIP-Archiv.');
    }
    if (zipEntries.length === 0) {
      throw new BadRequestException('Das ZIP-Archiv enthält keine Dateien.');
    }
    return zipEntries
      .map(entry => ({
        entry,
        entryName: entry.entryName.replace(/\\/g, '/')
      }))
      .map(entryName => {
        if (
          path.posix.isAbsolute(entryName.entryName) ||
          entryName.entryName.split('/').includes('..')
        ) {
          throw new BadRequestException('Das ZIP enthält unsichere Dateipfade.');
        }
        return entryName;
      });
  }

  private assertGeoGebraPackage(
    geoGebraPackageLayout: GeoGebraPackageLayout | null,
    packageFiles: string[]
  ): void {
    if (!geoGebraPackageLayout) {
      const foundDeployFile = packageFiles
        .find(packageFile => this.hasLastPathSegment(packageFile, ResourcePackageService.geogebraDeployFileName));
      const foundHtmlFile = packageFiles
        .find(packageFile => packageFile.endsWith(ResourcePackageService.geogebraHtmlRelativePath));
      const foundFilesMessage = [
        foundDeployFile ? `Gefunden: ${foundDeployFile}.` : 'deployggb.js wurde nicht gefunden.',
        foundHtmlFile ? `Gefunden: ${foundHtmlFile}.` : 'GeoGebra.html wurde nicht gefunden.'
      ].join(' ');
      const requiredBundleFilesMessage = [
        `Das GeoGebra-Paket muss ${ResourcePackageService.geogebraDeployFileName} und`,
        `${ResourcePackageService.geogebraHtmlRelativePath} im selben Bundle-Ordner enthalten.`
      ].join(' ');
      throw new BadRequestException(
        `${requiredBundleFilesMessage} ${foundFilesMessage}`
      );
    }
  }

  private detectGeoGebraVersion(
    zip: AdmZip,
    geoGebraPackageLayout: GeoGebraPackageLayout | null
  ): string | null {
    if (!geoGebraPackageLayout) {
      return null;
    }
    const geoGebraHtml = zip.getEntry(geoGebraPackageLayout.geoGebraHtmlEntryName);
    if (!geoGebraHtml) {
      return null;
    }
    const htmlContent = geoGebraHtml.getData().toString('utf8');
    const versionMatch = htmlContent.match(/latestVersion\s*=\s*["']([^"']+)["']/);
    return versionMatch?.[1] || null;
  }

  private detectGeoGebraPackageLayout(packageFiles: string[]): GeoGebraPackageLayout | null {
    const packageFileSet = new Set(packageFiles);
    const deployFileCandidates = packageFiles
      .filter(packageFile => this.hasLastPathSegment(packageFile, ResourcePackageService.geogebraDeployFileName));

    for (const deployFile of deployFileCandidates) {
      const bundleRoot = this.getParentPath(deployFile);
      const geoGebraHtmlEntryName = bundleRoot ?
        `${bundleRoot}/${ResourcePackageService.geogebraHtmlRelativePath}` :
        ResourcePackageService.geogebraHtmlRelativePath;
      if (packageFileSet.has(geoGebraHtmlEntryName)) {
        return {
          bundleRoot,
          packageFiles: this.normalizeGeoGebraPackageFiles(packageFiles, bundleRoot),
          geoGebraHtmlEntryName
        };
      }
    }
    return null;
  }

  private normalizeGeoGebraPackageFiles(packageFiles: string[], bundleRoot: string): string[] {
    const normalizedPackageFiles = packageFiles
      .filter(packageFile => this.isInsideBundleRoot(packageFile, bundleRoot))
      .map(packageFile => this.toGeoGebraPackagePath(packageFile, bundleRoot));
    return Array.from(new Set(normalizedPackageFiles));
  }

  private extractNormalizedGeoGebraPackage(
    packageDirectoryPath: string,
    safeZipEntries: SafeZipEntry[],
    geoGebraPackageLayout: GeoGebraPackageLayout
  ): void {
    safeZipEntries
      .filter(safeZipEntry => !safeZipEntry.entry.isDirectory)
      .filter(safeZipEntry => this.isInsideBundleRoot(
        safeZipEntry.entryName,
        geoGebraPackageLayout.bundleRoot
      ))
      .forEach(safeZipEntry => {
        const normalizedEntryName = this.toGeoGebraPackagePath(
          safeZipEntry.entryName,
          geoGebraPackageLayout.bundleRoot
        );
        const targetPath = path.join(packageDirectoryPath, normalizedEntryName);
        this.assertPathIsInsideDirectory(packageDirectoryPath, targetPath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, safeZipEntry.entry.getData());
      });
  }

  private toGeoGebraPackagePath(packageFile: string, bundleRoot: string): string {
    const relativePackageFile = bundleRoot ?
      packageFile.slice(bundleRoot.length + 1) :
      packageFile;
    return path.posix.join(
      ResourcePackageService.geogebraDirectoryName,
      relativePackageFile
    );
  }

  private isInsideBundleRoot(packageFile: string, bundleRoot: string): boolean {
    return bundleRoot === '' ||
      packageFile === bundleRoot ||
      packageFile.startsWith(`${bundleRoot}/`);
  }

  private getParentPath(packageFile: string): string {
    const lastSeparatorIndex = packageFile.lastIndexOf('/');
    return lastSeparatorIndex === -1 ?
      '' :
      packageFile.slice(0, lastSeparatorIndex);
  }

  private hasLastPathSegment(packageFile: string, segment: string): boolean {
    const pathSegments = packageFile.split('/');
    return pathSegments[pathSegments.length - 1] === segment;
  }

  private assertPathIsInsideDirectory(directoryPath: string, targetPath: string): void {
    const resolvedDirectoryPath = path.resolve(directoryPath);
    const resolvedTargetPath = path.resolve(targetPath);
    if (
      resolvedTargetPath !== resolvedDirectoryPath &&
      !resolvedTargetPath.startsWith(`${resolvedDirectoryPath}${path.sep}`)
    ) {
      throw new BadRequestException('Das ZIP enthält unsichere Dateipfade.');
    }
  }

  private validateGeoGebraPackageReference(
    resourcePackage: ResourcePackageDto
  ): string[] {
    const errors: string[] = [];

    if (resourcePackage.packageType !== 'geogebra') {
      errors.push('Das Ressourcenpaket ist nicht als GeoGebra-Paket registriert.');
    }

    const packageFiles = resourcePackage.elements || [];
    ResourcePackageService.requiredGeoGebraPackageFiles.forEach(requiredFile => {
      if (!packageFiles.includes(requiredFile)) {
        errors.push(`Im Ressourcenpaket fehlt ${requiredFile}.`);
      }
    });

    const packageDirectoryPath = this.getExistingPackageDirectoryPath(
      resourcePackage.name
    );
    ResourcePackageService.requiredGeoGebraPackageFiles.forEach(requiredFile => {
      const absolutePath = path.join(packageDirectoryPath, requiredFile);
      if (!fs.existsSync(absolutePath)) {
        errors.push(`Im entpackten GeoGebra-Paket fehlt ${requiredFile}.`);
      }
    });

    return Array.from(new Set(errors));
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

  private async deleteGlobalPackageReferencesExcept(
    packageName: string,
    retainedId: number
  ): Promise<void> {
    await this.resourcePackageRepository
      .createQueryBuilder()
      .delete()
      .from(ResourcePackage)
      .where('LOWER(name) = LOWER(:packageName)', { packageName })
      .andWhere('scope = :scope', { scope: 'global' })
      .andWhere('id != :retainedId', { retainedId })
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

  private getGeoGebraBundleDownloadUrl(): string {
    const configuredDownloadUrl = this.configService
      .get<string>(ResourcePackageService.geogebraBundleDownloadUrlConfigKey)
      ?.trim();
    return configuredDownloadUrl || ResourcePackageService.defaultGeogebraBundleDownloadUrl;
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
