import {
  Injectable, Logger
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import 'multer';
import * as AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as util from 'util';
import ResourcePackage from '../entities/resource-package.entity';
import { ResourcePackageDto } from '../../../../../../api-dto/resource-package/resource-package-dto';
import { ResourcePackageNotFoundException } from '../../exceptions/resource-package-not-found.exception';

@Injectable()
export class ResourcePackageService {
  private readonly logger = new Logger(ResourcePackageService.name);
  private resourcePackagesPath = './packages';

  constructor(
    @InjectRepository(ResourcePackage)
    private resourcePackageRepository: Repository<ResourcePackage>
  ) {
  }

  async findResourcePackages(workspaceId: number): Promise<ResourcePackageDto[]> {
    this.logger.log(`Returning resource packages for workspace ${workspaceId}.`);
    return this.resourcePackageRepository
      .find({
        where: { workspaceId },
        order: { createdAt: 'DESC' }
      });
  }

  async removeResourcePackages(workspaceId: number, ids: number[]): Promise<void> {
    await Promise.all(ids.map(async id => this.removeResourcePackage(workspaceId, id)));
  }

  async removeResourcePackage(workspaceId: number, id: number): Promise<void> {
    this.logger.log(`Deleting resource package with id ${id} from workspace ${workspaceId}.`);
    const resourcePackage = await this.resourcePackageRepository
      .findOne({
        where: { id: id, workspaceId: workspaceId }
      });
    if (resourcePackage) {
      const elementPath = `${this.resourcePackagesPath}/${resourcePackage.name}`;
      if (fs.existsSync(elementPath)) {
        fs.rmSync(elementPath, { recursive: true, force: true });
      }
      await this.resourcePackageRepository.delete(resourcePackage);
    } else {
      throw new ResourcePackageNotFoundException(id, 'DELETE');
    }
  }

  async create(workspaceId: number, zippedResourcePackage: Express.Multer.File): Promise<number> {
    this.logger.log(`Creating resource package for workspace ${workspaceId}.`);
    const zip = new AdmZip(zippedResourcePackage.buffer);
    const packageNameArray = zippedResourcePackage.originalname.split('.itcr.zip');
    if (packageNameArray.length === 2) {
      const packageName = packageNameArray[0];
      const resourcePackage = await this.resourcePackageRepository
        .findOne({
          where: { name: packageName, workspaceId }
        });
      if (!resourcePackage) {
        const packageFiles = zip.getEntries()
          .map(entry => entry.entryName);
        const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync);
        return zipExtractAllToAsync(`${this.resourcePackagesPath}/${packageName}`, true, true)
          .then(async () => {
            const packageSize = zippedResourcePackage.buffer.length;
            const newResourcePackage = this.resourcePackageRepository.create({
              workspaceId,
              name: packageName,
              elements: packageFiles,
              packageSize,
              createdAt: new Date()
            });
            await this.resourcePackageRepository.save(newResourcePackage);
            fs.writeFileSync(
              `${this.resourcePackagesPath}/${packageName}/${zippedResourcePackage.originalname}`,
              zippedResourcePackage.buffer
            );
            return newResourcePackage.id;
          })
          .catch(error => {
            throw new Error(error.message);
          });
      }
      throw new Error('Package is already installed');
    }
    throw new Error('No Resource Package');
  }

  async getZippedResourcePackage(workspaceId: number, name: string): Promise<Buffer> {
    this.logger.log(`Returning zipped resource package ${name} for workspace ${workspaceId}.`);

    // Check if the resource package exists for the given workspace
    const resourcePackage = await this.resourcePackageRepository.findOne({
      where: { name, workspaceId }
    });

    if (!resourcePackage) {
      throw new ResourcePackageNotFoundException(0, 'GET', `Resource package ${name} not found in workspace ${workspaceId}`);
    }

    return fs.readFileSync(`${this.resourcePackagesPath}/${name}/${name}.itcs.zip`);
  }
}
