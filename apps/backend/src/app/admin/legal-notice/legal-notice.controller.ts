import {
  Body, Controller, Delete, Get, Put, UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { LegalNoticeDto, UpdateLegalNoticeDto } from '../../../../../../api-dto/legal-notice/legal-notice.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import { LegalNoticeService } from './legal-notice.service';

@ApiTags('legal-notice')
@Controller('legal-notice')
export class LegalNoticeController {
  constructor(
    private readonly legalNoticeService: LegalNoticeService
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read imprint/privacy text' })
  @ApiOkResponse({ description: 'Imprint/privacy text returned', type: LegalNoticeDto })
  async getLegalNotice(): Promise<LegalNoticeDto> {
    return this.legalNoticeService.getLegalNotice();
  }

  @Put()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update imprint/privacy text' })
  @ApiBody({ type: UpdateLegalNoticeDto })
  @ApiOkResponse({ description: 'Imprint/privacy text updated', type: LegalNoticeDto })
  async updateLegalNotice(
    @Body() body: UpdateLegalNoticeDto
  ): Promise<LegalNoticeDto> {
    return this.legalNoticeService.updateLegalNotice(body);
  }

  @Delete()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reset imprint/privacy text to default' })
  @ApiOkResponse({ description: 'Imprint/privacy text reset', type: LegalNoticeDto })
  async resetLegalNotice(): Promise<LegalNoticeDto> {
    return this.legalNoticeService.resetLegalNotice();
  }
}
