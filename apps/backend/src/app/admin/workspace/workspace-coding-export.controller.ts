import {
  Controller,
  Get,
  Query,
  Res,
  Req,
  UseGuards,
  Body,
  Post,
  Param,
  Delete,
  Logger,
  BadRequestException,
  Optional
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Response, Request } from 'express';
import { Readable } from 'stream';
import {
  JobQueueService,
  ExportJobData,
  ExportJobProgress,
  ExportJobResult
} from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import {
  CodingExportService,
  CodingExportOrchestratorService,
  CodingListExportService,
  CodingPsychometricExportService
} from '../../database/services/coding';
import { PsychometricDomainCandidatesDto } from '../../../../../../api-dto/coding/psychometric-discrimination.dto';

type PublicExportJobResult = Omit<ExportJobResult, 'filePath'>;
type PublicExportJobStatus =
  | {
    status: string;
    progress: number;
    progressPhase?: string;
    processedRows?: number;
    totalRows?: number;
    progressMessage?: string;
    result?: PublicExportJobResult;
    error?: string;
    errorCode?: string;
    errorDetails?: Record<string, number | string | boolean>;
  }
  | { error: string };
type RequestUser = { id?: number | string; userId?: number | string };
type ByVariableExportEstimateResponse = {
  exportType: 'by-variable' | 'by-variable-compact';
  unitVariableCount: number;
  worksheetLimit: number | null;
  exceedsWorksheetLimit: boolean;
};

@ApiTags('Admin Workspace Coding')
@RequireAccessLevel(2)
@Controller('admin/workspace')
export class WorkspaceCodingExportController {
  private readonly logger = new Logger(WorkspaceCodingExportController.name);

  constructor(
    private codingListExportService: CodingListExportService,
    private codingExportService: CodingExportService,
    private codingExportOrchestratorService: CodingExportOrchestratorService,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService,
    @Optional()
    private codingPsychometricExportService?: CodingPsychometricExportService
  ) {}

  private mapExportJobState(
    state: string,
    job: { data?: { isCancelled?: boolean }; failedReason?: string }
  ): string {
    const failedReason = job.failedReason;
    const failedBecauseCancelled =
      typeof failedReason === 'string' &&
      (failedReason.includes('ExportJobCancelledException') ||
        /^Export job .* was cancelled$/.test(failedReason));

    if (
      job.data?.isCancelled === true &&
      (state === 'waiting' ||
        state === 'delayed' ||
        state === 'active' ||
        state === 'completed' ||
        state === 'failed')
    ) {
      return 'cancelled';
    }

    if (state === 'failed' && failedBecauseCancelled) {
      return 'cancelled';
    }

    switch (state) {
      case 'completed':
        return 'completed';
      case 'active':
        return 'processing';
      case 'waiting':
      case 'delayed':
        return 'pending';
      case 'paused':
        return 'paused';
      default:
        return state;
    }
  }

  private validateBackgroundExportRequest(
    body: Omit<ExportJobData, 'workspaceId' | 'userId'>
  ): void {
    if (
      body.exportType === 'results-by-version' &&
      body.format !== undefined &&
      body.format !== 'csv' &&
      body.format !== 'excel'
    ) {
      throw new BadRequestException(
        'results-by-version exports support only "csv" or "excel" format'
      );
    }

    if (
      body.exportType === 'results-by-version' &&
      body.includeGeoGebraFiles &&
      body.format !== 'excel'
    ) {
      throw new BadRequestException(
        'GeoGebra file packages are supported only for Excel result exports'
      );
    }

    if (
      body.exportType === 'results-by-version' &&
      body.includeGeoGebraFiles &&
      body.includeResponseValues === false
    ) {
      throw new BadRequestException(
        'GeoGebra file packages require response values because links are written to the value column'
      );
    }

    if (
      body.exportType === 'item-matrix' &&
      body.format !== undefined &&
      body.format !== 'csv' &&
      body.format !== 'excel'
    ) {
      throw new BadRequestException(
        'item-matrix exports support only "csv" or "excel" format'
      );
    }

    if (
      body.exportType === 'item-matrix' &&
      body.matrixValue !== undefined &&
      body.matrixValue !== 'code' &&
      body.matrixValue !== 'score'
    ) {
      throw new BadRequestException(
        'item-matrix exports support only "code" or "score" matrix values'
      );
    }

    if (
      body.exportType === 'item-matrix' &&
      body.version !== undefined &&
      body.version !== 'v1' &&
      body.version !== 'v2' &&
      body.version !== 'v3'
    ) {
      throw new BadRequestException(
        'item-matrix exports support only "v1", "v2" or "v3" versions'
      );
    }

    if (
      body.exportType === 'psychometrics' &&
      body.format !== undefined &&
      body.format !== 'csv' &&
      body.format !== 'excel'
    ) {
      throw new BadRequestException(
        'psychometrics exports support only "csv" or "excel" format'
      );
    }

    if (
      body.exportType === 'psychometrics' &&
      body.version !== undefined &&
      body.version !== 'v1' &&
      body.version !== 'v2' &&
      body.version !== 'v3'
    ) {
      throw new BadRequestException(
        'psychometrics exports support only "v1", "v2" or "v3" versions'
      );
    }

    if (
      body.exportType === 'psychometrics' &&
      body.partWholeCorrection !== undefined &&
      typeof body.partWholeCorrection !== 'boolean'
    ) {
      throw new BadRequestException(
        'psychometrics partWholeCorrection must be a boolean'
      );
    }

    if (
      body.exportType === 'psychometrics' &&
      body.maxCategoryCount !== undefined &&
      (!Number.isSafeInteger(body.maxCategoryCount) ||
        body.maxCategoryCount < 1 ||
        body.maxCategoryCount > 100)
    ) {
      throw new BadRequestException(
        'psychometrics maxCategoryCount must be an integer between 1 and 100'
      );
    }

    if (
      body.exportType === 'psychometrics' &&
      body.missingsProfileId !== undefined &&
      (!Number.isSafeInteger(body.missingsProfileId) ||
        body.missingsProfileId <= 0)
    ) {
      throw new BadRequestException(
        'psychometrics missingsProfileId must be a positive integer'
      );
    }

    if (
      body.exportType === 'psychometrics' &&
      body.domain !== undefined &&
      (!body.domain ||
        (body.domain.mode !== 'workspace' &&
          (body.domain.mode !== 'vomd-field' ||
            !['UNIT', 'ITEM'].includes(body.domain.scope) ||
            !body.domain.profileId ||
            !body.domain.entryId)))
    ) {
      throw new BadRequestException(
        'psychometrics domain must select the workspace or a valid VOMD field'
      );
    }
  }

  private getRequestUserId(req: Request): number {
    const user = (req as Request & { user?: RequestUser }).user;
    const userId = Number(user?.id ?? user?.userId);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw new BadRequestException('Authenticated user id is invalid');
    }

    return userId;
  }

  private getPublicExportErrorDetails(error?: string): {
    errorCode?: string;
    errorDetails?: Record<string, number | string | boolean>;
  } {
    const worksheetLimitMatch = error?.match(
      /enthaelt\s+(\d+)\s+Unit-Variable-Kombinationen[\s\S]*Limit von\s+(\d+)\s+Tabellenblaettern/i
    );
    if (!worksheetLimitMatch) {
      return {};
    }

    return {
      errorCode: 'EXPORT_TOO_MANY_WORKSHEETS',
      errorDetails: {
        actual: Number(worksheetLimitMatch[1]),
        max: Number(worksheetLimitMatch[2])
      }
    };
  }

  private toPublicExportProgress(progress: unknown): {
    progress: number;
    progressPhase?: string;
    processedRows?: number;
    totalRows?: number;
    progressMessage?: string;
  } {
    if (typeof progress === 'number') {
      return {
        progress: Math.max(0, Math.min(100, Math.round(progress)))
      };
    }

    if (!progress || typeof progress !== 'object') {
      return { progress: 0 };
    }

    const progressObject = progress as Partial<ExportJobProgress>;
    const percentage = Number(progressObject.percentage);
    const processedRows = Number(progressObject.processedRows);
    const totalRows = Number(progressObject.totalRows);

    return {
      progress: Number.isFinite(percentage) ?
        Math.max(0, Math.min(100, Math.round(percentage))) :
        0,
      ...(progressObject.phase ? { progressPhase: progressObject.phase } : {}),
      ...(Number.isFinite(processedRows) ? { processedRows } : {}),
      ...(Number.isFinite(totalRows) ? { totalRows } : {}),
      ...(progressObject.message ?
        { progressMessage: progressObject.message } :
        {})
    };
  }

  private pipeExportStream(
    stream: Readable,
    res: Response,
    context: string
  ): Promise<void> {
    return new Promise(resolve => {
      let settled = false;

      const settle = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      stream.once('error', (error: Error) => {
        this.logger.error(`${context}: ${error.message}`, error.stack);

        if (!res.destroyed && !res.writableEnded) {
          if (!res.headersSent) {
            res.removeHeader('Content-Length');
            res.removeHeader('Content-Disposition');
            res.status(500).json({ error: 'Export failed' });
          } else {
            res.end();
          }
        }

        settle();
      });

      res.once('finish', settle);
      res.once('close', () => {
        if (!settled && !res.writableEnded) {
          stream.destroy();
        }
        settle();
      });
      stream.pipe(res);
    });
  }

  @Get(':workspace_id/coding/coding-list')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingRequired',
    required: false,
    description: 'Filter variables by coder training requirement',
    type: Boolean
  })
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
  async getCodingListAsCsv(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('trainingRequired') trainingRequired: string,
      @Res() res: Response
  ): Promise<void> {
    let trainingRequiredParam: boolean | undefined;
    if (trainingRequired === 'true') {
      trainingRequiredParam = true;
    } else if (trainingRequired === 'false') {
      trainingRequiredParam = false;
    }
    return this.codingListExportService.exportCodingListAsCsv(
      workspace_id,
      authToken,
      serverUrl,
      res,
      trainingRequiredParam
    );
  }

  @Get(':workspace_id/coding/coding-list/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for generating replay URLs',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
  })
  @ApiQuery({
    name: 'trainingRequired',
    required: false,
    description: 'Filter variables by coder training requirement',
    type: Boolean
  })
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
  async getCodingListAsExcel(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('trainingRequired') trainingRequired: string,
      @Res() res: Response
  ): Promise<void> {
    let trainingRequiredParam: boolean | undefined;
    if (trainingRequired === 'true') {
      trainingRequiredParam = true;
    } else if (trainingRequired === 'false') {
      trainingRequiredParam = false;
    }
    return this.codingListExportService.exportCodingListAsExcel(
      workspace_id,
      authToken,
      serverUrl,
      res,
      trainingRequiredParam
    );
  }

  @Get(':workspace_id/coding/coding-list/json')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for generating replay URLs',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
  })
  @ApiQuery({
    name: 'trainingRequired',
    required: false,
    description: 'Filter variables by coder training requirement',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'Coding list exported as JSON',
    content: {
      'application/json': {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unit_key: { type: 'string' },
              unit_alias: { type: 'string' },
              person_login: { type: 'string' },
              person_code: { type: 'string' },
              person_group: { type: 'string' },
              booklet_name: { type: 'string' },
              variable_id: { type: 'string' },
              variable_page: { type: 'string' },
              variable_anchor: { type: 'string' },
              url: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async getCodingListAsJson(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('trainingRequired') trainingRequired: string,
      @Res() res: Response
  ): Promise<void> {
    let trainingRequiredParam: boolean | undefined;
    if (trainingRequired === 'true') {
      trainingRequiredParam = true;
    } else if (trainingRequired === 'false') {
      trainingRequiredParam = false;
    }
    return this.codingListExportService.exportCodingListAsJson(
      workspace_id,
      authToken,
      serverUrl,
      res,
      trainingRequiredParam
    );
  }

  @Get(':workspace_id/coding/results-by-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: true,
    description: 'Coding version to export: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3']
  })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for generating replay URLs',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
  })
  @ApiQuery({
    name: 'includeReplayUrls',
    required: false,
    description: 'Include replay URLs in the export',
    type: Boolean
  })
  @ApiQuery({
    name: 'includeResponseValues',
    required: false,
    description: 'Include response values in the export',
    type: Boolean
  })
  @ApiQuery({
    name: 'includeGeoGebraResponseValues',
    required: false,
    description:
      'Include GeoGebra response values as raw strings instead of placeholders',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'Coding results for specified version exported as CSV',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingResultsByVersion(
    @WorkspaceId() workspace_id: number,
      @Query('version') version: 'v1' | 'v2' | 'v3',
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('includeReplayUrls', { transform: value => value === 'true' })
                   includeReplayUrls: boolean,
      @Query('includeResponseValues', { transform: value => value !== 'false' })
                   includeResponseValues: boolean,
      @Query('includeGeoGebraResponseValues', {
        transform: value => value === 'true'
      })
                   includeGeoGebraResponseValues: boolean,
                   @Res() res: Response
  ): Promise<void> {
    try {
      const csvStream =
        await this.codingExportOrchestratorService.exportResultsByVersionAsCsv({
          workspaceId: workspace_id,
          version,
          authToken: authToken || '',
          serverUrl,
          includeReplayUrl: includeReplayUrls,
          includeResponseValues,
          includeGeoGebraResponseValues
        });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="coding-results-${version}-${new Date()
          .toISOString()
          .slice(0, 10)}.csv"`
      );

      // Excel compatibility: UTF-8 BOM
      res.write('\uFEFF');
      await this.pipeExportStream(
        csvStream,
        res,
        `Error streaming coding results export for workspace ${workspace_id}, version ${version}`
      );
    } catch (error) {
      this.logger.error(
        `Error preparing coding results export for workspace ${workspace_id}, version ${version}: ${error.message}`,
        error.stack
      );

      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  @Get(':workspace_id/coding/results-by-version/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'version',
    required: true,
    description: 'Coding version to export: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3']
  })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for generating replay URLs',
    type: String
  })
  @ApiQuery({
    name: 'serverUrl',
    required: false,
    description: 'Server URL to use for generating links',
    type: String
  })
  @ApiQuery({
    name: 'includeReplayUrls',
    required: false,
    description: 'Include replay URLs in the export',
    type: Boolean
  })
  @ApiQuery({
    name: 'includeResponseValues',
    required: false,
    description: 'Include response values in the export',
    type: Boolean
  })
  @ApiQuery({
    name: 'includeGeoGebraResponseValues',
    required: false,
    description:
      'Include GeoGebra response values as raw strings instead of placeholders',
    type: Boolean
  })
  @ApiQuery({
    name: 'includeGeoGebraFiles',
    required: false,
    description:
      'Return a ZIP package with GeoGebra responses as .ggb files and Excel hyperlinks',
    type: Boolean
  })
  @ApiOkResponse({
    description:
      'Coding results for specified version exported as Excel or as ZIP when GeoGebra files are included',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      },
      'application/zip': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async getCodingResultsByVersionAsExcel(
    @WorkspaceId() workspace_id: number,
      @Query('version') version: 'v1' | 'v2' | 'v3',
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Query('includeReplayUrls', { transform: value => value === 'true' })
                   includeReplayUrls: boolean,
      @Query('includeResponseValues', { transform: value => value !== 'false' })
                   includeResponseValues: boolean,
      @Query('includeGeoGebraResponseValues', {
        transform: value => value === 'true'
      })
                   includeGeoGebraResponseValues: boolean,
      @Query('includeGeoGebraFiles', { transform: value => value === 'true' })
                   includeGeoGebraFiles: boolean,
                   @Res() res: Response
  ): Promise<void> {
    if (includeGeoGebraFiles && !includeResponseValues) {
      throw new BadRequestException(
        'GeoGebra file packages require response values because links are written to the value column'
      );
    }

    const buffer =
      await this.codingExportOrchestratorService.exportResultsByVersionAsExcel({
        workspaceId: workspace_id,
        version,
        authToken: authToken || '',
        serverUrl,
        includeReplayUrl: includeReplayUrls,
        includeResponseValues,
        includeGeoGebraResponseValues,
        includeGeoGebraFiles
      });

    res.setHeader(
      'Content-Type',
      includeGeoGebraFiles ?
        'application/zip' :
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-results-${version}-${new Date()
        .toISOString()
        .slice(0, 10)}.${includeGeoGebraFiles ? 'zip' : 'xlsx'}"`
    );

    res.send(buffer);
  }

  @Get(':workspace_id/coding/export/aggregated')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code columns instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'doubleCodingMethod',
    required: false,
    enum: ['new-row-per-variable', 'new-column-per-coder', 'most-frequent'],
    description: 'Method for handling double coding'
  })
  @ApiQuery({
    name: 'includeComments',
    required: false,
    type: Boolean,
    description: 'Include comments column with all coders comments'
  })
  @ApiQuery({
    name: 'includeModalValue',
    required: false,
    type: Boolean,
    description:
      'Include modal value, deviation count, modal tie and modal candidate columns'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Aggregated coding results exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsAggregated(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('doubleCodingMethod') doubleCodingMethod?: string,
                   @Query('includeComments') includeComments?: string,
                   @Query('includeModalValue') includeModalValue?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const doubleCodingMethodParam =
        (doubleCodingMethod as
          'new-row-per-variable' | 'new-column-per-coder' | 'most-frequent') ||
        'most-frequent';
      const includeCommentsParam = includeComments === 'true';
      const includeModalValueParam = includeModalValue === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true'; // Default false

      const buffer =
        await this.codingExportService.exportCodingResultsAggregated(
          workspace_id,
          outputCommentsParam,
          includeReplayUrlParam,
          anonymizeCodersParam,
          usePseudoCodersParam,
          doubleCodingMethodParam,
          includeCommentsParam,
          includeModalValueParam,
          authToken || '',
          req,
          excludeAutoCodedParam
        );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-aggregated-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/by-coder')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code columns instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Coding results by coder exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsByCoder(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer = await this.codingExportService.exportCodingResultsByCoder(
        workspace_id,
        outputCommentsParam,
        includeReplayUrlParam,
        anonymizeCodersParam,
        usePseudoCodersParam,
        authToken || '',
        req,
        excludeAutoCodedParam
      );

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-by-coder-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/by-variable')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'includeModalValue',
    required: false,
    type: Boolean,
    description:
      'Include modal value, deviation count, modal tie and modal candidate columns'
  })
  @ApiQuery({
    name: 'includeDoubleCoded',
    required: false,
    type: Boolean,
    description: 'Include double coding indicator column (0 or 1)'
  })
  @ApiQuery({
    name: 'includeComments',
    required: false,
    type: Boolean,
    description: 'Include comments column with all coders comments'
  })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code columns instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Coding results by variable exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsByVariable(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('includeModalValue') includeModalValue?: string,
      @Query('includeDoubleCoded') includeDoubleCoded?: string,
      @Query('includeComments') includeComments?: string,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const includeModal = includeModalValue === 'true';
      const includeDouble = includeDoubleCoded === 'true';
      const includeCommentsParam = includeComments === 'true';
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer =
        await this.codingExportService.exportCodingResultsByVariable(
          workspace_id,
          includeModal,
          includeDouble,
          includeCommentsParam,
          outputCommentsParam,
          includeReplayUrlParam,
          anonymizeCodersParam,
          usePseudoCodersParam,
          authToken || '',
          req,
          excludeAutoCodedParam
        );
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-by-variable-${new Date()
          .toISOString()
          .slice(0, 10)}.xlsx`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/detailed')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'outputCommentsInsteadOfCodes',
    required: false,
    type: Boolean,
    description: 'Output comments in code column instead of code values'
  })
  @ApiQuery({
    name: 'includeReplayUrl',
    required: false,
    type: Boolean,
    description: 'Include replay URL column with hyperlinks to play back tasks'
  })
  @ApiQuery({
    name: 'authToken',
    required: false,
    type: String,
    description: 'Authentication token for generating replay URLs'
  })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Detailed coding results exported as CSV',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingResultsDetailed(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Req() req: Request,
      @Query('outputCommentsInsteadOfCodes')
                   outputCommentsInsteadOfCodes?: string,
                   @Query('includeReplayUrl') includeReplayUrl?: string,
                   @Query('authToken') authToken?: string,
                   @Query('anonymizeCoders') anonymizeCoders?: string,
                   @Query('usePseudoCoders') usePseudoCoders?: string,
                   @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    try {
      const outputCommentsParam = outputCommentsInsteadOfCodes === 'true';
      const includeReplayUrlParam = includeReplayUrl === 'true';
      const anonymizeCodersParam = anonymizeCoders === 'true';
      const usePseudoCodersParam = usePseudoCoders === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true';
      const buffer = await this.codingExportOrchestratorService.exportDetailed({
        workspaceId: workspace_id,
        outputCommentsInsteadOfCodes: outputCommentsParam,
        includeReplayUrl: includeReplayUrlParam,
        anonymizeCoders: anonymizeCodersParam,
        usePseudoCoders: usePseudoCodersParam,
        authToken: authToken || '',
        req,
        excludeAutoCoded: excludeAutoCodedParam
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=coding-results-detailed-${new Date()
          .toISOString()
          .slice(0, 10)}.csv`
      );
      res.send(buffer);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/coding-times')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'anonymizeCoders',
    required: false,
    type: Boolean,
    description:
      'Anonymize coder names (rename to K1, K2, etc. in random order)'
  })
  @ApiQuery({
    name: 'usePseudoCoders',
    required: false,
    type: Boolean,
    description: 'Use pseudo coder names for double-coding (always K1 and K2)'
  })
  @ApiQuery({
    name: 'excludeAutoCoded',
    required: false,
    type: Boolean,
    description:
      'Exclude automatically coded variables, limiting export to manually coded (CODING_INCOMPLETE) variables only. Default: false'
  })
  @ApiOkResponse({
    description: 'Coding times report exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportCodingTimesReport(
    @WorkspaceId() workspace_id: number,
      @Res() res: Response,
      @Query('anonymizeCoders') anonymizeCoders?: string,
      @Query('usePseudoCoders') usePseudoCoders?: string,
      @Query('excludeAutoCoded') excludeAutoCoded?: string
  ): Promise<void> {
    const anonymizeCodersParam = anonymizeCoders === 'true';
    const usePseudoCodersParam = usePseudoCoders === 'true';
    const excludeAutoCodedParam = excludeAutoCoded === 'true';
    const buffer = await this.codingExportService.exportCodingTimesReport(
      workspace_id,
      anonymizeCodersParam,
      usePseudoCodersParam,
      excludeAutoCodedParam
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=coding-times-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`
    );
    res.send(buffer);
  }

  @Post(':workspace_id/coding/export/estimate')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  async estimateExportJob(
    @WorkspaceId() workspace_id: number,
      @Body() body: Omit<ExportJobData, 'workspaceId' | 'userId'>
  ): Promise<ByVariableExportEstimateResponse> {
    if (
      body.exportType !== 'by-variable' &&
      body.exportType !== 'by-variable-compact'
    ) {
      throw new BadRequestException(
        'Export estimates are only supported for by-variable exports'
      );
    }

    const exportType = body.exportType;
    return this.codingExportService.estimateCodingResultsByVariableExport(
      workspace_id,
      exportType,
      body.excludeAutoCoded || false,
      body.jobDefinitionIds,
      body.coderTrainingIds,
      body.coderIds
    );
  }

  @Post(':workspace_id/coding/export/start')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Start a background export job',
    schema: {
      type: 'object',
      required: ['exportType'],
      properties: {
        exportType: {
          type: 'string',
          enum: [
            'aggregated',
            'by-coder',
            'by-variable',
            'by-variable-compact',
            'detailed',
            'coding-times',
            'coding-list',
            'results-by-version',
            'item-matrix',
            'psychometrics'
          ],
          description: 'Type of export to generate'
        },
        version: {
          type: 'string',
          enum: ['v1', 'v2', 'v3'],
          description: 'Coding result version for results-by-version exports'
        },
        format: {
          type: 'string',
          enum: ['csv', 'excel', 'json'],
          description:
            'File format for exports that support multiple formats. results-by-version supports csv and excel; coding-list supports csv, excel and json.'
        },
        matrixValue: {
          type: 'string',
          enum: ['code', 'score'],
          description: 'Cell value for item-matrix exports'
        },
        partWholeCorrection: {
          type: 'boolean',
          description:
            'Subtract the current item score from its domain score. Defaults to true.'
        },
        missingsProfileId: {
          type: 'number',
          description:
            'Missing profile used for codes and numeric missing scores'
        },
        domain: {
          type: 'object',
          description:
            'Psychometric domain selection: the whole workspace or one complete, single-valued VOMD field'
        },
        maxCategoryCount: {
          type: 'number',
          description:
            'Maximum number of raw categories per item. Defaults to 10.'
        },
        outputCommentsInsteadOfCodes: { type: 'boolean' },
        includeReplayUrl: { type: 'boolean' },
        includeResponseValues: { type: 'boolean' },
        includeGeoGebraResponseValues: { type: 'boolean' },
        includeGeoGebraFiles: { type: 'boolean' },
        anonymizeCoders: { type: 'boolean' },
        usePseudoCoders: { type: 'boolean' },
        doubleCodingMethod: {
          type: 'string',
          enum: [
            'new-row-per-variable',
            'new-column-per-coder',
            'most-frequent'
          ]
        },
        includeComments: { type: 'boolean' },
        includeModalValue: { type: 'boolean' },
        includeDoubleCoded: { type: 'boolean' },
        excludeAutoCoded: { type: 'boolean' },
        trainingRequired: { type: 'boolean' },
        authToken: { type: 'string' }
      }
    }
  })
  @ApiOkResponse({
    description: 'Export job created successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'ID of the created export job' },
        message: { type: 'string' }
      }
    }
  })
  @ApiBadRequestResponse({
    description: 'Invalid export format for the selected export type'
  })
  async startExportJob(
    @WorkspaceId() workspace_id: number,
      @Req() req: Request,
      @Body() body: Omit<ExportJobData, 'workspaceId' | 'userId'>
  ): Promise<{ jobId: string; message: string }> {
    this.validateBackgroundExportRequest(body);

    try {
      const userId = this.getRequestUserId(req);
      const job = await this.jobQueueService.addExportJob({
        ...body,
        workspaceId: workspace_id,
        userId
      });

      this.logger.log(
        `Export job ${job.id} created for workspace ${workspace_id}, type: ${body.exportType}`
      );

      return {
        jobId: job.id.toString(),
        message: `Export job created successfully. Job ID: ${job.id}`
      };
    } catch (error) {
      this.logger.error(
        `Error creating export job: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  @Get(':workspace_id/coding/export/psychometric-domain-candidates')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'Complete and incomplete VOMD fields that can be considered for psychometric domain grouping'
  })
  async getPsychometricDomainCandidates(
    @WorkspaceId() workspace_id: number
  ): Promise<PsychometricDomainCandidatesDto> {
    if (!this.codingPsychometricExportService) {
      throw new BadRequestException(
        'Psychometric export service is unavailable'
      );
    }
    return this.codingPsychometricExportService.getDomainCandidates(
      workspace_id
    );
  }

  @Get(':workspace_id/coding/export/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: 'string',
    description: 'ID of the export job'
  })
  @ApiOkResponse({
    description: 'Export job status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
          description: 'Current status of the export job'
        },
        progress: {
          type: 'number',
          description: 'Progress percentage (0-100)'
        },
        progressPhase: {
          type: 'string',
          enum: ['preparing', 'counting', 'writing', 'finalizing', 'completed'],
          description: 'Current export progress phase'
        },
        processedRows: {
          type: 'number',
          description: 'Number of rows already written, when available'
        },
        totalRows: {
          type: 'number',
          description: 'Estimated total number of rows, when available'
        },
        progressMessage: {
          type: 'string',
          description: 'Optional human-readable progress message'
        },
        result: {
          type: 'object',
          description:
            'Export metadata without internal storage paths (only available when status is completed)'
        },
        error: {
          type: 'string',
          description: 'Error message (only available when status is failed)'
        }
      }
    }
  })
  async getExportJobStatus(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<PublicExportJobStatus> {
    try {
      const job = await this.jobQueueService.getExportJob(jobId);
      if (!job) {
        return { error: `Export job with ID ${jobId} not found` };
      }
      if (job.data.workspaceId !== workspace_id) {
        return { error: 'Access denied to this export' };
      }

      const state = await job.getState();
      const progress = this.toPublicExportProgress(await job.progress());
      const failedReason = job.failedReason;
      const status = this.mapExportJobState(state, job);

      return {
        status,
        ...progress,
        ...(status === 'completed' && job.returnvalue ?
          {
            result: this.toPublicExportJobResult(
              job.returnvalue as ExportJobResult
            )
          } :
          {}),
        ...(status === 'failed' && failedReason ?
          {
            error: failedReason,
            ...this.getPublicExportErrorDetails(failedReason)
          } :
          {})
      };
    } catch (error) {
      this.logger.error(
        `Error getting export job status: ${error.message}`,
        error.stack
      );
      return { error: error.message };
    }
  }

  private toPublicExportJobResult(
    result: ExportJobResult
  ): PublicExportJobResult {
    return {
      fileId: result.fileId,
      fileName: result.fileName,
      fileSize: result.fileSize,
      workspaceId: result.workspaceId,
      userId: result.userId,
      exportType: result.exportType,
      createdAt: result.createdAt
    };
  }

  @Get(':workspace_id/coding/export/job/:jobId/download')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: 'string',
    description: 'ID of the export job'
  })
  @ApiOkResponse({
    description: 'Export file downloaded successfully',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async downloadExport(
    @Param('jobId') jobId: string,
      @WorkspaceId() workspace_id: number,
      @Res() res: Response
  ): Promise<void> {
    try {
      const metadata = await this.cacheService.get<ExportJobResult>(
        `export-result:${jobId}`
      );

      if (!metadata) {
        res.status(404).json({ error: 'Export file not found or expired' });
        return;
      }

      if (metadata.workspaceId !== workspace_id) {
        res.status(403).json({ error: 'Access denied to this export' });
        return;
      }

      const filePath = metadata.filePath;
      const fs = await import('fs');

      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'Export file not found on disk' });
        return;
      }

      const normalizedFileName = metadata.fileName.toLowerCase();
      const isCsv =
        normalizedFileName.endsWith('.csv') ||
        metadata.exportType === 'detailed';
      const isJson = normalizedFileName.endsWith('.json');
      const isZip = normalizedFileName.endsWith('.zip');
      let contentType =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      if (isCsv) {
        contentType = 'text/csv; charset=utf-8';
      } else if (isJson) {
        contentType = 'application/json; charset=utf-8';
      } else if (isZip) {
        contentType = 'application/zip';
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${metadata.fileName}"`
      );
      res.setHeader('Content-Length', metadata.fileSize);

      const fileStream = fs.createReadStream(filePath);
      await this.pipeExportStream(
        fileStream,
        res,
        `Error streaming downloaded export ${jobId} for workspace ${workspace_id}`
      );
    } catch (error) {
      this.logger.error(
        `Error downloading export: ${error.message}`,
        error.stack
      );
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of export jobs for the workspace',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
          status: { type: 'string' },
          progress: { type: 'number' },
          progressPhase: {
            type: 'string',
            enum: [
              'preparing',
              'counting',
              'writing',
              'finalizing',
              'completed'
            ]
          },
          processedRows: { type: 'number' },
          totalRows: { type: 'number' },
          progressMessage: { type: 'string' },
          exportType: { type: 'string' },
          createdAt: { type: 'number' }
        }
      }
    }
  })
  async getExportJobs(@WorkspaceId() workspace_id: number): Promise<
  Array<{
    jobId: string;
    status: string;
    progress: number;
    progressPhase?: string;
    processedRows?: number;
    totalRows?: number;
    progressMessage?: string;
    exportType: string;
    createdAt: number;
  }>
  > {
    try {
      const jobs = await this.jobQueueService.getExportJobs(workspace_id);

      return await Promise.all(
        jobs.map(async job => {
          const state = await job.getState();
          const progress = this.toPublicExportProgress(await job.progress());

          return {
            jobId: job.id.toString(),
            status: this.mapExportJobState(state, job),
            ...progress,
            exportType: job.data.exportType,
            createdAt: job.timestamp
          };
        })
      );
    } catch (error) {
      this.logger.error(
        `Error getting export jobs: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  @Delete(':workspace_id/coding/export/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: 'string',
    description: 'ID of the export job to delete'
  })
  @ApiOkResponse({
    description: 'Export job deleted successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteExportJob(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      const job = await this.jobQueueService.getExportJob(jobId);
      if (!job) {
        return {
          success: false,
          message: 'Export job not found'
        };
      }
      if (job.data.workspaceId !== workspace_id) {
        return {
          success: false,
          message: 'Access denied to this export'
        };
      }

      const success = await this.jobQueueService.deleteExportJob(jobId);

      if (success) {
        const metadata = await this.cacheService.get<ExportJobResult>(
          `export-result:${jobId}`
        );
        if (metadata && metadata.filePath) {
          const fs = await import('fs');
          if (fs.existsSync(metadata.filePath)) {
            fs.unlinkSync(metadata.filePath);
          }
        }
        await this.cacheService.delete(`export-result:${jobId}`);

        return {
          success: true,
          message: 'Export job deleted successfully'
        };
      }

      return {
        success: false,
        message: 'Export job not found'
      };
    } catch (error) {
      this.logger.error(
        `Error deleting export job: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        message: error.message
      };
    }
  }

  @Post(':workspace_id/coding/export/job/:jobId/cancel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'jobId',
    type: 'string',
    description: 'ID of the export job to cancel'
  })
  @ApiOkResponse({
    description: 'Export job cancelled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async cancelExportJob(
    @WorkspaceId() workspace_id: number,
      @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // First, check the job state
      const job = await this.jobQueueService.getExportJob(jobId);
      if (!job) {
        return {
          success: false,
          message: 'Export job not found'
        };
      }
      if (job.data.workspaceId !== workspace_id) {
        return {
          success: false,
          message: 'Access denied to this export'
        };
      }

      const state = await job.getState();

      // Check if job is already completed or failed
      if (state === 'completed') {
        return {
          success: false,
          message: 'Job already completed'
        };
      }

      if (state === 'failed' && !job.data.isCancelled) {
        return {
          success: false,
          message: 'Job already failed'
        };
      }

      // Mark the job as cancelled (for active jobs to check)
      const marked = await this.jobQueueService.markExportJobCancelled(jobId);

      // Try to remove the job from queue
      const removed = await this.jobQueueService.cancelExportJob(jobId);

      const stateAfterCancellationRequest = await job.getState();
      if (stateAfterCancellationRequest === 'completed') {
        if (marked || job.data.isCancelled) {
          return {
            success: true,
            message:
              'Export job cancellation requested (job will stop at next checkpoint)'
          };
        }
        return {
          success: false,
          message: 'Job already completed'
        };
      }
      if (stateAfterCancellationRequest === 'failed' && !job.data.isCancelled) {
        return {
          success: false,
          message: 'Job already failed'
        };
      }

      if (!marked && !removed) {
        return {
          success: false,
          message: 'Export job cancellation could not be requested'
        };
      }

      if (removed) {
        this.logger.log(`Export job ${jobId} cancelled and removed from queue`);
        return {
          success: true,
          message: 'Export job cancelled successfully'
        };
      }
      // Job was marked as cancelled but couldn't be removed (may be actively processing)
      this.logger.log(
        `Export job ${jobId} marked as cancelled (job is actively processing)`
      );
      return {
        success: true,
        message:
          'Export job cancellation requested (job will stop at next checkpoint)'
      };
    } catch (error) {
      this.logger.error(
        `Error cancelling export job: ${error.message}`,
        error.stack
      );
      return {
        success: false,
        message: error.message
      };
    }
  }
}
