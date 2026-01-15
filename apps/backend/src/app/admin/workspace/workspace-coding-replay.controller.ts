import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  UseGuards
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceId } from './workspace.decorator';
import { CodingReplayService } from '../../database/services/coding-replay.service';

@ApiTags('Admin Workspace Coding')
@Controller('admin/workspace')
export class WorkspaceCodingReplayController {
  constructor(
    private codingReplayService: CodingReplayService
  ) { }

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
    return this.codingReplayService.generateReplayUrlForResponse(
      workspace_id,
      responseId,
      serverUrl,
      authToken
    );
  }
}
