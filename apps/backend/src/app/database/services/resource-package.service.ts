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

  async findResourcePackages(): Promise<ResourcePackageDto[]> {
    this.logger.log('Returning resource packages.');
    return this.resourcePackageRepository
      .find({
        order: { createdAt: 'DESC' }
      });
  }

  async removeResourcePackages(ids: number[]): Promise<void> {
    await Promise.all(ids.map(async id => this.removeResourcePackage(id)));
  }

  async removeResourcePackage(id: number): Promise<void> {
    this.logger.log(`Deleting resource package with id ${id}.`);
    const resourcePackage = await this.resourcePackageRepository
      .findOne({
        where: { id: id }
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

  async create(zippedResourcePackage: Express.Multer.File): Promise<number> {
    this.logger.log('Creating resource package.');
    const zip = new AdmZip(zippedResourcePackage.buffer);
    const packageNameArray = zippedResourcePackage.originalname.split('.itcr.zip');
    if (packageNameArray.length === 2) {
      const packageName = packageNameArray[0];
      const resourcePackage = await this.resourcePackageRepository
        .findOne({
          where: { name: packageName }
        });
      if (!resourcePackage) {
        const packageFiles = zip.getEntries()
          .map(entry => entry.entryName);
        const zipExtractAllToAsync = util.promisify(zip.extractAllToAsync);
        return zipExtractAllToAsync(`${this.resourcePackagesPath}/${packageName}`, true, true)
          .then(async () => {
            const newResourcePackage = this.resourcePackageRepository.create({
              name: packageName,
              elements: packageFiles,
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

  getZippedResourcePackage(name: string): Buffer {
    this.logger.log('Returning zipped resource package.');
    return fs.readFileSync(`${this.resourcePackagesPath}/${name}/${name}.itcr.zip`);
  }
}
