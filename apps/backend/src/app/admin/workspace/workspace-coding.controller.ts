import {
  Controller,
  Get, Query, Res, UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam, ApiQuery, ApiTags
} from '@nestjs/swagger';
import { Response } from 'express';
import { CodingStatistics } from '../../database/services/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { WorkspaceCodingService } from '../../database/services/workspace-coding.service';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  constructor(
    private workspaceCodingService: WorkspaceCodingService
  ) {}

  @Get(':workspace_id/coding')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async codeTestPersons(@Query('testPersons') testPersons: string, @WorkspaceId() workspace_id: number): Promise<CodingStatistics> {
    return this.workspaceCodingService.codeTestPersons(workspace_id, testPersons);
  }

  @Get(':workspace_id/coding/manual')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async getManualTestPersons(@Query('testPersons') testPersons: string, @WorkspaceId() workspace_id: number): Promise<unknown> {
    return this.workspaceCodingService.getManualTestPersons(workspace_id, testPersons);
  }

  @Get(':workspace_id/coding/coding-list')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiQuery({
    name: 'identity',
    required: false,
    description: 'User identity for token generation',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
  })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page',
    type: Number
  })
  @ApiOkResponse({
    description: 'List of incomplete coding items retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unit_key: { type: 'string' },
              unit_alias: { type: 'string' },
              login_name: { type: 'string' },
              login_code: { type: 'string' },
              booklet_id: { type: 'string' },
              variable_id: { type: 'string' },
              variable_page: { type: 'string' },
              variable_anchor: { type: 'string' },
              url: { type: 'string' }
            }
          }
        },
        total: { type: 'number' },
        page: { type: 'number' },
        limit: { type: 'number' }
      }
    }
  })
  async getCodingList(@WorkspaceId() workspace_id: number, @Query('authToken') authToken: string, @Query('serverUrl') serverUrl: string, @Query('page') page: number = 1, @Query('limit') limit: number = 20): Promise<{
    data: {
      unit_key: string;
      unit_alias: string;
      login_name: string;
      login_code: string;
      booklet_id: string;
      variable_id: string;
      variable_page: string;
      variable_anchor: string;
      url: string;
    }[];
    total: number;
    page: number;
    limit: number;
  }> {
    const [items, total] = await this.workspaceCodingService.getCodingList(workspace_id, authToken, serverUrl, { page, limit });
    return {
      data: items,
      total,
      page,
      limit
    };
  }

  @Get(':workspace_id/coding/coding-list/csv')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding list exported as CSV',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingListAsCsv(@WorkspaceId() workspace_id: number, @Res() res: Response): Promise<void> {
    const csvData = await this.workspaceCodingService.getCodingListAsCsv(workspace_id);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="coding-list-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvData);
  }

  @Get(':workspace_id/coding/coding-list/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding list exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingListAsExcel(@WorkspaceId() workspace_id: number, @Res() res: Response): Promise<void> {
    const excelData = await this.workspaceCodingService.getCodingListAsExcel(workspace_id);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="coding-list-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(excelData);
  }

  @Get(':workspace_id/coding/statistics')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async getCodingStatistics(@WorkspaceId() workspace_id: number): Promise<CodingStatistics> {
    return this.workspaceCodingService.getCodingStatistics(workspace_id);
  }
}
