import {
  Controller, Get, Post, Put, UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ValidatedBody } from '../../http/validated-body.decorator';
import type { RequestBody } from '../../../../../../api-dto/request-contracts';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { ContentPoolIntegrationService, ContentPoolConnectionTestResult, ContentPoolSettings } from './content-pool-integration.service';

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
    @ValidatedBody('UpdateContentPoolSettingsInput') body: RequestBody<'UpdateContentPoolSettingsInput'>
  ): Promise<ContentPoolSettings> {
    return this.contentPoolIntegrationService.updateSettings(body);
  }

  @Post('test')
  @ApiOperation({ summary: 'Test Content-Pool integration settings' })
  async testConnection(
    @ValidatedBody('TestContentPoolConnectionInput', true) body: RequestBody<'TestContentPoolConnectionInput'> | undefined
  ): Promise<ContentPoolConnectionTestResult> {
    return this.contentPoolIntegrationService.testConnection(body);
  }
}
