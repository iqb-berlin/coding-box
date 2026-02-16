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
  Logger
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Response, Request } from 'express';
import {
  JobQueueService,
  ExportJobData,
  ExportJobResult
} from '../../job-queue/job-queue.service';
import { CacheService } from '../../cache/cache.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingListExportService, CodingResultsExportService, CodingTimesExportService } from '../../database/services/coding';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingExportController {
  private readonly logger = new Logger(WorkspaceCodingExportController.name);

  constructor(
    private codingListExportService: CodingListExportService,
    private codingResultsExportService: CodingResultsExportService,
    private codingTimesExportService: CodingTimesExportService,
    private jobQueueService: JobQueueService,
    private cacheService: CacheService
  ) { }

  @Get(':workspace_id/coding/coding-list')
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
  async getCodingListAsCsv(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl: string,
      @Res() res: Response
  ): Promise<void> {
    return this.codingListExportService.exportCodingListAsCsv(
      workspace_id,
      authToken,
      serverUrl,
      res
    );
  }

  @Get(':workspace_id/coding/coding-list/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
      @Res() res: Response
  ): Promise<void> {
    return this.codingListExportService.exportCodingListAsExcel(
      workspace_id,
      authToken,
      serverUrl,
      res
    );
  }

  @Get(':workspace_id/coding/coding-list/json')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
      @Res() res: Response
  ): Promise<void> {
    return this.codingListExportService.exportCodingListAsJson(
      workspace_id,
      authToken,
      serverUrl,
      res
    );
  }

  @Get(':workspace_id/coding/results-by-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
                   @Res() res: Response
  ): Promise<void> {
    const csvStream = await this.codingResultsExportService.exportCodingResultsByVersionAsCsv(
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-results-${version}-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`
    );

    // Excel compatibility: UTF-8 BOM
    res.write('\uFEFF');
    csvStream.pipe(res);
  }

  @Get(':workspace_id/coding/results-by-version/excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
  @ApiOkResponse({
    description: 'Coding results for specified version exported as Excel',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
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
                   @Res() res: Response
  ): Promise<void> {
    const buffer = await this.codingResultsExportService.exportCodingResultsByVersionAsExcel(
      workspace_id,
      version,
      authToken,
      serverUrl,
      includeReplayUrls
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="coding-results-${version}-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx"`
    );

    res.send(buffer);
  }

  @Get(':workspace_id/coding/export/aggregated')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
    description: 'Include modal value and deviation count columns'
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
          | 'new-row-per-variable'
          | 'new-column-per-coder'
          | 'most-frequent') || 'most-frequent';
      const includeCommentsParam = includeComments === 'true';
      const includeModalValueParam = includeModalValue === 'true';
      const excludeAutoCodedParam = excludeAutoCoded === 'true'; // Default false

      const buffer =
        await this.codingResultsExportService.exportCodingResultsAggregated(
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
      const buffer = await this.codingResultsExportService.exportCodingResultsByCoder(
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'includeModalValue',
    required: false,
    type: Boolean,
    description: 'Include modal value and deviation count columns'
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
        await this.codingResultsExportService.exportCodingResultsByVariable(
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
      const buffer = await this.codingResultsExportService.exportCodingResultsDetailed(
        workspace_id,
        outputCommentsParam,
        includeReplayUrlParam,
        anonymizeCodersParam,
        usePseudoCodersParam,
        authToken || '',
        req,
        excludeAutoCodedParam
      );

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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
    const buffer = await this.codingTimesExportService.exportCodingTimesReport(
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

  @Post(':workspace_id/coding/export')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Start a background export job',
    schema: {
      type: 'object',
      required: ['exportType', 'userId'],
      properties: {
        exportType: {
          type: 'string',
          enum: [
            'aggregated',
            'by-coder',
            'by-variable',
            'detailed',
            'coding-times',
            'results-by-version'
          ],
          description: 'Type of export to generate'
        },
        userId: {
          type: 'number',
          description: 'ID of the user requesting the export'
        },
        outputCommentsInsteadOfCodes: { type: 'boolean' },
        includeReplayUrl: { type: 'boolean' },
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
  async startExportJob(
    @WorkspaceId() workspace_id: number,
      @Req() req: Request,
      @Body() body: Omit<ExportJobData, 'workspaceId' | 'userId'>
  ): Promise<{ jobId: string; message: string }> {
    try {
      const job = await this.jobQueueService.addExportJob({
        ...body,
        workspaceId: workspace_id,
        userId: (req.user as { id: number }).id
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

  @Get(':workspace_id/coding/export/job/:jobId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
        result: {
          type: 'object',
          description:
            'Export metadata (only available when status is completed)'
        },
        error: {
          type: 'string',
          description: 'Error message (only available when status is failed)'
        }
      }
    }
  })
  async getExportJobStatus(@Param('jobId') jobId: string): Promise<
  | {
    status: string;
    progress: number;
    result?: {
      fileId: string;
      fileName: string;
      filePath: string;
      fileSize: number;
      workspaceId: number;
      userId: number;
      exportType: string;
      createdAt: number;
    };
    error?: string;
  }
  | { error: string }
  > {
    try {
      const job = await this.jobQueueService.getExportJob(jobId);
      if (!job) {
        return { error: `Export job with ID ${jobId} not found` };
      }

      const state = await job.getState();
      const progress = await job.progress();
      const failedReason = job.failedReason;

      let status: string;
      switch (state) {
        case 'completed':
          status = 'completed';
          break;
        case 'failed':
          status = 'failed';
          break;
        case 'active':
          status = 'processing';
          break;
        case 'waiting':
        case 'delayed':
          status = 'pending';
          break;
        case 'paused':
          status = 'paused';
          break;
        default:
          status = state;
      }

      return {
        status,
        progress: typeof progress === 'number' ? progress : 0,
        ...(status === 'completed' && job.returnvalue ?
          { result: job.returnvalue } :
          {}),
        ...(status === 'failed' && failedReason ? { error: failedReason } : {})
      };
    } catch (error) {
      this.logger.error(
        `Error getting export job status: ${error.message}`,
        error.stack
      );
      return { error: error.message };
    }
  }

  @Get(':workspace_id/coding/export/job/:jobId/download')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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

      const isCsv =
        metadata.fileName.toLowerCase().endsWith('.csv') ||
        metadata.exportType === 'detailed';
      res.setHeader(
        'Content-Type',
        isCsv ?
          'text/csv; charset=utf-8' :
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${metadata.fileName}"`
      );
      res.setHeader('Content-Length', metadata.fileSize);

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
    } catch (error) {
      this.logger.error(
        `Error downloading export: ${error.message}`,
        error.stack
      );
      res.status(500).json({ error: error.message });
    }
  }

  @Get(':workspace_id/coding/export/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
    exportType: string;
    createdAt: number;
  }>
  > {
    try {
      const jobs = await this.jobQueueService.getExportJobs(workspace_id);

      return await Promise.all(
        jobs.map(async job => {
          const state = await job.getState();
          const progress = await job.progress();

          return {
            jobId: job.id.toString(),
            status: state,
            progress: typeof progress === 'number' ? progress : 0,
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
    @Param('jobId') jobId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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

      const state = await job.getState();

      // Check if job is already completed or failed
      if (state === 'completed') {
        return {
          success: false,
          message: 'Job already completed'
        };
      }

      if (state === 'failed') {
        return {
          success: false,
          message: 'Job already failed'
        };
      }

      // Mark the job as cancelled (for active jobs to check)
      await this.jobQueueService.markExportJobCancelled(jobId);

      // Try to remove the job from queue
      const removed = await this.jobQueueService.cancelExportJob(jobId);

      // Clean up any cached metadata and temp files
      const metadata = await this.cacheService.get<ExportJobResult>(
        `export-result:${jobId}`
      );
      if (metadata && metadata.filePath) {
        const fs = await import('fs');
        if (fs.existsSync(metadata.filePath)) {
          fs.unlinkSync(metadata.filePath);
          this.logger.log(`Cleaned up export file: ${metadata.filePath}`);
        }
      }
      await this.cacheService.delete(`export-result:${jobId}`);

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
