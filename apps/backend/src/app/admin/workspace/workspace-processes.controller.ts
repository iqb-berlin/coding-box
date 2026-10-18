import {
  Controller,
  Get,
  Delete,
  Param,
  UseGuards,
  ParseIntPipe
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
@RequireAccessLevel(3)
@Controller('admin/workspace/:workspace_id/processes')
export class WorkspaceProcessesController {
  constructor(private readonly jobQueueService: JobQueueService) {}

  @Get()
  @ApiOperation({ summary: 'Get all processes for a workspace' })
  @ApiParam({
    name: 'workspace_id', required: true, description: 'Workspace ID', type: Number
  })
  async getProcesses(@Param('workspace_id', ParseIntPipe) wsId: number): Promise<ProcessDto[]> {
    return this.jobQueueService.getAllWorkspaceJobs(wsId);
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
    return this.jobQueueService.cancelWorkspaceJob(wsId, queueName, id);
  }
}
