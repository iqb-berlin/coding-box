import {
  Controller, Get, Delete, Param, UseGuards, ParseIntPipe, InternalServerErrorException
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiParam
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { WorkspaceGuard } from './workspace.guard';
import { AccessLevelGuard, RequireAccessLevel } from './access-level.guard';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { ProcessDto } from '../../../../../../api-dto/workspaces/process-dto';

@ApiTags('Workspace Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard, AccessLevelGuard)
@RequireAccessLevel(1)
@Controller('admin/workspace/:workspace_id/processes')
export class WorkspaceProcessesController {
  constructor(private readonly jobQueueService: JobQueueService) {}

  @Get()
  @ApiOperation({ summary: 'Get all processes for a workspace' })
  @ApiParam({
    name: 'workspace_id', required: true, description: 'Workspace ID', type: Number
  })
  async getProcesses(@Param('workspace_id', ParseIntPipe) wsId: number): Promise<ProcessDto[]> {
    try {
      return await this.jobQueueService.getAllWorkspaceJobs(wsId);
    } catch (e) {
      throw new InternalServerErrorException(e.message);
    }
  }

  @Delete(':queueName/:id')
  @ApiOperation({ summary: 'Cancel or delete a process' })
  @ApiParam({
    name: 'workspace_id', required: true, description: 'Workspace ID', type: Number
  })
  @ApiParam({ name: 'queueName', required: true })
  @ApiParam({ name: 'id', required: true })
  async deleteProcess(
    @Param('workspace_id', ParseIntPipe) wsId: number,
      @Param('queueName') queueName: string,
      @Param('id') id: string
  ): Promise<boolean> {
    try {
      return await this.jobQueueService.cancelJob(queueName, id);
    } catch (e) {
      throw new InternalServerErrorException(e.message);
    }
  }
}
