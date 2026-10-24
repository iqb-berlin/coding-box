import { WorkerHost } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Job, UnrecoverableError } from 'bullmq';
import { withWorkspaceJobLock } from '../database/services/shared/workspace-lifecycle-lock.util';

/** Protects the complete processing/publication lifetime, across API and worker replicas. */
export abstract class WorkspaceWorkerHost extends WorkerHost {
  @InjectDataSource()
  private readonly workspaceJobDataSource!: DataSource;

  protected isSystemJob(job: Job): boolean {
    return job.queueName === 'database-export' && job.data.scope !== 'workspace';
  }

  async process(job: Job): Promise<unknown> {
    if (this.isSystemJob(job)) return this.processWorkspaceJob(job);
    let workspaceId = Number(job.data.workspaceId);
    if (job.queueName === 'validation-task') {
      const tasks = await this.workspaceJobDataSource.query(
        'SELECT workspace_id FROM public.job WHERE id = $1 AND type = $2',
        [job.data.taskId, 'validation-task']
      ) as { workspace_id: number }[];
      if (!tasks[0]) throw new UnrecoverableError('The validation task no longer exists.');
      workspaceId = tasks[0].workspace_id;
    }
    return withWorkspaceJobLock(this.workspaceJobDataSource, workspaceId, () => this.processWorkspaceJob(job));
  }

  abstract processWorkspaceJob(job: Job): Promise<unknown>;
}
