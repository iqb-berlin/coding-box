import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards
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
import { Request, Response } from 'express';
import * as fs from 'fs';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AdminGuard } from '../admin.guard';
import {
  DatabaseExportJobData,
  DatabaseExportJobResult
} from './database-export.processor';
import { DatabaseExportService } from './database-export.service';

interface RequestWithUser extends Request {
  user: {
    id: number | string;
  };
}

interface DatabaseExportJobStatusResponse {
  status: string;
  progress: number;
  result?: DatabaseExportJobResult;
  error?: string;
}

@Controller('admin/database')
@ApiTags('admin')
export class DatabaseAdminController {
  constructor(
    private readonly databaseExportService: DatabaseExportService,
    @InjectQueue('database-export')
    private readonly databaseExportQueue: Queue<DatabaseExportJobData>
  ) {}

  @Get('export/sqlite')
  @ApiOperation({
    summary: 'Export database to SQLite',
    description: 'Exports the PostgreSQL database to SQLite format with streaming support for large files'
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
  @Header('Content-Type', 'application/x-sqlite3')
  @Header('Content-Disposition', 'attachment; filename=database-export.sqlite')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async exportDatabaseToSqlite(@Res() response: Response): Promise<void> {
    try {
      await this.databaseExportService.exportToSqliteStream(response);
    } catch (error) {
      throw new InternalServerErrorException('Failed to export database to SQLite');
    }
  }

  @Post('export/sqlite/job')
  @ApiOperation({
    summary: 'Start database export job',
    description:
      'Starts a Bull background job that exports the PostgreSQL database to a SQLite file.'
  })
  @ApiOkResponse({
    description: 'Database export job started successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async startDatabaseExportJob(
    @Req() req: RequestWithUser
  ): Promise<{ jobId: string; message: string }> {
    const runningJobs = await this.databaseExportQueue.getJobs([
      'active',
      'waiting',
      'delayed'
    ]);

    const activeJob = runningJobs.find(job => !job.data?.isCancelled);
    if (activeJob) {
      const state = await activeJob.getState();
      throw new ConflictException(
        `Ein Datenbank-Export läuft bereits (Job ${activeJob.id}, Status: ${state}).`
      );
    }

    const job = await this.databaseExportQueue.add({
      requestedByUserId: Number(req.user.id)
    });

    return {
      jobId: String(job.id),
      message: 'Database export job started successfully.'
    };
  }

  @Get('export/sqlite/job/:jobId')
  @ApiOperation({
    summary: 'Get database export job status',
    description: 'Returns status and progress (0-100) for a database export job.'
  })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'Bull job ID of the database export'
  })
  @ApiOkResponse({
    description: 'Database export job status retrieved successfully.'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async getDatabaseExportJobStatus(
    @Param('jobId') jobId: string
  ): Promise<DatabaseExportJobStatusResponse> {
    const job = await this.databaseExportQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Export job with ID ${jobId} not found.`);
    }

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

  @Get('export/sqlite/job/:jobId/download')
  @ApiOperation({
    summary: 'Download completed database export',
    description: 'Downloads the SQLite file of a completed database export job.'
  })
  @ApiParam({
    name: 'jobId',
    type: String,
    description: 'Bull job ID of the database export'
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, AdminGuard)
  async downloadDatabaseExport(
    @Param('jobId') jobId: string,
      @Req() req: RequestWithUser,
      @Res() res: Response
  ): Promise<void> {
    const job = await this.databaseExportQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Export job with ID ${jobId} not found.`);
    }

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
