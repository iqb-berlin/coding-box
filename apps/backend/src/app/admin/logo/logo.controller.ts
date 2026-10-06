import {
  Body,
  Controller,
  Delete,
  Get,
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
import { LogoService } from './logo.service';
import { LogoUploadInterceptor } from './logo-upload.interceptor';
import { requestBodySchemas } from '../../http/request-body.schemas';
import { JsonSchemaValidationPipe } from '../../http/json-schema-validation.pipe';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { AppLogoDto } from '../../../../../../api-dto/app-logo-dto';

@Controller('admin/logo')
@ApiTags('admin')
export class LogoController {
  constructor(private readonly logoService: LogoService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Upload logo', description: 'Uploads a new logo to replace the default one' })
  @UseInterceptors(LogoUploadInterceptor)
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
    return this.logoService.uploadedLogo(file);
  }

  @Delete()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete logo', description: 'Deletes the custom logo and reverts to the default one' })
  @ApiOkResponse({ description: 'Logo deleted successfully', type: Boolean })
  async deleteLogo(): Promise<{ success: boolean }> {
    return this.logoService.deleteLogo();
  }

  @Put('settings')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Save logo settings', description: 'Saves logo settings like background color' })
  @ApiBody({ type: AppLogoDto })
  @ApiOkResponse({ description: 'Logo settings saved successfully', type: Boolean })
  async saveLogoSettings(@Body(new JsonSchemaValidationPipe(requestBodySchemas.AppLogoDto)) logoSettings: AppLogoDto): Promise<{ success: boolean }> {
    return this.logoService.saveLogoSettings(logoSettings);
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get logo settings', description: 'Gets logo settings like background color' })
  @ApiOkResponse({ description: 'Logo settings retrieved successfully', type: AppLogoDto })
  async getLogoSettings(): Promise<AppLogoDto> {
    return this.logoService.getLogoSettings();
  }
}
