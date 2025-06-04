import {
  BadRequestException,
  Controller,
  Delete,
  InternalServerErrorException,
  Post,
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

@Controller('admin/logo')
@ApiTags('admin')
export class LogoController {
  LOGO_PATH = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets', 'logo');
  ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp'];
  MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload logo', description: 'Uploads a new logo to replace the default one' })
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets');
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          // Use the extension from the original file
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

        // @ts-expect-error content-length might not be defined in headers type
        if (parseInt(req.headers['content-length'], 10) > this.MAX_FILE_SIZE) {
          return cb(new BadRequestException('File size exceeds the limit (4MB)'), false);
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
      // Always return the consistent path to the uploaded file
      // This ensures the path matches the actual saved filename (logo + extension)
      return { path: `assets/logo${path.extname(file.originalname)}` };
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
      // Find all files starting with 'logo' in the assets directory
      const assetsDir = path.join(process.cwd(), 'apps', 'frontend', 'src', 'assets');
      const files = fs.readdirSync(assetsDir);

      let deleted = false;
      for (const file of files) {
        if (file.startsWith('logo')) {
          fs.unlinkSync(path.join(assetsDir, file));
          deleted = true;
        }
      }

      return { success: deleted };
    } catch (error) {
      throw new InternalServerErrorException('Failed to delete logo');
    }
  }
}
