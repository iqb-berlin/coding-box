import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { CodingStatistics } from '../../database/services/shared-types';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingJobService } from '../../database/services/coding-job.service';
import { CodingProcessService } from '../../database/services/coding-process.service';
import { CodingResponseQueryService } from '../../database/services/coding-response-query.service';
import { ResponseEntity } from '../../database/entities/response.entity';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingController {
  constructor(
    private codingProcessService: CodingProcessService,
    private codingResponseQueryService: CodingResponseQueryService,
    private codingJobService: CodingJobService
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
    return this.codingProcessService.codeTestPersons(
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
    return this.codingResponseQueryService.getManualTestPersons(
      workspace_id,
      testPersons
    );
  }

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

    return this.codingResponseQueryService.getResponsesByStatus(
      workspace_id,
      status,
      version,
      validPage,
      validLimit
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
}
