import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  ParseIntPipe
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Job, Queue } from 'bull';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceTestResultsService } from '../../database/services/test-results';
import { DatabaseExportService } from '../database/database-export.service';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import {
  DatabaseExportJobData,
  DatabaseExportJobResult
} from '../database/database-export.processor';
import {
  ExportJobStatus,
  ExportResult,
  RequestWithUser
} from './dto/workspace-test-results.interfaces';

interface DatabaseExportJobStatusResponse {
  status: string;
  progress: number;
  result?: DatabaseExportJobResult;
  error?: string;
}

@ApiTags('Admin Workspace Test Results')
@Controller('admin/workspace')
export class WorkspaceTestResultsExportController {
  constructor(
    private workspaceTestResultsService: WorkspaceTestResultsService,
    private databaseExportService: DatabaseExportService,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService,
    @InjectQueue('database-export')
    private readonly databaseExportQueue: Queue<DatabaseExportJobData>
  ) { }

  @Get(':workspace_id/export/sqlite')
  @ApiOperation({
    summary: 'Export workspace test results to SQLite',
    description:
            'Exports workspace-specific test results data to SQLite format with streaming support'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiResponse({
    status: 200,
    description: 'SQLite database file downloaded successfully',
    content: {
      'application/x-sqlite3': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async exportWorkspaceToSqlite(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Res() response: Response
  ): Promise<void> {
    try {
      response.setHeader('Content-Type', 'application/x-sqlite3');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename=workspace-${workspace_id}-export-${new Date().toISOString().split('T')[0]
        }.sqlite`
      );

      await this.databaseExportService.exportWorkspaceToSqliteStream(
        response,
        workspace_id
      );
    } catch (error) {
      if (!response.headersSent) {
        response
          .status(500)
          .json({ error: 'Failed to export workspace database to SQLite' });
      }
    }
  }

  @Post(':workspace_id/export/sqlite/job')
  @ApiOperation({
    summary: 'Start workspace database export job',
    description:
            'Starts a Bull background job that exports a workspace-specific SQLite database file.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Workspace database export job started successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async startWorkspaceDatabaseExportJob(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Req() req: RequestWithUser
  ): Promise<{ jobId: string; message: string }> {
    const runningJobs = await this.databaseExportQueue.getJobs([
      'active',
      'waiting',
      'delayed'
    ]);

    const activeJob = runningJobs.find(job => {
      if (job.data?.isCancelled) {
        return false;
      }

      if ((job.data?.scope || 'system') === 'system') {
        return true;
      }

      return job.data?.workspaceId === workspace_id;
    });

    if (activeJob) {
      const state = await activeJob.getState();
      throw new ConflictException(
        `Ein Datenbank-Export läuft bereits (Job ${activeJob.id}, Status: ${state}).`
      );
    }

    const job = await this.databaseExportQueue.add({
      requestedByUserId: Number(req.user.id),
      scope: 'workspace',
      workspaceId: workspace_id
    });

    return {
      jobId: String(job.id),
      message: 'Workspace database export job started successfully.'
    };
  }

  @Get(':workspace_id/export/sqlite/job/:jobId')
  @ApiOperation({
    summary: 'Get workspace database export job status',
    description: 'Returns status and progress (0-100) for a workspace database export job.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'Bull job ID of the workspace database export'
  })
  @ApiOkResponse({
    description: 'Workspace database export job status retrieved successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getWorkspaceDatabaseExportJobStatus(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<DatabaseExportJobStatusResponse> {
    const job = await this.getWorkspaceDatabaseExportJob(jobId, workspace_id);
    const state = await job.getState();
    const status = this.mapJobState(state, job);
    const progressValue = await job.progress();
    const progress = this.toNumericProgress(progressValue, status);

    return {
      status,
      progress,
      ...(status === 'completed' && job.returnvalue ?
        { result: job.returnvalue as DatabaseExportJobResult } :
        {}),
      ...((status === 'failed' || status === 'cancelled') && job.failedReason ?
        { error: job.failedReason } :
        {})
    };
  }

  @Get(':workspace_id/export/sqlite/job/:jobId/download')
  @ApiOperation({
    summary: 'Download completed workspace database export',
    description: 'Downloads the SQLite file of a completed workspace database export job.'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'Bull job ID of the workspace database export'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async downloadWorkspaceDatabaseExport(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Param('jobId') jobId: string,
      @Req() req: RequestWithUser,
      @Res() res: Response
  ): Promise<void> {
    const job = await this.getWorkspaceDatabaseExportJob(jobId, workspace_id);

    const state = await job.getState();
    if (state !== 'completed') {
      throw new BadRequestException(
        'Der Export ist noch nicht abgeschlossen und kann noch nicht heruntergeladen werden.'
      );
    }

    const result = job.returnvalue as DatabaseExportJobResult | undefined;
    if (!result?.filePath) {
      throw new NotFoundException('Export result metadata is missing.');
    }

    if (result.requestedByUserId !== Number(req.user.id)) {
      throw new ForbiddenException(
        'Dieser Export wurde von einem anderen Benutzer angefordert.'
      );
    }

    if (result.workspaceId !== workspace_id) {
      throw new BadRequestException('Invalid workspace ID.');
    }

    if (!fs.existsSync(result.filePath)) {
      throw new NotFoundException('Die Exportdatei wurde nicht gefunden.');
    }

    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="${result.fileName}"`);
    res.setHeader('Content-Length', String(result.fileSize));

    const stream = fs.createReadStream(result.filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Fehler beim Lesen der Exportdatei.' });
      }
    });

    stream.pipe(res);
  }

  @Get(':workspace_id/results/export')
  @ApiOperation({
    summary: 'Export test results',
    description: 'Exports test results for a workspace as CSV'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiResponse({
    status: 200,
    description: 'CSV file downloaded successfully',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async exportTestResults(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Res() response: Response
  ): Promise<void> {
    try {
      response.setHeader('Content-Type', 'text/csv');
      response.setHeader(
        'Content-Disposition',
        `attachment; filename=workspace-${workspace_id}-results-${new Date().toISOString().split('T')[0]
        }.csv`
      );

      await this.workspaceTestResultsService.exportTestResults(
        workspace_id,
        response
      );
    } catch (error) {
      if (!response.headersSent) {
        response.status(500).json({ error: 'Failed to export test results' });
      }
    }
  }

  @Post(':workspace_id/results/export/job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Start background export of test results',
    description:
            'Starts a background job to export test results for a workspace as CSV'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Export job started successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async startExportTestResultsJob(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Req() req: RequestWithUser,
      @Body()
                                         filters?: {
                                           groupNames?: string[];
                                           bookletNames?: string[];
                                           unitNames?: string[];
                                           personIds?: number[];
                                           includeLogAnomalies?: boolean;
                                         }
  ): Promise<{ jobId: string; message: string }> {
    const job = await this.jobQueueService.addExportJob({
      workspaceId: Number(workspace_id),
      userId: Number(req.user.id),
      exportType: 'test-results',
      authToken: req.headers.authorization?.replace('Bearer ', ''),
      testResultFilters: filters
    });

    return {
      jobId: job.id.toString(),
      message: 'Export job started successfully'
    };
  }

  @Post(':workspace_id/results/export/logs/job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiOperation({
    summary: 'Start background export of test logs',
    description:
            'Starts a background job to export test logs for a workspace as CSV (re-importable)'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'Export job started successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async startExportTestLogsJob(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Req() req: RequestWithUser,
      @Body()
                                         filters?: {
                                           groupNames?: string[];
                                           bookletNames?: string[];
                                           unitNames?: string[];
                                           personIds?: number[];
                                         }
  ): Promise<{ jobId: string; message: string }> {
    const job = await this.jobQueueService.addExportJob({
      workspaceId: Number(workspace_id),
      userId: Number(req.user.id),
      exportType: 'test-logs',
      authToken: req.headers.authorization?.replace('Bearer ', ''),
      testResultFilters: filters
    });

    return {
      jobId: job.id.toString(),
      message: 'Export job started successfully'
    };
  }

  @Get(':workspace_id/results/export/jobs')
  @ApiOperation({
    summary: 'Get export jobs',
    description: 'Retrieves a list of export jobs for a workspace'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiOkResponse({
    description: 'List of export jobs retrieved successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async getExportJobs(
    @Param('workspace_id', ParseIntPipe) workspace_id: number
  ): Promise<ExportJobStatus[]> {
    const jobs = await this.jobQueueService.getExportJobs(Number(workspace_id));

    const result: ExportJobStatus[] = [];
    for (const job of jobs) {
      const state = await job.getState();
      const progress = await job.progress();
      result.push({
        jobId: job.id.toString(),
        status: state,
        progress: progress,
        exportType: job.data.exportType,
        createdAt: new Date(job.timestamp),
        error: job.failedReason
      });
    }

    return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  @Get(':workspace_id/results/export/jobs/:jobId/download')
  @ApiOperation({
    summary: 'Download export job result',
    description: 'Downloads the result file of a completed export job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the job' })
  @ApiOkResponse({
    description: 'File downloaded successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  async downloadExportJobResult(
    @Param('workspace_id', ParseIntPipe) workspace_id: number,
      @Param('jobId') jobId: string,
      @Res() res: Response
  ): Promise<void> {
    const result = await this.cacheService.get<ExportResult>(
      `export-result:${jobId}`
    );

    if (!result) {
      throw new BadRequestException('Export result not found or expired.');
    }

    if (Number(result.workspaceId) !== Number(workspace_id)) {
      throw new BadRequestException('Invalid workspace ID.');
    }

    res.download(result.filePath, result.fileName);
  }

  @Delete(':workspace_id/results/export/jobs/:jobId')
  @ApiOperation({
    summary: 'Delete export job',
    description: 'Deletes an export job'
  })
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiParam({ name: 'jobId', type: String, description: 'ID of the job' })
  @ApiOkResponse({
    description: 'Job deleted successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  async deleteExportJob(
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    const success = await this.jobQueueService.deleteExportJob(jobId);
    if (!success) {
      throw new BadRequestException('Failed to delete job');
    }
    return { success: true, message: 'Job deleted successfully' };
  }

  private async getWorkspaceDatabaseExportJob(
    jobId: string,
    workspaceId: number
  ): Promise<Job<DatabaseExportJobData>> {
    const job = await this.databaseExportQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Export job with ID ${jobId} not found.`);
    }

    if (job.data?.scope !== 'workspace' || job.data?.workspaceId !== workspaceId) {
      throw new NotFoundException(`Export job with ID ${jobId} not found.`);
    }

    return job;
  }

  private mapJobState(
    state: string,
    job: Job<DatabaseExportJobData>
  ): 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' {
    if (
      (state === 'waiting' || state === 'delayed' || state === 'active') &&
      job.data?.isCancelled
    ) {
      return 'cancelled';
    }

    if (state === 'failed' && job.failedReason?.toLowerCase().includes('cancel')) {
      return 'cancelled';
    }

    switch (state) {
      case 'waiting':
      case 'delayed':
        return 'queued';
      case 'active':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      default:
        return 'failed';
    }
  }

  private toNumericProgress(progress: unknown, status: string): number {
    if (typeof progress === 'number') {
      return Math.max(0, Math.min(100, Math.round(progress)));
    }

    if (status === 'completed') {
      return 100;
    }

    return 0;
  }
}
