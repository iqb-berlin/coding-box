import {
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CoderTrainingService } from '../../database/services/coding';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../database/entities/job-definition.entity';

@ApiTags('Admin Workspace Coder Training')
@Controller('admin/workspace')
export class WorkspaceCoderTrainingController {
  constructor(
    private coderTrainingService: CoderTrainingService
  ) { }

  @Post(':workspace_id/coding/coder-training-packages')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description:
      'Generate coder training packages based on CODING_INCOMPLETE responses for specific variable and unit combinations',
    schema: {
      type: 'object',
      properties: {
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        }
      }
    }
  })
  @ApiOkResponse({
    description: 'Coder training packages generated successfully',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          coderId: { type: 'number' },
          coderName: { type: 'string' },
          responses: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                responseId: { type: 'number' },
                unitAlias: { type: 'string' },
                variableId: { type: 'string' },
                unitName: { type: 'string' },
                value: { type: 'string' },
                personLogin: { type: 'string' },
                personCode: { type: 'string' },
                personGroup: { type: 'string' },
                bookletName: { type: 'string' },
                variable: { type: 'string' }
              }
            }
          }
        }
      }
    }
  })
  async generateCoderTrainingPackages(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     selectedCoders: { id: number; name: string }[];
                     variableConfigs: {
                       variableId: string;
                       unitId: string;
                       sampleCount: number;
                     }[];
                   }
  ): Promise<
      {
        coderId: number;
        coderName: string;
        responses: {
          responseId: number;
          unitAlias: string;
          variableId: string;
          unitName: string;
          value: string;
          personLogin: string;
          personCode: string;
          personGroup: string;
          bookletName: string;
          variable: string;
        }[];
      }[]
      > {
    return this.coderTrainingService.generateCoderTrainingPackages(
      workspace_id,
      body.selectedCoders,
      body.variableConfigs
    );
  }

  @Get(':workspace_id/coding/coder-trainings')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiOkResponse({
    description: 'List of coder trainings retrieved successfully.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Training ID' },
          workspace_id: { type: 'number', description: 'Workspace ID' },
          label: { type: 'string', description: 'Training label' },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Creation date'
          },
          updated_at: {
            type: 'string',
            format: 'date-time',
            description: 'Last update date'
          },
          jobsCount: {
            type: 'number',
            description: 'Number of coding jobs in this training'
          }
        }
      }
    }
  })
  async getCoderTrainings(@WorkspaceId() workspace_id: number): Promise<
  {
    id: number;
    workspace_id: number;
    label: string;
    created_at: Date;
    updated_at: Date;
    jobsCount: number;
  }[]
  > {
    return this.coderTrainingService.getCoderTrainings(workspace_id);
  }

  @Post(':workspace_id/coding/coder-training-jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiBody({
    description: 'Create persistent coding jobs for coder training',
    schema: {
      type: 'object',
      properties: {
        trainingLabel: {
          type: 'string',
          description: 'Label for the coder training session'
        },
        missingsProfileId: {
          type: 'number',
          description:
            'ID of the missings profile to assign to all created coding jobs'
        },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        },
        assignedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        },
        assignedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        }
      },
      required: ['trainingLabel', 'selectedCoders', 'variableConfigs']
    }
  })
  @ApiOkResponse({
    description: 'Coding jobs created successfully for coder training',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        jobsCreated: { type: 'number' },
        message: { type: 'string' },
        jobs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              coderId: { type: 'number' },
              coderName: { type: 'string' },
              jobId: { type: 'number' },
              jobName: { type: 'string' }
            }
          }
        },
        trainingId: {
          type: 'number',
          description: 'ID of the created coder training session'
        }
      }
    }
  })
  async createCoderTrainingJobs(
    @WorkspaceId() workspace_id: number,
      @Body()
                   body: {
                     trainingLabel: string;
                     missingsProfileId?: number;
                     selectedCoders: { id: number; name: string }[];
                     variableConfigs: {
                       variableId: string;
                       unitId: string;
                       sampleCount: number;
                     }[];
                     assignedVariables?: JobDefinitionVariable[];
                     assignedVariableBundles?: JobDefinitionVariableBundle[];
                   }
  ): Promise<{
        success: boolean;
        jobsCreated: number;
        message: string;
        jobs: {
          coderId: number;
          coderName: string;
          jobId: number;
          jobName: string;
        }[];
        trainingId?: number;
      }> {
    return this.coderTrainingService.createCoderTrainingJobs(
      workspace_id,
      body.selectedCoders,
      body.variableConfigs,
      body.trainingLabel,
      body.missingsProfileId,
      body.assignedVariables,
      body.assignedVariableBundles
    );
  }

  @Get(':workspace_id/coding/compare-training-results')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingIds',
    required: true,
    description: 'Comma-separated list of training IDs to compare',
    type: String
  })
  @ApiOkResponse({
    description: 'Comparison of coding results across training components',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Name of the unit' },
          variableId: { type: 'string', description: 'Variable ID' },
          trainings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trainingId: { type: 'number', description: 'Training ID' },
                trainingLabel: {
                  type: 'string',
                  description: 'Training label'
                },
                code: {
                  type: 'string',
                  description: 'Code given by coders in this training'
                },
                score: {
                  type: 'number',
                  description: 'Score given by coders in this training'
                }
              }
            }
          }
        }
      }
    }
  })
  async compareTrainingCodingResults(
    @WorkspaceId() workspace_id: number,
      @Query('trainingIds') trainingIdsQuery: string
  ): Promise<
      Array<{
        unitName: string;
        variableId: string;
        trainings: Array<{
          trainingId: number;
          trainingLabel: string;
          code: string | null;
          score: number | null;
        }>;
      }>
      > {
    const trainingIds = trainingIdsQuery
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !Number.isNaN(id));

    if (trainingIds.length === 0) {
      throw new Error('At least one valid training ID must be provided');
    }

    return this.coderTrainingService.getTrainingCodingComparison(
      workspace_id,
      trainingIds
    );
  }

  @Get(':workspace_id/coding/compare-within-training')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiQuery({
    name: 'trainingId',
    required: true,
    description: 'ID of the training to compare coders within',
    type: Number
  })
  @ApiOkResponse({
    description:
      'Comparison of coding results within a single training by individual coders',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          unitName: { type: 'string', description: 'Name of the unit' },
          variableId: { type: 'string', description: 'Variable ID' },
          personCode: { type: 'string', description: 'Person code' },
          testPerson: { type: 'string', description: 'Test person details' },
          givenAnswer: { type: 'string', description: 'Given answer' },
          coders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                jobId: { type: 'number', description: 'Job ID' },
                coderName: { type: 'string', description: 'Name of the coder' },
                code: {
                  type: 'string',
                  description: 'Code given by this coder'
                },
                score: {
                  type: 'number',
                  description: 'Score given by this coder'
                }
              }
            }
          }
        }
      }
    }
  })
  async compareWithinTrainingCodingResults(
    @WorkspaceId() workspace_id: number,
      @Query('trainingId') trainingId: number
  ): Promise<
      Array<{
        unitName: string;
        variableId: string;
        personCode: string;
        testPerson: string;
        givenAnswer: string;
        coders: Array<{
          jobId: number;
          coderName: string;
          code: string | null;
          score: number | null;
        }>;
      }>
      > {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    // Get coding results for all jobs within the training
    return this.coderTrainingService.getWithinTrainingCodingComparison(
      workspace_id,
      trainingId
    );
  }

  @Put(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to update'
  })
  @ApiBody({
    description: 'Updated coder training configuration',
    schema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        missingsProfileId: { type: 'number' },
        selectedCoders: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        },
        variableConfigs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              variableId: { type: 'string' },
              unitId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        },
        assignedVariables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unitName: { type: 'string' },
              variableId: { type: 'string' },
              sampleCount: { type: 'number' }
            }
          }
        },
        assignedVariableBundles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' }
            }
          }
        }
      },
      required: ['label', 'selectedCoders', 'variableConfigs']
    }
  })
  @ApiOkResponse({
    description: 'Coder training updated successfully.',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        jobsCreated: { type: 'number' }
      }
    }
  })
  async updateCoderTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: {
        label: string;
        missingsProfileId?: number;
        selectedCoders: { id: number; name: string }[];
        variableConfigs: {
          variableId: string;
          unitId: string;
          sampleCount: number;
        }[];
        assignedVariables?: JobDefinitionVariable[];
        assignedVariableBundles?: JobDefinitionVariableBundle[];
      }
  ): Promise<{ success: boolean; message: string; jobsCreated?: number }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.updateCoderTraining(
      workspace_id,
      trainingId,
      body.label,
      body.selectedCoders,
      body.variableConfigs,
      body.missingsProfileId,
      body.assignedVariables,
      body.assignedVariableBundles
    );
  }

  @Get(':workspace_id/coding/coder-trainings/:trainingId/jobs')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training'
  })
  @ApiOkResponse({
    description: 'List of coding jobs for the specified coder training.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Job ID' },
          name: { type: 'string', description: 'Job name' },
          description: { type: 'string', description: 'Job description' },
          status: { type: 'string', description: 'Job status' },
          created_at: {
            type: 'string',
            format: 'date-time',
            description: 'Creation date'
          },
          coder: {
            type: 'object',
            properties: {
              userId: { type: 'number', description: 'Coder user ID' },
              username: { type: 'string', description: 'Coder username' }
            }
          },
          unitsCount: {
            type: 'number',
            description: 'Number of coding units in the job'
          }
        }
      }
    }
  })
  async getCodingJobsForTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<
      Array<{
        id: number;
        name: string;
        description?: string;
        status: string;
        created_at: Date;
        coder: {
          userId: number;
          username: string;
        };
        unitsCount: number;
      }>
      > {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.getCodingJobsForTraining(
      workspace_id,
      trainingId
    );
  }

  @Delete(':workspace_id/coding/coder-trainings/:trainingId')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
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
  async deleteCoderTraining(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number
  ): Promise<{ success: boolean; message: string }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    return this.coderTrainingService.deleteCoderTraining(
      workspace_id,
      trainingId
    );
  }

  @Put(':workspace_id/coding/coder-trainings/:trainingId/label')
  @UseGuards(JwtAuthGuard, WorkspaceGuard)
  @ApiTags('coding')
  @ApiParam({ name: 'workspace_id', type: Number })
  @ApiParam({
    name: 'trainingId',
    type: Number,
    description: 'ID of the coder training to update'
  })
  @ApiBody({
    description: 'New label for the coder training',
    schema: {
      type: 'object',
      properties: {
        label: {
          type: 'string',
          description: 'New label for the coder training'
        }
      },
      required: ['label']
    }
  })
  @ApiOkResponse({
    description: 'Coder training label updated successfully.',
    schema: {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the update was successful'
        },
        message: { type: 'string', description: 'Result message' }
      }
    }
  })
  async updateCoderTrainingLabel(
    @WorkspaceId() workspace_id: number,
      @Param('trainingId') trainingId: number,
      @Body() body: { label: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!trainingId || trainingId <= 0) {
      throw new Error('Valid training ID must be provided');
    }

    if (!body.label || body.label.trim().length === 0) {
      throw new Error('Valid label must be provided');
    }

    return this.coderTrainingService.updateCoderTrainingLabel(
      workspace_id,
      trainingId,
      body.label.trim()
    );
  }
}
