import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiTags
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingValidationService, CodingAnalysisService, MissingsProfilesService } from '../../database/services/coding';
import { VariableAnalysisReplayService } from '../../database/services/test-results';
import { ExportValidationResultsService } from '../../database/services/validation';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ValidateCodingCompletenessRequestDto } from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ExportValidationResultsRequestDto } from '../../../../../../api-dto/coding/export-validation-results-request.dto';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingAnalysisController {
  constructor(
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private codingValidationService: CodingValidationService,
    private codingAnalysisService: CodingAnalysisService,
    private missingsProfilesService: MissingsProfilesService
  ) { }

  @Get(':workspace_id/coding/variable-analysis')
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
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 100, max: 500)',
    type: Number
  })
  @ApiQuery({
    name: 'unitId',
    required: false,
    description: 'Filter by unit ID',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiQuery({
    name: 'derivation',
    required: false,
    description: 'Filter by derivation type',
    type: String
  })
  async getVariableAnalysis(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl?: string,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 100,
                   @Query('unitId') unitId?: string,
                   @Query('variableId') variableId?: string,
                   @Query('derivation') derivation?: string
  ): Promise<{
        data: VariableAnalysisItemDto[];
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500

    return this.variableAnalysisReplayService.getVariableAnalysis(
      workspace_id,
      authToken,
      serverUrl,
      validPage,
      validLimit,
      unitId,
      variableId,
      derivation
    );
  }

  @Post(':workspace_id/coding/validate-completeness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Expected combinations to validate with optional pagination',
    type: ValidateCodingCompletenessRequestDto
  })
  @ApiOkResponse({
    description: 'Validation results with pagination support',
    type: ValidateCodingCompletenessResponseDto
  })
  async validateCodingCompleteness(
    @WorkspaceId() workspace_id: number,
      @Body() request: ValidateCodingCompletenessRequestDto
  ): Promise<ValidateCodingCompletenessResponseDto> {
    // Extract and validate pagination parameters
    const page = Math.max(1, request.page || 1);
    const pageSize = Math.min(Math.max(1, request.pageSize || 50), 500); // Max 500 items per page

    return this.codingValidationService.validateCodingCompleteness(
      workspace_id,
      request.expectedCombinations,
      page,
      pageSize
    );
  }

  @Post(':workspace_id/coding/validate-completeness/export-excel')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Cache key to export validation results from Redis cache',
    type: ExportValidationResultsRequestDto
  })
  @ApiOkResponse({
    description: 'Validation results exported as Excel from cached data',
    content: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async validateAndExportCodingCompleteness(
    @WorkspaceId() workspace_id: number,
      @Body() request: ExportValidationResultsRequestDto,
      @Res() res: Response
  ): Promise<void> {
    const excelData =
      await this.exportValidationResultsService.exportValidationResultsAsExcel(
        workspace_id,
        request.cacheKey
      );

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `validation-results-${timestamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelData);
  }

  @Get(':workspace_id/coding/incomplete-variables')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiOkResponse({
    description: 'CODING_INCOMPLETE variables retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Unit name' },
          variableId: { type: 'string', description: 'Variable ID' },
          responseCount: {
            type: 'number',
            description: 'Number of responses for this variable'
          },
          casesInJobs: {
            type: 'number',
            description:
              'Number of unique cases already assigned to coding jobs'
          },
          availableCases: {
            type: 'number',
            description: 'Number of cases available for new job assignments'
          }
        }
      }
    }
  })
  async getCodingIncompleteVariables(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string
  ): Promise<
      {
        unitName: string;
        variableId: string;
        responseCount: number;
        casesInJobs: number;
        availableCases: number;
      }[]
      > {
    return this.codingValidationService.getCodingIncompleteVariables(
      workspace_id,
      unitName
    );
  }

  @Post(':workspace_id/coding/applied-results-count')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'List of CODING_INCOMPLETE variables to check for applied results',
    schema: {
      type: 'object',
      properties: {
        incompleteVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Unit name' },
              variableId: { type: 'string', description: 'Variable ID' }
            }
          },
          description: 'List of variables that are CODING_INCOMPLETE'
        }
      },
      required: ['incompleteVariables']
    }
  })
  @ApiOkResponse({
    description: 'Count of applied results for CODING_INCOMPLETE variables.',
    schema: {
      type: 'number',
      description:
        'Number of responses that were CODING_INCOMPLETE but have been changed to final statuses in status_v2'
    }
  })
  async getAppliedResultsCount(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: { incompleteVariables: { unitName: string; variableId: string }[] }
  ): Promise<number> {
    return this.codingValidationService.getAppliedResultsCount(
      workspace_id,
      body.incompleteVariables
    );
  }

  @Get(':workspace_id/coding/missings-profiles')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of missings profiles retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: 'Label of the missings profile'
          }
        }
      }
    }
  })
  async getMissingsProfiles(
    @WorkspaceId() workspace_id: number
  ): Promise<{ label: string }[]> {
    return this.missingsProfilesService.getMissingsProfiles(workspace_id);
  }

  @Get(':workspace_id/coding/response-analysis')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description:
      'Response analysis retrieved successfully. Identifies empty responses and duplicate values based on response matching settings.',
    schema: {
      type: 'object',
      properties: {
        emptyResponses: {
          type: 'object',
          properties: {
            total: {
              type: 'number',
              description: 'Total number of empty responses'
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  unitAlias: { type: 'string', nullable: true },
                  variableId: { type: 'string' },
                  personLogin: { type: 'string' },
                  personCode: { type: 'string' },
                  bookletName: { type: 'string' },
                  responseId: { type: 'number' }
                }
              }
            }
          }
        },
        duplicateValues: {
          type: 'object',
          properties: {
            total: {
              type: 'number',
              description: 'Total number of duplicate value groups'
            },
            totalResponses: {
              type: 'number',
              description: 'Total number of responses in duplicate groups'
            },
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  unitAlias: { type: 'string', nullable: true },
                  variableId: { type: 'string' },
                  normalizedValue: { type: 'string' },
                  originalValue: { type: 'string' },
                  occurrences: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        personLogin: { type: 'string' },
                        personCode: { type: 'string' },
                        bookletName: { type: 'string' },
                        responseId: { type: 'number' },
                        value: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Response matching flags used for normalization'
        },
        analysisTimestamp: {
          type: 'string',
          description: 'ISO timestamp of when the analysis was performed'
        },
        isCalculating: {
          type: 'boolean',
          description: 'Whether the analysis is currently being calculated in the background'
        }
      }
    }
  })
  async getResponseAnalysis(
  @WorkspaceId() workspace_id: number,
    @Query('threshold') threshold?: number,
    @Query('emptyPage') emptyPage?: number,
    @Query('emptyLimit') emptyLimit?: number,
    @Query('duplicatePage') duplicatePage?: number,
    @Query('duplicateLimit') duplicateLimit?: number
  ) {
    const validThreshold = threshold ? Math.max(2, threshold) : 2;
    const vEmptyPage = emptyPage ? Math.max(1, emptyPage) : 1;
    const vEmptyLimit = emptyLimit ? Math.max(1, emptyLimit) : 50;
    const vDuplicatePage = duplicatePage ? Math.max(1, duplicatePage) : 1;
    const vDuplicateLimit = duplicateLimit ? Math.max(1, duplicateLimit) : 50;

    return this.codingAnalysisService.getResponseAnalysis(
      workspace_id,
      validThreshold,
      vEmptyPage,
      vEmptyLimit,
      vDuplicatePage,
      vDuplicateLimit
    );
  }

  @Post(':workspace_id/coding/apply-duplicate-aggregation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Aggregation configuration with threshold and mode',
    schema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Minimum number of duplicate occurrences to trigger aggregation',
          example: 2,
          minimum: 2
        },
        aggregateMode: {
          type: 'boolean',
          description: 'Whether to enable aggregation',
          example: true
        }
      },
      required: ['threshold', 'aggregateMode']
    }
  })
  @ApiOkResponse({
    description: 'Duplicate aggregation applied successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        aggregatedGroups: {
          type: 'number',
          description: 'Number of duplicate groups that were aggregated'
        },
        aggregatedResponses: {
          type: 'number',
          description: 'Total number of responses marked as aggregated'
        },
        uniqueCodingCases: {
          type: 'number',
          description: 'New total count of unique coding cases after aggregation'
        },
        message: { type: 'string' }
      }
    }
  })
  async applyDuplicateAggregation(
    @WorkspaceId() workspace_id: number,
      @Body() body: { threshold: number; aggregateMode: boolean }
  ): Promise<{
        success: boolean;
        aggregatedGroups: number;
        aggregatedResponses: number;
        uniqueCodingCases: number;
        message: string;
      }> {
    return this.codingAnalysisService.applyDuplicateAggregation(
      workspace_id,
      body.threshold,
      body.aggregateMode
    );
  }

  @Post(':workspace_id/coding/response-analysis')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Response analysis triggered successfully.'
  })
  async postTriggerResponseAnalysis(
    @WorkspaceId() workspace_id: number
  ): Promise<void> {
    await this.codingAnalysisService.startAnalysis(workspace_id);
  }
}
