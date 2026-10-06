import { BadRequestException, Injectable } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { diskStorage } from 'multer';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AppLogoDto } from '../../../../../../api-dto/app-logo-dto';

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

@Injectable()
export class LogoService {
  private readonly assetsDir = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets');
  private readonly imagesDir = path.join(this.assetsDir, 'images');
  private readonly dataDir = path.join(this.assetsDir, 'data');
  private readonly settingsPath = path.join(this.dataDir, 'logo-settings.json');

  getUploadOptions(): MulterOptions {
    return {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          fs.mkdir(this.imagesDir, { recursive: true }).then(
            () => cb(null, this.imagesDir),
            error => cb(error, this.imagesDir)
          );
        },
        filename: (_req, file, cb) => cb(null, `logo${path.extname(file.originalname)}`)
      }),
      limits: { fileSize: 4 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'].includes(file.mimetype)) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }
        return cb(null, true);
      }
    };
  }

  uploadedLogo(file: Express.Multer.File): { path: string } {
    if (!file) throw new BadRequestException('No file uploaded');
    return { path: `assets/images/logo${path.extname(file.originalname)}` };
  }

  async deleteLogo(): Promise<{ success: boolean }> {
    const files = await fs.readdir(this.imagesDir).catch(error => {
      if (isMissingFile(error)) return [];
      throw error;
    });
    const logos = files.filter(file => file.startsWith('logo'));
    for (const file of logos) {
      await this.removeFile(path.join(this.imagesDir, file));
    }
    await this.removeFile(this.settingsPath);
    return { success: logos.length > 0 };
  }

  async saveLogoSettings(settings: AppLogoDto): Promise<{ success: boolean }> {
    await fs.mkdir(this.dataDir, { recursive: true });
    // Readers must see complete JSON even during concurrent async writes.
    const temporaryPath = `${this.settingsPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2));
      await fs.rename(temporaryPath, this.settingsPath);
    } finally {
      await this.removeFile(temporaryPath);
    }
    return { success: true };
  }

  async getLogoSettings(): Promise<AppLogoDto> {
    try {
      return JSON.parse(await fs.readFile(this.settingsPath, 'utf8'));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      return {
        data: 'assets/images/IQB-LogoA.png',
        alt: 'Zur Startseite',
        bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
        boxBackground: 'lightgray'
      };
    }
  }

  private async removeFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
  }
}
