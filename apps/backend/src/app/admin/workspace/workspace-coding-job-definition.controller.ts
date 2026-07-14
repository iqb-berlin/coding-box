import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  UseGuards,
  Body,
  ValidationPipe,
  ParseIntPipe,
  Res,
  Query
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiBody,
  ApiProduces,
  ApiQuery
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { JobDefinitionService } from '../../database/services/jobs';
import type { JobDefinitionWithCreatedJobsCount } from '../../database/services/jobs';
import { JobDefinition } from '../../database/entities/job-definition.entity';
import { CreateJobDefinitionDto } from '../coding-job/dto/create-job-definition.dto';
import { UpdateJobDefinitionDto } from '../coding-job/dto/update-job-definition.dto';
import { ApproveJobDefinitionDto } from '../coding-job/dto/approve-job-definition.dto';
import {
  JobDefinitionRefreshApplyResultDto,
  JobDefinitionRefreshPreviewDto
} from '../../../../../../api-dto/coding/job-refresh.dto';

const NUMBER_RECORD_SCHEMA = {
  type: 'object',
  additionalProperties: { type: 'number' }
};

const DISTRIBUTION_SNAPSHOT_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      version: { type: 'number', enum: [1] },
      source: { type: 'string', enum: ['initial_creation', 'refresh'] },
      createdAt: { type: 'string', format: 'date-time' },
      distributionSeed: { type: 'string' },
      selectedVariables: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            unitName: { type: 'string' },
            variableId: { type: 'string' },
            includeDeriveError: { type: 'boolean' }
          }
        }
      },
      selectedVariableBundles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
            variables: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  unitName: { type: 'string' },
                  variableId: { type: 'string' },
                  includeDeriveError: { type: 'boolean' }
                }
              }
            },
            sampleCount: { type: 'number' },
            caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] }
          }
        }
      },
      selectedCoders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            coderId: { type: 'number' },
            capacityPercent: { type: 'number' }
          }
        }
      },
      settings: {
        type: 'object',
        properties: {
          maxCodingCases: { type: 'number', nullable: true },
          doubleCodingAbsolute: { type: 'number' },
          doubleCodingPercentage: { type: 'number' },
          caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] }
        }
      },
      distributionByCoderId: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          additionalProperties: { type: 'number' }
        }
      },
      doubleCodingInfo: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            totalCases: { type: 'number' },
            distinctCases: { type: 'number' },
            codingTasksTotal: { type: 'number' },
            doubleCodedCases: { type: 'number' },
            singleCodedCasesAssigned: { type: 'number' },
            doubleCodedCasesPerCoderId: NUMBER_RECORD_SCHEMA
          }
        }
      },
      aggregationInfo: {
        type: 'object',
        additionalProperties: {
          type: 'object',
          properties: {
            uniqueCases: { type: 'number' },
            totalResponses: { type: 'number' }
          }
        }
      },
      matchingFlags: {
        type: 'array',
        items: { type: 'string' }
      },
      pairDistribution: NUMBER_RECORD_SCHEMA,
      tasksPerCoder: NUMBER_RECORD_SCHEMA,
      coderWeights: NUMBER_RECORD_SCHEMA,
      jobs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemKey: { type: 'string' },
            coderId: { type: 'number' },
            variable: {
              type: 'object',
              properties: {
                unitName: { type: 'string' },
                variableId: { type: 'string' }
              }
            },
            jobId: { type: 'number' },
            caseCount: { type: 'number' }
          }
        }
      },
      refreshPreview: {
        type: 'object',
        nullable: true
      }
    }
  }
};

@ApiTags('Admin Workspace Job Definition')
@Controller('admin/workspace')
export class WorkspaceCodingJobDefinitionController {
  constructor(
    private jobDefinitionService: JobDefinitionService
  ) { }

  @Post(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create a new job definition',
    type: CreateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition created successfully.'
  })
  async createJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) createDto: CreateJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.createJobDefinition(
      createDto,
      workspace_id
    );
  }

  @Get(':workspace_id/coding/job-definitions')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'includePlannedUsage',
    required: false,
    type: Boolean,
    description: 'Include expensive planned variable usage calculations.'
  })
  @ApiOkResponse({
    description: 'List of job definitions retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          status: { type: 'string' },
          assigned_variables: { type: 'array' },
          assigned_variable_bundles: { type: 'array' },
          assigned_coders: { type: 'array' },
          assigned_coder_configs: { type: 'array' },
          distribution_snapshots: DISTRIBUTION_SNAPSHOT_SCHEMA,
          missings_profile_id: { type: 'number', nullable: true },
          distribution_seed: { type: 'string' },
          duration_seconds: { type: 'number' },
          max_coding_cases: { type: 'number', nullable: true },
          double_coding_absolute: { type: 'number' },
          double_coding_percentage: { type: 'number' },
          show_score: { type: 'boolean' },
          allow_comments: { type: 'boolean' },
          suppress_general_instructions: { type: 'boolean' },
          createdJobsCount: { type: 'number' },
          created_jobs_count: { type: 'number' },
          blockingCreatedJobsCount: { type: 'number' },
          blocking_created_jobs_count: { type: 'number' },
          openCreatedJobsCount: { type: 'number' },
          open_created_jobs_count: { type: 'number' },
          plannedVariableUsage: {
            type: 'object',
            additionalProperties: { type: 'number' }
          },
          planned_variable_usage: {
            type: 'object',
            additionalProperties: { type: 'number' }
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getJobDefinitions(
    @WorkspaceId() workspace_id: number,
      @Query('includePlannedUsage') includePlannedUsage?: string
  ): Promise<JobDefinitionWithCreatedJobsCount[]> {
    return this.jobDefinitionService.getJobDefinitions(workspace_id, {
      includePlannedUsage: includePlannedUsage === 'true'
    });
  }

  @Get(':workspace_id/coding/job-definitions/approved')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of approved job definitions retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          assigned_variables: { type: 'array' },
          assigned_variable_bundles: { type: 'array' },
          assigned_coders: { type: 'array' },
          assigned_coder_configs: { type: 'array' },
          distribution_snapshots: DISTRIBUTION_SNAPSHOT_SCHEMA,
          missings_profile_id: { type: 'number', nullable: true },
          distribution_seed: { type: 'string' },
          duration_seconds: { type: 'number' },
          max_coding_cases: { type: 'number', nullable: true },
          double_coding_absolute: { type: 'number' },
          double_coding_percentage: { type: 'number' },
          show_score: { type: 'boolean' },
          allow_comments: { type: 'boolean' },
          suppress_general_instructions: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      }
    }
  })
  async getApprovedJobDefinitions(
    @WorkspaceId() workspaceId: number
  ): Promise<JobDefinition[]> {
    return this.jobDefinitionService.getApprovedJobDefinitions(workspaceId);
  }

  @Get(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Job definition retrieved successfully.'
  })
  async getJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.getJobDefinition(id, workspace_id);
  }

  @Get(':workspace_id/coding/job-definitions/:id/distribution/csv')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    description: 'Job definition distribution exported as CSV.',
    content: {
      'text/csv': {
        schema: {
          type: 'string',
          format: 'binary'
        }
      }
    }
  })
  async exportJobDefinitionDistributionAsCsv(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Res() res: Response
  ): Promise<void> {
    const csvContent = await this.jobDefinitionService.exportDistributionSnapshotAsCsv(id, workspace_id);
    const exportDate = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="job-definition-distribution-${workspace_id}-${id}-${exportDate}.csv"`
    );
    res.send(`\uFEFF${csvContent}`);
  }

  @Put(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Update job definition',
    type: UpdateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition updated successfully.'
  })
  async updateJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id', ParseIntPipe) id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.updateJobDefinition(id, workspace_id, updateDto);
  }

  @Put(':workspace_id/coding/job-definitions/:id/approve')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Approve job definition',
    type: ApproveJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Job definition approved successfully.'
  })
  async approveJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) approveDto: ApproveJobDefinitionDto
  ): Promise<JobDefinition> {
    return this.jobDefinitionService.approveJobDefinition(id, workspace_id, approveDto);
  }

  @Delete(':workspace_id/coding/job-definitions/:id')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Job definition deleted successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' }
      }
    }
  })
  async deleteJobDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<{ success: boolean; message: string }> {
    await this.jobDefinitionService.deleteJobDefinition(id, workspace_id);
    return { success: true, message: 'Job definition deleted successfully' };
  }

  @Post(':workspace_id/coding/job-definitions/:id/create-job')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Distributed coding jobs created successfully from job definition.'
  })
  async createCodingJobFromDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<Awaited<ReturnType<JobDefinitionService['createCodingJobFromDefinition']>>> {
    return this.jobDefinitionService.createCodingJobFromDefinition(
      id,
      workspace_id
    );
  }

  @Get(':workspace_id/coding/job-definitions/:id/create-job-preview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Preview distributed coding jobs from a job definition.',
    schema: {
      type: 'object',
      properties: {
        distribution: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        distributionByCoderId: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            additionalProperties: { type: 'number' }
          }
        },
        doubleCodingInfo: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              totalCases: { type: 'number' },
              distinctCases: { type: 'number' },
              codingTasksTotal: { type: 'number' },
              doubleCodedCases: { type: 'number' },
              singleCodedCasesAssigned: { type: 'number' },
              doubleCodedCasesPerCoder: {
                type: 'object',
                additionalProperties: { type: 'number' }
              },
              doubleCodedCasesPerCoderId: {
                type: 'object',
                additionalProperties: { type: 'number' }
              }
            }
          }
        },
        aggregationInfo: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            properties: {
              uniqueCases: { type: 'number' },
              totalResponses: { type: 'number' }
            }
          }
        },
        matchingFlags: {
          type: 'array',
          items: { type: 'string' }
        },
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              message: { type: 'string' },
              casesInJobs: { type: 'number' },
              availableCases: { type: 'number' }
            }
          }
        },
        pairDistribution: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        tasksPerCoder: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        coderWeights: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        selectedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              includeDeriveError: { type: 'boolean' }
            }
          }
        },
        selectedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              caseOrderingMode: { type: 'string', enum: ['continuous', 'alternating'] },
              variables: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    unitName: { type: 'string' },
                    variableId: { type: 'string' },
                    includeDeriveError: { type: 'boolean' }
                  }
                }
              }
            }
          }
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              username: { type: 'string' },
              capacityPercent: { type: 'number' }
            }
          }
        }
      },
      required: [
        'distribution',
        'doubleCodingInfo',
        'aggregationInfo',
        'matchingFlags',
        'warnings',
        'selectedVariables',
        'selectedVariableBundles',
        'selectedCoders'
      ]
    }
  })
  async previewCodingJobFromDefinition(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<Awaited<ReturnType<JobDefinitionService['previewCodingJobFromDefinition']>>> {
    return this.jobDefinitionService.previewCodingJobFromDefinition(
      id,
      workspace_id
    );
  }

  @Get(':workspace_id/coding/job-definitions/:id/refresh-preview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Preview how an approved job definition would change when regenerated.'
  })
  async previewJobDefinitionRefresh(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<JobDefinitionRefreshPreviewDto> {
    return this.jobDefinitionService.previewJobDefinitionRefresh(
      id,
      workspace_id
    );
  }

  @Post(':workspace_id/coding/job-definitions/:id/update-refresh-preview')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Preview a job definition update and the required job refresh',
    type: UpdateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Preview how existing coding jobs would change after updating the job definition.'
  })
  async previewJobDefinitionUpdateRefresh(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinitionRefreshPreviewDto> {
    return this.jobDefinitionService.previewJobDefinitionUpdateRefresh(
      id,
      workspace_id,
      updateDto
    );
  }

  @Post(':workspace_id/coding/job-definitions/:id/refresh-apply')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiOkResponse({
    description: 'Regenerate coding jobs from an approved job definition.'
  })
  async applyJobDefinitionRefresh(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number
  ): Promise<JobDefinitionRefreshApplyResultDto> {
    return this.jobDefinitionService.refreshCodingJobFromDefinition(
      id,
      workspace_id
    );
  }

  @Post(':workspace_id/coding/job-definitions/:id/update-refresh-apply')
  @UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
  @RequireAccessLevel(2)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({ name: 'id', type: Number, description: 'Job definition ID' })
  @ApiBody({
    description: 'Apply a job definition update and refresh its existing coding jobs',
    type: UpdateJobDefinitionDto
  })
  @ApiOkResponse({
    description: 'Updated job definition and regenerated coding jobs.'
  })
  async applyJobDefinitionUpdateRefresh(
    @WorkspaceId() workspace_id: number,
      @Param('id') id: number,
      @Body(new ValidationPipe({ transform: true, whitelist: true })) updateDto: UpdateJobDefinitionDto
  ): Promise<JobDefinitionRefreshApplyResultDto> {
    return this.jobDefinitionService.refreshCodingJobFromUpdatedDefinition(
      id,
      workspace_id,
      updateDto
    );
  }
}
