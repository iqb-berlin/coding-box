import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { Job } from 'bullmq';
import * as fs from 'fs/promises';
import * as path from 'path';
import { JobQueueService, WorkspaceDeletionJob } from '../../../job-queue/job-queue.service';
import { requireJobId } from '../../../job-queue/job-queue.util';
import { CacheService } from '../../../cache/cache.service';
import ResourcePackage from '../../entities/resource-package.entity';
import { withResourcePackageLock } from '../shared/resource-package-lock.util';

interface CleanupManifest {
  jobs: { queueName: string; id: string }[];
  packageNames: string[];
  filePaths: string[];
  cacheKeys: string[];
}

export interface WorkspaceDeletionResources extends CleanupManifest {
  workspaceIds: number[];
}

@Injectable()
export class WorkspaceDeletionService {
  constructor(
    private readonly connection: DataSource,
    private readonly jobQueueService: JobQueueService,
    private readonly cacheService: CacheService
  ) {}

  async prepare(ids: number[]): Promise<WorkspaceDeletionResources> {
    const combined: WorkspaceDeletionResources = {
      workspaceIds: ids, jobs: [], packageNames: [], filePaths: [], cacheKeys: []
    };
    const jobs = await this.jobQueueService.getJobsForWorkspaceDeletion(ids);
    const packages = await this.connection.getRepository(ResourcePackage).find({
      select: ['name', 'workspaceId'], where: { workspaceId: In(ids), scope: 'workspace' }
    });
    // Keep each durable manifest scoped to one workspace, even when a failed
    // multi-workspace request is later retried for only a subset of its IDs.
    for (const id of ids) {
      const resources = await this.prepareOne(id, jobs.filter(job => job.workspaceId === id), packages.filter(p => p.workspaceId === id).map(p => p.name));
      combined.jobs.push(...resources.jobs);
      combined.packageNames.push(...resources.packageNames);
      combined.filePaths.push(...resources.filePaths);
      combined.cacheKeys.push(...resources.cacheKeys);
    }
    return combined;
  }

  private async prepareOne(id: number, jobs: WorkspaceDeletionJob[], packageNames: string[]): Promise<WorkspaceDeletionResources> {
    const resources: WorkspaceDeletionResources = {
      workspaceIds: [id], jobs: [], packageNames, filePaths: [], cacheKeys: []
    };
    try {
      const previous = JSON.parse(await fs.readFile(this.manifestPath(id), 'utf8')) as CleanupManifest;
      resources.jobs.push(...previous.jobs);
      resources.packageNames.push(...previous.packageNames);
      resources.filePaths.push(...previous.filePaths);
      resources.cacheKeys.push(...previous.cacheKeys);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const job of jobs) {
      resources.jobs.push({ queueName: job.queueName, id: requireJobId(job) });
      // Queue IDs are unique only within each queue. Never touch another queue's result keys.
      const keys = this.resultKeys(job);
      resources.cacheKeys.push(...keys);
      const artifacts = [job.returnvalue as unknown, ...await Promise.all(keys.map(key => this.cacheService.getStrict<unknown>(key)))];
      for (const artifact of artifacts) {
        if (artifact && typeof artifact === 'object' && 'filePath' in artifact && typeof artifact.filePath === 'string') {
          resources.filePaths.push(artifact.filePath);
        }
      }
      if (Array.isArray(job.data.workspaceArtifactPaths)) {
        resources.filePaths.push(...job.data.workspaceArtifactPaths.filter((file: unknown): file is string => typeof file === 'string'));
      }
      if (typeof job.data.tempFilePath === 'string') resources.filePaths.push(job.data.tempFilePath);
      if (typeof job.data.file?.path === 'string') resources.filePaths.push(job.data.file.path);
    }
    resources.jobs = [...new Map(resources.jobs.map(job => [`${job.queueName}:${job.id}`, job])).values()];
    resources.packageNames = [...new Set(resources.packageNames)];
    resources.filePaths = [...new Set(resources.filePaths)];
    resources.cacheKeys = [...new Set(resources.cacheKeys)];
    // Persist before deleting ownership records. Retries can finish cleanup even after
    // a process crash, removed queue entries, or a filesystem/Redis failure after commit.
    const file = this.manifestPath(id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, JSON.stringify(resources), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
    return resources;
  }

  async cleanup(resources: WorkspaceDeletionResources): Promise<void> {
    for (const descriptor of resources.jobs) {
      const job = await this.jobQueueService.getJobForWorkspaceDeletionCleanup(descriptor.queueName, descriptor.id);
      if (!job) continue;
      // An active job here has not acquired its shared lifecycle lock yet.
      // It will fail its existence check after the exclusive deletion lock releases.
      if (await job.getState() !== 'active') {
        try {
          await job.remove();
        } catch (error) {
          if (await job.getState() !== 'active') throw error;
        }
      }
    }
    for (const file of resources.filePaths) await this.removeTempFile(file);
    const deleted = await Promise.all(resources.cacheKeys.map(key => this.cacheService.delete(key)));
    if (deleted.some(success => !success)) throw new Error('Workspace cleanup could not delete cached export metadata.');
    for (const name of resources.packageNames) {
      await withResourcePackageLock(this.connection, name, async () => {
        const remaining = await this.connection.getRepository(ResourcePackage)
          .createQueryBuilder('p').where('LOWER(p.name) = LOWER(:name)', { name }).getCount();
        if (remaining === 0 && name === path.basename(name) && name !== '.' && name !== '..') {
          await fs.rm(path.join(process.cwd(), 'packages', name), { recursive: true, force: true });
        }
      });
    }
    for (const id of resources.workspaceIds) await fs.rm(this.manifestPath(id), { force: true });
  }

  private resultKeys(job: Pick<Job, 'id' | 'queueName'>): string[] {
    if (job.queueName === 'data-export') {
      return [`export-result:${job.id}`, `item-matrix-incomplete-result:${job.id}`, `item-matrix-diagnostics:${job.id}`];
    }
    if (job.queueName === 'external-coding-import') return [`external-coding-import-result:${job.id}`];
    return job.queueName === 'codebook-generation' ? [`codebook-result:${job.id}`] : [];
  }

  private manifestPath(id: number): string {
    return path.join(process.cwd(), 'temp', 'workspace-deletion', `${id}.json`);
  }

  private async removeTempFile(filePath: string): Promise<void> {
    const roots = [path.resolve(process.cwd(), 'temp'), path.resolve('/tmp/external-coding-import'), path.resolve('/tmp/chunked-uploads')];
    const resolved = path.resolve(filePath);
    if (roots.some(root => resolved.startsWith(`${root}${path.sep}`))) await fs.rm(resolved, { force: true });
  }
}
