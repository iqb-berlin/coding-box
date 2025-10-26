import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { AppLogoDto } from '../../../../../../api-dto/app-logo-dto';

@Controller('admin/logo')
@ApiTags('admin')
export class LogoController {
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload logo', description: 'Uploads a new logo to replace the default one' })
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets', 'images');
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const ext = path.extname(file.originalname);
          cb(null, `logo${ext}`);
        }
      }),
      limits: {
        fileSize: 4 * 1024 * 1024 // 4MB
      },
      fileFilter: (req, file, cb) => {
        if (!['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'].includes(file.mimetype)) {
          return cb(new BadRequestException('Only image files are allowed'), false);
        }



        return cb(null, true);
      }
    })
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        logo: {
          type: 'string',
          format: 'binary',
          description: 'Logo file to upload (max 4MB, allowed types: JPEG, PNG, GIF, SVG, WebP)'
        }
      }
    }
  })
  @ApiOkResponse({ description: 'Logo uploaded successfully', type: String })
  async uploadLogo(@UploadedFile() file: Express.Multer.File): Promise<{ path: string }> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    try {
      return { path: `assets/images/logo${path.extname(file.originalname)}` };
    } catch (error) {
      throw new InternalServerErrorException('Failed to upload logo');
    }
  }

  @Delete()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete logo', description: 'Deletes the custom logo and reverts to the default one' })
  @ApiOkResponse({ description: 'Logo deleted successfully', type: Boolean })
  async deleteLogo(): Promise<{ success: boolean }> {
    try {
      const assetsDir = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets', 'images');
      const files = fs.readdirSync(assetsDir);

      let deleted = false;
      for (const file of files) {
        if (file.startsWith('logo')) {
          fs.unlinkSync(path.join(assetsDir, file));
          deleted = true;
        }
      }

      const settingsPath = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets', 'data', 'logo-settings.json');
      if (fs.existsSync(settingsPath)) {
        fs.unlinkSync(settingsPath);
      }

      return { success: deleted };
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete logo');
    }
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save logo settings', description: 'Saves logo settings like background color' })
  @ApiBody({ type: AppLogoDto })
  @ApiOkResponse({ description: 'Logo settings saved successfully', type: Boolean })
  async saveLogoSettings(@Body() logoSettings: AppLogoDto): Promise<{ success: boolean }> {
    try {
      const dataDir = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets', 'data');
      const settingsPath = path.join(dataDir, 'logo-settings.json');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(settingsPath, JSON.stringify(logoSettings, null, 2));

      return { success: true };
    } catch (error) {
      throw new InternalServerErrorException('Failed to save logo settings');
    }
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get logo settings', description: 'Gets logo settings like background color' })
  @ApiOkResponse({ description: 'Logo settings retrieved successfully', type: AppLogoDto })
  async getLogoSettings(): Promise<AppLogoDto> {
    try {
      const settingsPath = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets', 'data', 'logo-settings.json');
      if (fs.existsSync(settingsPath)) {
        const settingsJson = fs.readFileSync(settingsPath, 'utf8');
        return JSON.parse(settingsJson);
      }

      return {
        data: 'assets/images/IQB-LogoA.png',
        alt: 'Zur Startseite',
        bodyBackground: 'linear-gradient(180deg, rgba(7,70,94,1) 0%, rgba(6,112,123,1) 24%, rgba(1,192,229,1) 85%)',
        boxBackground: 'lightgray'
      };
    } catch (error) {
      throw new InternalServerErrorException('Failed to get logo settings');
    }
  }
}
