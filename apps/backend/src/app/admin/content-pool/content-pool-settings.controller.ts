import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import {
  ContentPoolIntegrationService,
  ContentPoolSettings
} from './content-pool-integration.service';

@ApiTags('admin')
@Controller('admin/content-pool/settings')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class ContentPoolSettingsController {
  constructor(
    private readonly contentPoolIntegrationService: ContentPoolIntegrationService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read Content-Pool integration settings' })
  async getSettings(): Promise<ContentPoolSettings> {
    return this.contentPoolIntegrationService.getSettings();
  }

  @Put()
  @ApiOperation({ summary: 'Update Content-Pool integration settings' })
  async updateSettings(
    @Body() body: ContentPoolSettings
  ): Promise<ContentPoolSettings> {
    return this.contentPoolIntegrationService.updateSettings(body);
  }
}
