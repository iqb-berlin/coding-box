import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  Body,
  Delete
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiBody
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { CodingStatistics } from '../../database/services/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { WorkspaceCodingService } from '../../database/services/workspace-coding.service';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingStatisticsService } from '../../database/services/coding-statistics.service';
import { ResponseEntity } from '../../database/entities/response.entity';
import { ExternalCodingImportDto } from '../../../../../../api-dto/coding/external-coding-import.dto';

import { JournalService } from '../../database/services/journal.service';

interface RequestWithUser extends Request {
  user: {
    userId: string;
    id: string;
    name: string;
    workspace: string;
  };
}

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  constructor(
    private workspaceCodingService: WorkspaceCodingService,
    private codingJobService: CodingJobService,
    private codingStatisticsService: CodingStatisticsService,
    private journalService: JournalService
  ) { }

  @Get(':workspace_id/coding')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'autoCoderRun',
    required: false,
    description:
      'Autocoder run type: 1 (standard) or 2 (uses v2 as input, saves to v3)',
    enum: [1, 2],
    example: 1
  })
  @ApiOkResponse({
    description: 'Coding statistics retrieved successfully.'
  })
  async codeTestPersons(
    @Query('testPersons') testPersons: string,
      @WorkspaceId() workspace_id: number,
      @Query('autoCoderRun') autoCoderRun: string
  ): Promise<CodingStatistics> {
    const autoCoderRunNumber = parseInt(autoCoderRun, 10) || 1;
    return this.workspaceCodingService.codeTestPersons(
      workspace_id,
      testPersons,
      autoCoderRunNumber
    );
  }

  @Get(':workspace_id/coding/manual')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiParam({ name: 'workspace_id', type: Number })
  async getManualTestPersons(
    @Query('testPersons') testPersons: string,
      @WorkspaceId() /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
                          workspace_id: number
  ): Promise<Array<ResponseEntity & { unitname: string }>> {
    return this.workspaceCodingService.getManualTestPersons(
      workspace_id,
      testPersons
    );
  }

  @Post(':workspace_id/coding/external-coding-import/stream')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'External coding file upload (CSV/Excel) with streaming progress',
    type: ExternalCodingImportDto
  })
  @ApiOkResponse({
    description: 'External coding import with progress streaming',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string'
        }
      }
    }
  })
  async importExternalCodingWithProgress(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto,
      @Res() res: Response
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

    try {
      const result =
        await this.workspaceCodingService.importExternalCodingWithProgress(
          workspace_id,
          body,
          (progress: number, message: string) => {
            res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
          }
        );

      // Send final result
      res.write(
        `data: ${JSON.stringify({
          progress: 100,
          message: 'Import completed',
          result
        })}\n\n`
      );
      res.end();
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          progress: 0,
          message: `Import failed: ${error.message}`,
          error: true
        })}\n\n`
      );
      res.end();
    }
  }

  @Post(':workspace_id/coding/external-coding-import')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'External coding file upload (CSV/Excel)',
    type: ExternalCodingImportDto
  })
  async importExternalCoding(
    @WorkspaceId() workspace_id: number,
      @Body() body: ExternalCodingImportDto
  ): Promise<{
        message: string;
        processedRows: number;
        updatedRows: number;
        errors: string[];
        affectedRows: Array<{
          unitAlias: string;
          variableId: string;
          personCode?: string;
          personLogin?: string;
          personGroup?: string;
          bookletName?: string;
          originalCodedStatus: string;
          originalCode: number | null;
          originalScore: number | null;
          updatedCodedStatus: string | null;
          updatedCode: number | null;
          updatedScore: number | null;
        }>;
      }> {
    return this.workspaceCodingService.importExternalCoding(workspace_id, body);
  }

  @Get(':workspace_id/coding/cohens-kappa')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'unitName',
    required: false,
    description: 'Filter by unit name',
    type: String
  })
  @ApiQuery({
    name: 'variableId',
    required: false,
    description: 'Filter by variable ID',
    type: String
  })
  @ApiOkResponse({
    description:
      "Cohen's Kappa statistics for double-coded variables with workspace summary.",
    schema: {
      type: 'object',
      properties: {
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              coderPairs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coder1Id: { type: 'number', description: 'First coder ID' },
                    coder1Name: {
                      type: 'string',
                      description: 'First coder name'
                    },
                    coder2Id: {
                      type: 'number',
                      description: 'Second coder ID'
                    },
                    coder2Name: {
                      type: 'string',
                      description: 'Second coder name'
                    },
                    kappa: {
                      type: 'number',
                      nullable: true,
                      description: "Cohen's Kappa coefficient"
                    },
                    agreement: {
                      type: 'number',
                      description: 'Observed agreement percentage'
                    },
                    totalItems: {
                      type: 'number',
                      description: 'Total items coded by both coders'
                    },
                    validPairs: {
                      type: 'number',
                      description: 'Number of valid coding pairs'
                    },
                    interpretation: {
                      type: 'string',
                      description: 'Interpretation of the Kappa value'
                    }
                  }
                },
                description: "Cohen's Kappa statistics for each coder pair"
              }
            }
          },
          description: "Per-variable Cohen's Kappa statistics"
        },
        workspaceSummary: {
          type: 'object',
          properties: {
            totalDoubleCodedResponses: {
              type: 'number',
              description: 'Total number of double-coded responses'
            },
            totalCoderPairs: {
              type: 'number',
              description: 'Total number of coder pairs analyzed'
            },
            averageKappa: {
              type: 'number',
              nullable: true,
              description: "Average Cohen's Kappa across all coder pairs"
            },
            variablesIncluded: {
              type: 'number',
              description: 'Number of variables included in the analysis'
            },
            codersIncluded: {
              type: 'number',
              description: 'Number of coders included in the analysis'
            }
          },
          description: 'Workspace-wide summary statistics'
        }
      }
    }
  })

  @Delete(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to delete'
  })
  @ApiOkResponse({
    description: 'Coder training deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the deletion was successful'
        },
        message: { type: 'string', description: 'Result message' }
      }
    }
  })

  @Get(':workspace_id/coding/responses/:status')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'status',
    type: String,
    description: 'Response status to filter by'
  })
  @ApiQuery({
    name: 'version',
    required: false,
    description: 'Coding version to get responses for: v1, v2, or v3',
    enum: ['v1', 'v2', 'v3'],
    example: 'v1'
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
  @ApiOkResponse({
    description: 'Responses retrieved successfully.',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number', description: 'Response ID' },
              unitId: { type: 'string', description: 'Unit ID' },
              variableid: { type: 'string', description: 'Variable ID' },
              value: { type: 'string', description: 'Response value' },
              status: { type: 'string', description: 'Response status' },
              codedstatus: { type: 'string', description: 'Coded status' },
              code_v1: { type: 'number', description: 'Code for version 1' },
              score_v1: { type: 'number', description: 'Score for version 1' },
              code_v2: { type: 'number', description: 'Code for version 2' },
              score_v2: { type: 'number', description: 'Score for version 2' },
              code_v3: { type: 'number', description: 'Code for version 3' },
              score_v3: { type: 'number', description: 'Score for version 3' }
            }
          }
        },
        total: { type: 'number', description: 'Total number of items' },
        page: { type: 'number', description: 'Current page number' },
        limit: { type: 'number', description: 'Number of items per page' }
      }
    }
  })
  async getResponsesByStatus(
    @WorkspaceId() workspace_id: number,
      @Param('status') status: string,
                   @Query('version') version: 'v1' | 'v2' | 'v3' = 'v1',
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 100
  ): Promise<{
        data: ResponseEntity[];
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 500); // Set maximum limit to 500

    return this.workspaceCodingService.getResponsesByStatus(
      workspace_id,
      status,
      version,
      validPage,
      validLimit
    );
  }

  @Get(':workspace_id/coding/responses/:responseId/replay-url')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'responseId',
    type: Number,
    description: 'ID of the response'
  })
  @ApiQuery({
    name: 'authToken',
    required: true,
    description: 'Authentication token for the replay URL',
    type: String
  })
  @ApiOkResponse({
    description: 'Replay URL generated successfully.',
    schema: {
      type: 'object',
      properties: {
        replayUrl: { type: 'string', description: 'The generated replay URL' }
      }
    }
  })
  async getReplayUrl(
    @WorkspaceId() workspace_id: number,
      @Param('responseId') responseId: number,
      @Query('authToken') authToken: string,
      @Req() req: Request
  ): Promise<{ replayUrl: string }> {
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    return this.workspaceCodingService.generateReplayUrlForResponse(
      workspace_id,
      responseId,
      serverUrl,
      authToken
    );
  }

  @Get(':workspace_id/coding/double-coded-review')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'page',
    required: false,
    description: 'Page number for pagination (default: 1)',
    type: Number
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of items per page (default: 50, max: 100)',
    type: Number
  })
  @ApiOkResponse({
    description: 'Double-coded variables retrieved for review',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'Response ID' },
              unitName: { type: 'string', description: 'Name of the unit' },
              variableId: { type: 'string', description: 'Variable ID' },
              personLogin: { type: 'string', description: 'Person login' },
              personCode: { type: 'string', description: 'Person code' },
              bookletName: { type: 'string', description: 'Booklet name' },
              givenAnswer: {
                type: 'string',
                description: 'The given answer by the test person'
              },
              coderResults: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    coderId: { type: 'number', description: 'Coder user ID' },
                    coderName: { type: 'string', description: 'Coder name' },
                    jobId: { type: 'number', description: 'Coding job ID' },
                    code: {
                      type: 'number',
                      nullable: true,
                      description: 'Code given by the coder'
                    },
                    score: {
                      type: 'number',
                      nullable: true,
                      description: 'Score given by the coder'
                    },
                    notes: {
                      type: 'string',
                      nullable: true,
                      description: 'Notes from the coder'
                    },
                    codedAt: {
                      type: 'string',
                      format: 'date-time',
                      description: 'When the coding was done'
                    }
                  }
                },
                description: 'Results from all coders who coded this variable'
              }
            }
          }
        },
        total: {
          type: 'number',
          description: 'Total number of double-coded variables'
        },
        page: { type: 'number', description: 'Current page number' },
        limit: { type: 'number', description: 'Number of items per page' }
      }
    }
  })
  async getDoubleCodedVariablesForReview(
    @WorkspaceId() workspace_id: number,
                   @Query('page') page: number = 1,
                   @Query('limit') limit: number = 50
  ): Promise<{
        data: Array<{
          responseId: number;
          unitName: string;
          variableId: string;
          personLogin: string;
          personCode: string;
          bookletName: string;
          givenAnswer: string;
          coderResults: Array<{
            coderId: number;
            coderName: string;
            jobId: number;
            code: number | null;
            score: number | null;
            notes: string | null;
            codedAt: Date;
          }>;
        }>;
        total: number;
        page: number;
        limit: number;
      }> {
    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100); // Max 100 items per page for review

    return this.workspaceCodingService.getDoubleCodedVariablesForReview(
      workspace_id,
      validPage,
      validLimit
    );
  }

  @Post(':workspace_id/coding/double-coded-review/apply-resolutions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Apply resolutions for double-coded variables',
    schema: {
      type: 'object',
      properties: {
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              responseId: { type: 'number', description: 'Response ID' },
              selectedJobId: {
                type: 'number',
                description: 'Selected coding job ID'
              },
              resolutionComment: {
                type: 'string',
                nullable: true,
                description: 'Optional resolution comment'
              }
            },
            required: ['responseId', 'selectedJobId']
          }
        }
      },
      required: ['decisions']
    }
  })
  @ApiOkResponse({
    description: 'Resolutions applied successfully',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the operation was successful'
        },
        appliedCount: {
          type: 'number',
          description: 'Number of resolutions applied'
        },
        failedCount: {
          type: 'number',
          description: 'Number of resolutions that failed'
        },
        skippedCount: {
          type: 'number',
          description: 'Number of resolutions skipped'
        },
        message: { type: 'string', description: 'Summary message' }
      }
    }
  })
  async applyDoubleCodedResolutions(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     decisions: Array<{
                       responseId: number;
                       selectedJobId: number;
                       resolutionComment?: string;
                     }>;
                   }
  ): Promise<{
        success: boolean;
        appliedCount: number;
        failedCount: number;
        skippedCount: number;
        message: string;
      }> {
    return this.workspaceCodingService.applyDoubleCodedResolutions(
      workspace_id,
      body.decisions
    );
  }

  @Get(':workspace_id/coding-job/:codingJobId/notes')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'codingJobId',
    type: Number,
    description: 'ID of the coding job'
  })
  @ApiOkResponse({
    description: 'Coding notes retrieved successfully.',
    schema: {
      type: 'object',
      description: 'Map of composite keys to notes',
      additionalProperties: { type: 'string' }
    }
  })
  async getCodingJobNotes(
    @WorkspaceId() workspace_id: number,
      @Param('codingJobId') codingJobId: number
  ): Promise<Record<string, string>> {
    return this.codingJobService.getCodingNotes(codingJobId);
  }

  @Post(':workspace_id/coding/reset-version')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(3)
  @ApiTags('coding')
  @ApiParam({
    name: 'workspace_id',
    type: Number,
    description: 'ID of the workspace'
  })
  @ApiBody({
    description: 'Reset coding version request',
    schema: {
      type: 'object',
      properties: {
        version: {
          type: 'string',
          enum: ['v1', 'v2', 'v3'],
          description: 'Coding version to reset'
        },
        unitFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional unit names to filter by'
        },
        variableFilters: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
          description: 'Optional variable IDs to filter by'
        }
      },
      required: ['version']
    }
  })
  @ApiOkResponse({
    description: 'Coding version reset successfully',
    schema: {
      type: 'object',
      properties: {
        affectedResponseCount: {
          type: 'number',
          description: 'Number of responses that were reset'
        },
        cascadeResetVersions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Versions that were also reset due to cascade'
        },
        message: {
          type: 'string',
          description: 'Summary message of the reset operation'
        }
      }
    }
  })
  async resetCodingVersion(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     version: 'v1' | 'v2' | 'v3';
                     unitFilters?: string[];
                     variableFilters?: string[];
                   },
                   @Req() request: RequestWithUser
  ): Promise<{
        affectedResponseCount: number;
        cascadeResetVersions: ('v2' | 'v3')[];
        message: string;
      }> {
    const result = await this.workspaceCodingService.resetCodingVersion(
      workspace_id,
      body.version,
      body.unitFilters,
      body.variableFilters
    );

    // Invalidate statistics cache for reset versions
    await this.codingStatisticsService.invalidateCache(
      workspace_id,
      body.version
    );
    if (result.cascadeResetVersions.length > 0) {
      for (const cascadeVersion of result.cascadeResetVersions) {
        await this.codingStatisticsService.invalidateCache(
          workspace_id,
          cascadeVersion
        );
      }
    }

    // Log to journal
    const userId = request.user?.id || 'unknown';
    await this.journalService.createEntry(
      userId,
      workspace_id,
      'RESET_VERSION',
      'CODING',
      workspace_id,
      {
        version: body.version,
        affectedResponseCount: result.affectedResponseCount,
        unitFilters: body.unitFilters || [],
        variableFilters: body.variableFilters || [],
        cascadeResetVersions: result.cascadeResetVersions
      }
    );

    return result;
  }
}
