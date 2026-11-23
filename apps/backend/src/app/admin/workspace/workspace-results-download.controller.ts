import {
  Controller, Get, NotFoundException, Param, Req, Res, UseGuards
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ExportArtifactService } from '../../database/services/coding';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { WorkspaceDownloadTicket, workspaceDownloadPath } from './workspace-download-ticket';

@Controller('admin/workspace/:workspace_id/coding/export/job/:jobId/download')
export class WorkspaceResultsDownloadController {
  private readonly ticket = new WorkspaceDownloadTicket();

  constructor(private readonly exportArtifactService: ExportArtifactService) {}

  @Get('prepare')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  async prepare(
    @WorkspaceId() workspaceId: number,
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    await this.getResultsCsv(workspaceId, jobId);
    const path = workspaceDownloadPath(request).replace(/\/prepare$/, '/file');
    this.ticket.issue(path, response);
    response.json({});
  }

  @Get('file')
  async download(
    @WorkspaceId() workspaceId: number,
    @Param('jobId') jobId: string,
    @Req() request: Request,
    @Res() response: Response
  ): Promise<void> {
    if (!this.ticket.matches(workspaceDownloadPath(request), request.get('cookie'))) {
      throw new NotFoundException('Export download unavailable');
    }
    const metadata = await this.getResultsCsv(workspaceId, jobId);
    const date = new Date().toISOString().slice(0, 10);
    response.download(metadata.filePath, `export-results-by-version-${date}.csv`, {
      headers: { 'Cache-Control': 'no-store, no-transform' }
    });
  }

  private async getResultsCsv(workspaceId: number, jobId: string) {
    const metadata = await this.exportArtifactService.getArtifact(jobId);
    if (metadata?.workspaceId !== workspaceId || metadata.exportType !== 'results-by-version' ||
      !metadata.fileName.toLowerCase().endsWith('.csv')) {
      throw new NotFoundException('Export download unavailable');
    }
    return metadata;
  }
}
