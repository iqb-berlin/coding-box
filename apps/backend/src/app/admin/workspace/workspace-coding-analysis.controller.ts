import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  UseGuards
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
  ApiTags
} from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import {
  CodingValidationService,
  CodingAnalysisService,
  MissingsProfilesService
} from '../../database/services/coding';
import { VariableAnalysisReplayService } from '../../database/services/test-results';
import { ExportValidationResultsService } from '../../database/services/validation';
import { VariableAnalysisItemDto } from '../../../../../../api-dto/coding/variable-analysis-item.dto';
import { ValidateCodingCompletenessRequestDto } from '../../../../../../api-dto/coding/validate-coding-completeness-request.dto';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import { ExportValidationResultsRequestDto } from '../../../../../../api-dto/coding/export-validation-results-request.dto';
import { ManualCodeAvailabilityValidationDto } from '../../../../../../api-dto/coding/manual-code-availability.dto';
import { ResponseMatchingFlag } from '../../database/services/coding/coding-job.service';
import { Setting } from '../../database/entities/setting.entity';
import { getWorkspaceRegexSearchEnabled } from '../../utils/regex-search.util';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingAnalysisController {
  constructor(
    private variableAnalysisReplayService: VariableAnalysisReplayService,
    private exportValidationResultsService: ExportValidationResultsService,
    private codingValidationService: CodingValidationService,
    private codingAnalysisService: CodingAnalysisService,
    private missingsProfilesService: MissingsProfilesService,
    @InjectRepository(Setting)
    private readonly settingRepository: Repository<Setting>
  ) {}

  @Get(':workspace_id/coding/variable-analysis')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
  @ApiQuery({
    name: 'regexSearch',
    required: false,
    description:
      'Interpret variable ID filter as a case-sensitive regular expression',
    type: Boolean
  })
  async getVariableAnalysis(
    @WorkspaceId() workspace_id: number,
      @Query('authToken') authToken: string,
      @Query('serverUrl') serverUrl?: string,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 100,
                   @Query('unitId') unitId?: string,
                   @Query('variableId') variableId?: string,
                   @Query('derivation') derivation?: string,
                   @Query('regexSearch') regexSearch?: string
  ): Promise<{
        data: VariableAnalysisItemDto[];
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500
    const effectiveRegexSearch =
      regexSearch === 'true' &&
      (await getWorkspaceRegexSearchEnabled(
        this.settingRepository,
        workspace_id
      ));

    return this.variableAnalysisReplayService.getVariableAnalysis(
      workspace_id,
      authToken,
      serverUrl,
      validPage,
      validLimit,
      unitId,
      variableId,
      derivation,
      effectiveRegexSearch
    );
  }

  @Post(':workspace_id/coding/validate-completeness')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'trainingRequired',
    required: false,
    description: 'Filter variables by coder training requirement',
    type: Boolean
  })
  @ApiQuery({
    name: 'includeDeriveErrorOnly',
    required: false,
    description:
      'Also include variables that only have DERIVE_ERROR responses and expose DERIVE_ERROR-aware case counts',
    type: Boolean
  })
  @ApiQuery({
    name: 'excludeJobDefinitionId',
    required: false,
    description:
      'Ignore coding jobs from this job definition when calculating remaining cases',
    type: Number
  })
  @ApiOkResponse({
    description: 'Manual coding variables retrieved successfully.',
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
          deriveErrorResponseCount: {
            type: 'number',
            description: 'Number of DERIVE_ERROR responses for this variable'
          },
          casesInJobs: {
            type: 'number',
            description:
              'Number of unique cases already assigned to coding jobs'
          },
          availableCases: {
            type: 'number',
            description: 'Number of cases available for new job assignments'
          },
          uniqueCasesAfterAggregation: {
            type: 'number',
            description:
              'Number of unique coding cases after applying aggregation grouping (1 per duplicate group)'
          },
          availableCasesWithDeriveError: {
            type: 'number',
            description:
              'Number of available cases when DERIVE_ERROR is included'
          },
          uniqueCasesAfterAggregationWithDeriveError: {
            type: 'number',
            description:
              'Number of unique coding cases after aggregation when DERIVE_ERROR is included'
          },
          isDerived: {
            type: 'boolean',
            description:
              'Whether this is a derived variable (computed from other variables)'
          }
        }
      }
    }
  })
  async getCodingIncompleteVariables(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string,
      @Query('trainingRequired') trainingRequired?: string,
      @Query('includeDeriveErrorOnly') includeDeriveErrorOnly?: string,
      @Query('excludeJobDefinitionId') excludeJobDefinitionId?: string
  ): Promise<
      {
        unitName: string;
        variableId: string;
        responseCount: number;
        deriveErrorResponseCount: number;
        casesInJobs: number;
        availableCases: number;
        uniqueCasesAfterAggregation: number;
        availableCasesWithDeriveError?: number;
        uniqueCasesAfterAggregationWithDeriveError?: number;
        isDerived: boolean;
      }[]
      > {
    let trainingRequiredParam: boolean | undefined;
    if (trainingRequired === 'true') {
      trainingRequiredParam = true;
    } else if (trainingRequired === 'false') {
      trainingRequiredParam = false;
    }
    const parsedExcludeJobDefinitionId = Number(excludeJobDefinitionId);
    const excludeJobDefinitionIdParam =
      Number.isInteger(parsedExcludeJobDefinitionId) &&
      parsedExcludeJobDefinitionId > 0 ?
        parsedExcludeJobDefinitionId :
        undefined;
    return this.codingValidationService.getCodingIncompleteVariables(
      workspace_id,
      unitName,
      trainingRequiredParam,
      includeDeriveErrorOnly === 'true',
      excludeJobDefinitionIdParam
    );
  }

  @Get(':workspace_id/coding/incomplete-variables/scope-summary')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'trainingRequired',
    required: false,
    description: 'Filter variables by coder training requirement',
    type: Boolean
  })
  @ApiOkResponse({
    description: 'Manual coding scope summary retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        manualVariableCount: { type: 'number' },
        manualResponseCount: { type: 'number' },
        coveredSourceVariableCount: { type: 'number' },
        coveredSourceResponseCount: { type: 'number' },
        coveredSourceVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              responseCount: { type: 'number' },
              derivedVariableIds: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        }
      }
    }
  })
  async getManualCodingScopeSummary(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string,
      @Query('trainingRequired') trainingRequired?: string
  ): Promise<
      Awaited<ReturnType<CodingValidationService['getManualCodingScopeSummary']>>
      > {
    let trainingRequiredParam: boolean | undefined;
    if (trainingRequired === 'true') {
      trainingRequiredParam = true;
    } else if (trainingRequired === 'false') {
      trainingRequiredParam = false;
    }
    return this.codingValidationService.getManualCodingScopeSummary(
      workspace_id,
      unitName,
      trainingRequiredParam
    );
  }

  @Get(':workspace_id/coding/incomplete-variables/code-availability')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'trainingRequired',
    required: false,
    description: 'Filter variables by coder training requirement',
    type: Boolean
  })
  @ApiOkResponse({
    description:
      'Manual coding variables without selectable regular codes retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        checkedVariables: { type: 'number' },
        warningCount: { type: 'number' },
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              responseCount: { type: 'number' },
              casesInJobs: { type: 'number' },
              availableCases: { type: 'number' },
              uniqueCasesAfterAggregation: { type: 'number' },
              regularCodeCount: { type: 'number' },
              selectableRegularCodeCount: { type: 'number' },
              onlySpecialOptionsAvailable: { type: 'boolean' },
              message: { type: 'string' }
            }
          }
        }
      }
    }
  })
  async validateManualCodeAvailability(
    @WorkspaceId() workspace_id: number,
      @Query('unitName') unitName?: string,
      @Query('trainingRequired') trainingRequired?: string
  ): Promise<ManualCodeAvailabilityValidationDto> {
    let trainingRequiredParam: boolean | undefined;
    if (trainingRequired === 'true') {
      trainingRequiredParam = true;
    } else if (trainingRequired === 'false') {
      trainingRequiredParam = false;
    }

    return this.codingValidationService.validateManualCodeAvailability(
      workspace_id,
      unitName,
      trainingRequiredParam
    );
  }

  @Post(':workspace_id/coding/applied-results-count')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'List of manual coding variables to check for applied results',
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
          description: 'List of variables with manual coding cases'
        }
      },
      required: ['incompleteVariables']
    }
  })
  @ApiOkResponse({
    description: 'Count of applied results for manual coding variables.',
    schema: {
      type: 'number',
      description:
        'Number of manual coding responses that have been changed to final statuses in status_v2'
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
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
                  occurrenceCount: {
                    type: 'number',
                    nullable: true,
                    description:
                      'Total number of matching responses. occurrences may contain only a preview.'
                  },
                  occurrences: {
                    type: 'array',
                    description:
                      'Preview of matching responses for this duplicate group.',
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
        aggregationSummary: {
          type: 'object',
          properties: {
            duplicateGroups: {
              type: 'number',
              description: 'Number of aggregatable duplicate groups'
            },
            duplicateResponses: {
              type: 'number',
              description:
                'Number of responses in aggregatable duplicate groups'
            },
            collapsedCases: {
              type: 'number',
              description: 'Number of raw cases collapsed by aggregation'
            },
            rawCases: {
              type: 'number',
              description: 'Total raw coding cases considered for aggregation'
            },
            effectiveCases: {
              type: 'number',
              description: 'Total coding cases after aggregation'
            },
            threshold: {
              type: 'number',
              nullable: true,
              description: 'Duplicate aggregation threshold'
            },
            aggregationActive: {
              type: 'boolean',
              description: 'Whether duplicate aggregation is active'
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
        sourceRevision: {
          type: 'number',
          nullable: true,
          description:
            'Test result revision the cached analysis was calculated from'
        },
        currentSourceRevision: {
          type: 'number',
          nullable: true,
          description: 'Current test result revision for the workspace'
        },
        isCalculating: {
          type: 'boolean',
          description:
            'Whether the analysis is currently being calculated in the background'
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
    const validThreshold = this.normalizeIntegerParam(threshold, 2, 2, 100);
    const vEmptyPage = this.normalizeIntegerParam(emptyPage, 1, 1);
    const vEmptyLimit = this.normalizeIntegerParam(emptyLimit, 50, 1, 500);
    const vDuplicatePage = this.normalizeIntegerParam(duplicatePage, 1, 1);
    const vDuplicateLimit = this.normalizeIntegerParam(
      duplicateLimit,
      50,
      1,
      500
    );

    return this.codingAnalysisService.getResponseAnalysis(
      workspace_id,
      validThreshold,
      vEmptyPage,
      vEmptyLimit,
      vDuplicatePage,
      vDuplicateLimit
    );
  }

  @Get(':workspace_id/coding/aggregation-settings')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Current response aggregation settings.'
  })
  async getAggregationSettings(@WorkspaceId() workspace_id: number) {
    return this.codingAnalysisService.getAggregationSettings(workspace_id);
  }

  @Post(':workspace_id/coding/aggregation-settings')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Response aggregation settings',
    schema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description:
            'Minimum number of duplicate occurrences to trigger aggregation',
          example: 2,
          minimum: 2,
          maximum: 100
        },
        flags: {
          type: 'array',
          items: {
            type: 'string',
            enum: Object.values(ResponseMatchingFlag)
          },
          description: 'Response matching flags'
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Response aggregation settings saved.'
  })
  async saveAggregationSettings(
  @WorkspaceId() workspace_id: number,
                 @Body() body: { threshold?: number; flags?: ResponseMatchingFlag[] } = {}
  ) {
    const threshold = this.normalizeIntegerParam(body.threshold, 2, 2, 100);
    return this.codingAnalysisService.saveAggregationSettings(
      workspace_id,
      threshold,
      body.flags
    );
  }

  @Post(':workspace_id/coding/apply-duplicate-aggregation')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Aggregation configuration with threshold and mode',
    schema: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description:
            'Minimum number of duplicate occurrences to trigger aggregation',
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
          description:
            'New total count of unique coding cases after aggregation'
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
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'Response analysis triggered successfully.'
  })
  async postTriggerResponseAnalysis(
    @WorkspaceId() workspace_id: number,
                   @Body() body: { threshold?: number } = {}
  ): Promise<void> {
    const threshold =
      body.threshold === undefined ?
        undefined :
        this.normalizeIntegerParam(body.threshold, 2, 2, 100);

    await this.codingAnalysisService.startAnalysis(
      workspace_id,
      undefined,
      threshold,
      { forceRefresh: true }
    );
  }

  private normalizeIntegerParam(
    value: number | string | undefined,
    fallback: number,
    min: number,
    max?: number
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    const rounded = Math.round(parsed);
    return Math.min(max ?? rounded, Math.max(min, rounded));
  }
}
