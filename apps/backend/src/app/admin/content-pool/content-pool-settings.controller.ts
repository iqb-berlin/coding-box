import {
  Body, Controller, Get, Post, Put, UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JsonSchemaValidationPipe } from '../../http/json-schema-validation.pipe';
import { requestBodySchemas } from '../../http/request-body.schemas';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import {
  ContentPoolIntegrationService,
  ContentPoolConnectionTestResult,
  ContentPoolSettings,
  TestContentPoolConnectionInput,
  UpdateContentPoolSettingsInput
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
    @Body(new JsonSchemaValidationPipe(requestBodySchemas.UpdateContentPoolSettingsInput)) body: UpdateContentPoolSettingsInput
  ): Promise<ContentPoolSettings> {
    return this.contentPoolIntegrationService.updateSettings(body);
  }

  @Post('test')
  @ApiOperation({ summary: 'Test Content-Pool integration settings' })
  async testConnection(
    @Body(new JsonSchemaValidationPipe(requestBodySchemas.TestContentPoolConnectionInput, true)) body: TestContentPoolConnectionInput
  ): Promise<ContentPoolConnectionTestResult> {
    return this.contentPoolIntegrationService.testConnection(body);
  }
}
