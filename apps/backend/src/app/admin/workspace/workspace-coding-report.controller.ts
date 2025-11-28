import {
  Controller, Get, Query, Param, UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiOperation, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CodingReportService, CodingReportResponseDto } from '../../database/services/coding-report.service';

@ApiTags('Admin Workspace Coding Report')
@Controller('admin/workspace')
export class WorkspaceCodingReportController {
  constructor(private readonly codingReportService: CodingReportService) {}

  @Get(':workspace_id/coding-report')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get coding report', description: 'Returns a paginated coding report for all units in a workspace.' })
  @ApiQuery({
    name: 'page', required: false, type: Number, description: 'Page number for pagination'
  })
  @ApiQuery({
    name: 'pageSize', required: false, type: Number, description: 'Number of items per page'
  })
  async getCodingReport(
    @Param('workspace_id') workspaceId: number,
                           @Query('page') page = 1,
                           @Query('pageSize') pageSize = 50
  ): Promise<CodingReportResponseDto> {
    return this.codingReportService.getCodingReport(workspaceId, page, pageSize);
  }
}
