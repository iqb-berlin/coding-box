import {
  Injectable,
  Logger,
  ConflictException
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Queue, JobsOptions, Job, JobType
} from 'bullmq';
import { requireJobId, withQueueJobId } from './job-queue.util';
import { getErrorMessage, getErrorStack } from '../utils/error.util';
import { FileIo } from '../admin/workspace/file-io.interface';
import { ValidationTask } from '../database/entities/validation-task.entity';
import { ProcessDto } from '../../../../../api-dto/workspaces/process-dto';
import {
  CodebookExportFormat,
  CodebookTrainingRequirementFilter
} from '../../../../../api-dto/coding/codebook-content-setting';
import { BackgroundExportRequest } from '../../../../../api-dto/coding/export-request.dto';
import { AutoCoderRun, requireAutoCoderRun } from './auto-coder-run.util';

/** Retain only cleanup pointers, never uploaded buffers or analysis result payloads. */
export interface WorkspaceDeletionJob {
  workspaceId: number;
  id: string;
  queueName: string;
  data: {
    tempFilePath?: string;
    file?: { path: string };
    workspaceArtifactPaths?: string[];
  };
  returnvalue?: { filePath: string };
}

type ProcessOverviewValidationTask = Pick<
  ValidationTask,
|
'id' | 'workspace_id' | 'validation_type' | 'status' | 'progress' | 'progress_message' | 'error'
>;

export type QueuedUploadFile = Omit<FileIo, 'buffer'> & { buffer?: Buffer };

export interface TestResultsUploadJobData {
  workspaceId: number;
  requestedByUserId?: number;
  file: QueuedUploadFile;
  resultType: 'logs' | 'responses';
  overwriteExisting: boolean;
  personMatchMode?: 'strict' | 'loose';
  overwriteMode?: 'skip' | 'merge' | 'replace';
  scope?: 'person' | 'workspace' | 'group' | 'booklet' | 'unit' | 'response';
  scopeFilters?: { groupName?: string; bookletName?: string; unitNameOrAlias?: string; variableId?: string; subform?: string; };
}

export interface TestPersonCodingJobData {
  workspaceId: number;
  personIds: string[];
  unitIds?: number[];
  groupNames?: string;
  isPaused?: boolean;
  skipRetries?: boolean;
  autoCoderRun: AutoCoderRun;
  source?: 'manual-selection' | 'coding-freshness';
  freshnessVersion?: 'v1' | 'v3';
  freshnessStates?: ('PENDING' | 'STALE')[];
  freshnessSourceRevision?: number;
}

export interface FlatResponseFilterOptionsJobData {
  workspaceId: number;
  processingDurationThresholdMs: number;
}

export interface CodebookGenerationJobData {
  workspaceId: number;
  missingsProfile: number;
  contentOptions: {
    exportFormat: CodebookExportFormat;
    missingsProfile: string;
    hasOnlyManualCoding: boolean;
    hasGeneralInstructions: boolean;
    hasDerivedVars: boolean;
    hasOnlyVarsWithCodes: boolean;
    hasClosedVars: boolean;
    codeLabelToUpper: boolean;
    showScore: boolean;
    hideItemVarRelation: boolean;
    trainingRequirement?: CodebookTrainingRequirementFilter;
    jobDefinitionId?: number | null;
    variableBundleIds?: number[];
  };
  unitIds: number[];
}

export interface CodebookJobResult {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  workspaceId: number;
  exportFormat: CodebookExportFormat;
  createdAt: number;
}

export interface ResetCodingVersionJobData {
  workspaceId: number;
  requestedByUserId?: number | string;
  version: 'v1' | 'v2' | 'v3';
  unitFilters?: string[];
  variableFilters?: string[];
}

export interface ValidationTaskJobData {
  taskId: number;
}

export interface CodingStatisticsJobData {
  workspaceId: number;
  version?: 'v1' | 'v2' | 'v3';
}

export interface CodingAnalysisJobData {
  workspaceId: number;
  matchingFlags: string[]; // passed as string array, converted in processor if needed or kept as is
  threshold: number;
  cacheKey: string;
  runId?: string;
}

export interface VariableAnalysisJobData {
  skipRetries?: boolean;
  workspaceId: number;
  unitId?: number;
  variableId?: string;
  cacheKey?: string;
}

export interface VariableAnalysisJobResult {
  cacheKey: string;
  workspaceId: number;
  total: number;
  storage: 'chunked';
  variableComboChunks: number;
  frequencyChunks: number;
  storedAt: string;
}

export interface VariableAnalysisResultCacheManifest {
  storage: 'chunked';
  workspaceId: number;
  total: number;
  variableComboChunks: number;
  frequencyChunks: number;
  storedAt: string;
}

export interface ExternalCodingImportJobData {
  workspaceId: number;
  requestedByUserId: number;
  tempFilePath: string;
  fileName: string;
  sourceFormat?: 'external-coding' | 'coding-list' | 'coding-results';
  sourceVersion?: 'v1' | 'v2' | 'v3';
  scoreMode?: 'import' | 'derive';
  existingCodingMode?: 'skip-conflicts' | 'fill-empty' | 'overwrite';
}

export interface DatabaseExportJobData {
  workspaceArtifactPaths?: string[];
  requestedByUserId: number;
  scope?: 'system' | 'workspace';
  workspaceId?: number;
  isCancelled?: boolean;
}

export type ExportJobData = BackgroundExportRequest & {
  workspaceId: number;
  userId: number;
  isCancelled?: boolean;
};

export type ExportJobProgressPhase = 'preparing'
| 'counting'
| 'writing'
| 'finalizing'
| 'completed';

export interface ExportJobProgress {
  percentage: number;
  phase?: ExportJobProgressPhase;
  processedRows?: number;
  totalRows?: number;
  message?: string;
}

export interface ExportJobResult {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  workspaceId: number;
  userId: number;
  exportType: string;
  createdAt: number;
}

export interface RedisConnectionStatus {
  connected: boolean;
  message: string;
  details?: {
    pingLatency?: number;
    queueStatus?: {
      name: string;
      isReady: boolean;
      jobCounts?: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        paused: number;
      };
    };
  };
}

@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);

  private readonly exportCancellationControllers = new Map<string, AbortController>();

  private readonly DEPENDENCY_RULES: ReadonlyArray<{
    target: string;
    blockedBy: string;
    label: string;
  }> = [
      { target: 'test-results-upload', blockedBy: 'validation-task', label: 'validation' },
      { target: 'test-results-upload', blockedBy: 'test-person-coding', label: 'auto-coding' },
      { target: 'test-results-upload', blockedBy: 'reset-coding-version', label: 'reset coding version' },
      { target: 'test-results-upload', blockedBy: 'external-coding-import', label: 'external coding import' },
      { target: 'test-person-coding', blockedBy: 'test-results-upload', label: 'test results upload' },
      { target: 'test-person-coding', blockedBy: 'reset-coding-version', label: 'reset coding version' },
      { target: 'test-person-coding', blockedBy: 'external-coding-import', label: 'external coding import' },
      { target: 'validation-task', blockedBy: 'test-person-coding', label: 'auto-coding' },
      { target: 'validation-task', blockedBy: 'test-results-upload', label: 'test results upload' },
      { target: 'validation-task', blockedBy: 'reset-coding-version', label: 'reset coding version' },
      { target: 'coding-statistics', blockedBy: 'test-person-coding', label: 'auto-coding' },
      { target: 'coding-statistics', blockedBy: 'external-coding-import', label: 'external coding import' },
      { target: 'data-export', blockedBy: 'test-person-coding', label: 'auto-coding' },
      { target: 'reset-coding-version', blockedBy: 'test-person-coding', label: 'auto-coding' },
      { target: 'reset-coding-version', blockedBy: 'external-coding-import', label: 'external coding import' },
      { target: 'external-coding-import', blockedBy: 'test-person-coding', label: 'auto-coding' },
      { target: 'external-coding-import', blockedBy: 'test-results-upload', label: 'test results upload' },
      { target: 'external-coding-import', blockedBy: 'reset-coding-version', label: 'reset coding version' }
    ];

  constructor(
    @InjectQueue('test-person-coding') private testPersonCodingQueue: Queue,
    @InjectQueue('coding-statistics') private codingStatisticsQueue: Queue,
    @InjectQueue('data-export') private dataExportQueue: Queue,
    @InjectQueue('flat-response-filter-options')
    private flatResponseFilterOptionsQueue: Queue,
    @InjectQueue('test-results-upload') private testResultsUploadQueue: Queue,
    @InjectQueue('codebook-generation') private codebookGenerationQueue: Queue,
    @InjectQueue('reset-coding-version') private resetCodingVersionQueue: Queue,
    @InjectQueue('validation-task') private validationTaskQueue: Queue,
    @InjectQueue('response-analysis') private responseAnalysisQueue: Queue,
    @InjectQueue('variable-analysis') private variableAnalysisQueue: Queue,
    @InjectQueue('external-coding-import') private externalCodingImportQueue: Queue,
    @InjectQueue('database-export') private databaseExportQueue: Queue<DatabaseExportJobData>,
    @InjectRepository(ValidationTask)
    private readonly validationTaskRepository: Repository<ValidationTask>
  ) { }

  private getQueue(name: string): Queue | undefined {
    return this.getAllQueues().get(name);
  }

  private getAllQueues(): Map<string, Queue> {
    return new Map([
      ['test-person-coding', this.testPersonCodingQueue],
      ['coding-statistics', this.codingStatisticsQueue],
      ['data-export', this.dataExportQueue],
      ['flat-response-filter-options', this.flatResponseFilterOptionsQueue],
      ['test-results-upload', this.testResultsUploadQueue],
      ['codebook-generation', this.codebookGenerationQueue],
      ['reset-coding-version', this.resetCodingVersionQueue],
      ['validation-task', this.validationTaskQueue],
      ['response-analysis', this.responseAnalysisQueue],
      ['variable-analysis', this.variableAnalysisQueue],
      ['external-coding-import', this.externalCodingImportQueue],
      ['database-export', this.databaseExportQueue]
    ]);
  }

  private jobMatchesWorkspace(
    job: Pick<Job, 'data'> | null | undefined,
    workspaceId: number
  ): boolean {
    const jobWorkspaceId = Number(
      (job?.data as { workspaceId?: unknown } | undefined)?.workspaceId
    );
    const requestedWorkspaceId = Number(workspaceId);
    return Number.isSafeInteger(requestedWorkspaceId) && requestedWorkspaceId > 0 &&
      Number.isSafeInteger(jobWorkspaceId) && jobWorkspaceId === requestedWorkspaceId;
  }

  async getWorkspaceJob<T = Record<string, unknown>>(
    workspaceId: number,
    queueName: string,
    jobId: string
  ): Promise<Job<T> | null> {
    if (!Number.isSafeInteger(workspaceId) || workspaceId < 1) return null;
    const queue = this.getQueue(queueName);
    if (!queue) return null;
    const job = await queue.getJob(jobId);
    if (!job || !await this.jobBelongsToWorkspace(queueName, job, workspaceId)) return null;
    return job as Job<T>;
  }

  async getJobForWorkspaceDeletionCleanup(queueName: string, jobId: string): Promise<Job | undefined> {
    return this.getQueue(queueName)?.getJob(jobId);
  }

  /** Snapshot before deleting validation-task rows, so legacy task-only payloads remain attributable. */
  async getJobsForWorkspaceDeletion(workspaceIds: number[]): Promise<WorkspaceDeletionJob[]> {
    const result: WorkspaceDeletionJob[] = [];
    const requestedIds = new Set(workspaceIds);
    const states: JobType[] = ['active', 'waiting', 'prioritized', 'delayed', 'waiting-children', 'completed', 'failed'];
    for (const [name, queue] of this.getAllQueues()) {
      const seen = new Set<string>();
      // Upload jobs can contain entire files; keep at most one such payload in a page.
      const pageSize = name === 'test-results-upload' ? 1 : 25;
      for (const state of states) {
        for (let start = 0; ; start += pageSize) {
          const page = await queue.getJobs([state], start, start + pageSize - 1);
          if (page.length === 0) break;
          const jobs = page.filter(job => job && !seen.has(requireJobId(job)));
          let taskOwners = new Map<number, number>();
          if (name === 'validation-task') {
            const taskIds = [...new Set(jobs.map(job => Number(job.data?.taskId)).filter(id => Number.isSafeInteger(id) && id > 0))];
            if (taskIds.length > 0) {
              const tasks = await this.validationTaskRepository.find({ where: { id: In(taskIds) }, select: ['id', 'workspace_id'] });
              taskOwners = new Map(tasks.map(task => [Number(task.id), Number(task.workspace_id)]));
            }
          }
          for (const job of jobs) {
            if (name === 'database-export' && job.data?.scope !== 'workspace') continue;
            const owner = name === 'validation-task' ? taskOwners.get(Number(job.data?.taskId)) : Number(job.data?.workspaceId);
            if (owner !== undefined && requestedIds.has(owner)) {
              seen.add(requireJobId(job));
              result.push(this.snapshotForWorkspaceDeletion(name, job, owner));
            }
          }
        }
      }
    }
    return result;
  }

  private snapshotForWorkspaceDeletion(queueName: string, job: Job, workspaceId: number): WorkspaceDeletionJob {
    return {
      workspaceId,
      id: requireJobId(job),
      queueName,
      data: {
        tempFilePath: typeof job.data.tempFilePath === 'string' ? job.data.tempFilePath : undefined,
        file: typeof job.data.file?.path === 'string' ? { path: job.data.file.path } : undefined,
        workspaceArtifactPaths: Array.isArray(job.data.workspaceArtifactPaths) ?
          job.data.workspaceArtifactPaths.filter((file: unknown): file is string => typeof file === 'string') : undefined
      },
      returnvalue: typeof job.returnvalue?.filePath === 'string' ? { filePath: job.returnvalue.filePath } : undefined
    };
  }

  private normalizeCodingStatisticsVersion(
    version?: 'v1' | 'v2' | 'v3'
  ): 'v1' | 'v2' | 'v3' {
    return version || 'v1';
  }

  private mapBullStateToProcessStatus(state: string): ProcessDto['status'] {
    if (state === 'prioritized' || state === 'waiting-children') return 'waiting';
    if (
      state === 'active' ||
      state === 'waiting' ||
      state === 'delayed' ||
      state === 'completed' ||
      state === 'failed' ||
      state === 'paused' ||
      state === 'cancelled'
    ) {
      return state;
    }

    return 'unknown';
  }

  private mapValidationTaskStatus(
    status: string | undefined,
    fallbackBullState: string
  ): ProcessDto['status'] {
    if (fallbackBullState === 'active') return 'active';
    if (status === 'pending') return 'waiting';
    if (status === 'processing') return 'active';
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'paused') return 'paused';
    if (status === 'cancelled') return 'cancelled';

    return this.mapBullStateToProcessStatus(fallbackBullState);
  }

  private getProcessOverviewStatus(
    queueName: string,
    bullState: string,
    jobData: unknown,
    validationTask?: ProcessOverviewValidationTask
  ): ProcessDto['status'] {
    if (queueName === 'validation-task') {
      return this.mapValidationTaskStatus(validationTask?.status, bullState);
    }

    if (
      queueName === 'test-person-coding' &&
      bullState === 'completed' &&
      jobData &&
      typeof jobData === 'object' &&
      (jobData as { isPaused?: unknown }).isPaused === true
    ) {
      return 'paused';
    }

    return this.mapBullStateToProcessStatus(bullState);
  }

  private getProcessFailedReason(
    status: ProcessDto['status'],
    job: Job,
    validationTask?: ProcessOverviewValidationTask
  ): string | undefined {
    if (status !== 'failed') return undefined;
    return validationTask?.error || job.failedReason;
  }

  private async jobBelongsToWorkspace(
    queueName: string,
    job: Job,
    workspaceId: number
  ): Promise<boolean> {
    if (queueName === 'validation-task') {
      const taskId = Number((job.data as ValidationTaskJobData | undefined)?.taskId);
      if (!taskId) return false;

      const tasks = await this.validationTaskRepository.find({
        where: { id: In([taskId]) },
        select: ['id', 'workspace_id']
      });
      return tasks.some(task => Number(task.workspace_id) === Number(workspaceId));
    }

    return this.jobMatchesWorkspace(job, workspaceId);
  }

  private async cancelKnownJob(queueName: string, job: Job): Promise<boolean> {
    try {
      const state = await job.getState();
      const removableStates = ['waiting', 'prioritized', 'delayed', 'paused', 'completed', 'failed', 'cancelled'];
      if (removableStates.includes(state)) {
        await job.remove();
        return true;
      }

      if (state === 'active') {
        if (queueName === 'data-export' || queueName === 'database-export') {
          await job.updateData({ ...job.data, isCancelled: true });
          if (queueName === 'data-export') {
            this.abortExportJob(requireJobId(job));
          }
          return true;
        }

        if (queueName === 'test-person-coding') {
          await job.updateData({ ...job.data, isPaused: true });
          return true;
        }

        return false;
      }

      return false;
    } catch {
      return false;
    }
  }

  async cancelJob(queueName: string, jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, queueName, jobId);
    if (!job) return false;

    return this.cancelKnownJob(queueName, job);
  }

  async cancelWorkspaceJob(workspaceId: number, queueName: string, jobId: string): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, queueName, jobId);
    if (!job) return false;

    return this.cancelKnownJob(queueName, job);
  }

  async deleteJob(queueName: string, jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, queueName, jobId);
    if (!job) return false;

    try {
      await job.remove();
      return true;
    } catch {
      return false;
    }
  }

  async getAllWorkspaceJobs(workspaceId: number): Promise<ProcessDto[]> {
    const queues = this.getAllQueues();
    const processPromises: Promise<ProcessDto[]>[] = [];

    for (const [queueName, queue] of queues.entries()) {
      processPromises.push(
        queue.getJobs(['active', 'waiting', 'prioritized', 'delayed', 'completed', 'failed']).then(async jobs => {
          const existingJobs = jobs.filter(Boolean);
          const isQueuePaused = existingJobs.length > 0 && await queue.isPaused();
          let matchedJobs = existingJobs;
          let validationTaskMap = new Map<number, ProcessOverviewValidationTask>();
          if (queueName === 'validation-task') {
            const taskIds = existingJobs.map(j => j.data?.taskId as number).filter(Boolean);
            if (taskIds.length === 0) return [];
            const tasks = (await this.validationTaskRepository.find({
              where: { id: In(taskIds) },
              select: [
                'id',
                'workspace_id',
                'validation_type',
                'status',
                'progress',
                'progress_message',
                'error'
              ]
            })) as ProcessOverviewValidationTask[];
            validationTaskMap = new Map(tasks.map(t => [Number(t.id), t]));
            matchedJobs = existingJobs.filter(j => Number(validationTaskMap.get(Number(j.data?.taskId))?.workspace_id) === Number(workspaceId)
            );
          } else {
            matchedJobs = existingJobs.filter(j => this.jobMatchesWorkspace(j, workspaceId));
          }

          const mappedPromises = matchedJobs.map(async job => {
            const state = await job.getState();
            const bullState = isQueuePaused && (state === 'waiting' || state === 'prioritized') ? 'paused' : state;
            const validationTask = queueName === 'validation-task' ?
              validationTaskMap.get(Number(job.data?.taskId)) :
              undefined;
            const status = this.getProcessOverviewStatus(
              queueName,
              bullState,
              job.data,
              validationTask
            );
            let progress: unknown = typeof validationTask?.progress === 'number' ?
              validationTask.progress :
              job.progress;

            // For completed jobs, ensure progress shows as 100% if it's numeric/empty
            if (status === 'completed') {
              if (typeof progress !== 'object' || progress === null) {
                progress = 100;
              }
            } else if (progress === undefined || progress === null) {
              progress = 0;
            }

            return {
              id: requireJobId(job),
              queueName: queueName,
              status: status,
              progress: progress,
              data: this.sanitizeJobData({
                ...job.data,
                validationType: validationTask?.validation_type,
                progressMessage: validationTask?.progress_message
              }),
              failedReason: this.getProcessFailedReason(status, job, validationTask),
              timestamp: job.timestamp,
              processedOn: job.processedOn,
              finishedOn: job.finishedOn
            } as ProcessDto;
          });
          return Promise.all(mappedPromises);
        })
      );
    }

    const results = await Promise.all(processPromises);
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }

  private sanitizeJobData(data: unknown): Record<string, unknown> | undefined {
    if (!data || typeof data !== 'object') return undefined;

    const source = data as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    const scalarKeys = [
      'workspaceId',
      'taskId',
      'resultType',
      'overwriteExisting',
      'personMatchMode',
      'overwriteMode',
      'scope',
      'exportType',
      'version',
      'format',
      'source',
      'autoCoderRun',
      'freshnessVersion',
      'processingDurationThresholdMs',
      'missingsProfile',
      'unitId',
      'variableId',
      'fileName',
      'sourceFormat',
      'sourceVersion',
      'scoreMode',
      'existingCodingMode',
      'validationType',
      'progressMessage',
      'isPaused',
      'isCancelled'
    ];

    scalarKeys.forEach(key => {
      const value = source[key];
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        sanitized[key] = value;
      }
    });

    const file = source.file as { originalname?: unknown } | undefined;
    if (file && typeof file.originalname === 'string') {
      sanitized.fileName = file.originalname;
    }

    [
      ['personIds', 'personCount'],
      ['unitIds', 'unitCount'],
      ['groupNames', 'groupCount'],
      ['jobDefinitionIds', 'jobDefinitionCount'],
      ['coderTrainingIds', 'coderTrainingCount'],
      ['coderIds', 'coderCount'],
      ['matchingFlags', 'matchingFlagCount']
    ].forEach(([sourceKey, targetKey]) => {
      const value = source[sourceKey];
      if (Array.isArray(value)) {
        sanitized[targetKey] = value.length;
      }
    });

    return Object.keys(sanitized).length ? sanitized : undefined;
  }

  private async hasActiveJobForWorkspace(
    queueName: string,
    workspaceId: number
  ): Promise<Job | undefined> {
    const queue = this.getQueue(queueName);
    if (!queue) return undefined;
    const jobs = (await queue.getJobs(['active', 'waiting', 'prioritized', 'delayed'])).filter(Boolean);

    if (queueName === 'validation-task') {
      const taskIds = jobs.map(j => j.data?.taskId as number).filter(Boolean);
      if (taskIds.length === 0) return undefined;
      const tasks = await this.validationTaskRepository.find({
        where: { id: In(taskIds) },
        select: ['id', 'workspace_id']
      });
      const taskWorkspaceMap = new Map(tasks.map(t => [t.id, t.workspace_id]));
      return jobs.find(j => taskWorkspaceMap.get(j.data?.taskId) === workspaceId);
    }

    return jobs.find(j => this.jobMatchesWorkspace(j, workspaceId));
  }

  async assertNoDependencyConflicts(
    targetQueue: string,
    workspaceId: number
  ): Promise<void> {
    const rules = this.DEPENDENCY_RULES.filter(r => r.target === targetQueue);
    for (const rule of rules) {
      const blockingJob = await this.hasActiveJobForWorkspace(rule.blockedBy, workspaceId);
      if (blockingJob) {
        throw new ConflictException(
          `Cannot start: a ${rule.label} job is still active for this workspace (job ${blockingJob.id}). Please wait until it completes.`
        );
      }
    }
  }

  private async findActiveJob<T>(
    queue: Queue,
    matchFn: (data: T) => boolean
  ): Promise<Job<T> | undefined> {
    const jobs = (await queue.getJobs(['active', 'waiting', 'prioritized', 'delayed'])).filter(
      Boolean
    );
    return jobs.find(job => job.data && matchFn(job.data));
  }

  async addTestPersonCodingJob(
    data: TestPersonCodingJobData,
    options?: JobsOptions
  ): Promise<Job<TestPersonCodingJobData>> {
    const validatedData = {
      ...data,
      autoCoderRun: requireAutoCoderRun(data.autoCoderRun)
    };
    const existing = await this.findActiveJob<TestPersonCodingJobData>(
      this.testPersonCodingQueue,
      d => d.workspaceId === validatedData.workspaceId
    );
    if (existing) {
      throw new ConflictException(
        `A test person coding job is already running for workspace ${validatedData.workspaceId} (job ${existing.id})`
      );
    }
    this.logger.log(
      `Adding test person coding job for workspace ${validatedData.workspaceId}`
    );
    return this.testPersonCodingQueue.add('test-person-coding', validatedData, withQueueJobId(options));
  }

  async getTestPersonCodingJob(
    jobId: string
  ): Promise<Job<TestPersonCodingJobData> | null> {
    return (await this.testPersonCodingQueue.getJob(jobId)) ?? null;
  }

  async addCodingStatisticsJob(
    workspaceId: number,
    version?: 'v1' | 'v2' | 'v3',
    options?: JobsOptions
  ): Promise<Job<CodingStatisticsJobData>> {
    const requestedVersion = this.normalizeCodingStatisticsVersion(version);
    const existing = await this.findActiveJob<CodingStatisticsJobData>(
      this.codingStatisticsQueue,
      d => Number(d.workspaceId) === Number(workspaceId)
    );
    if (existing) {
      const existingVersion = this.normalizeCodingStatisticsVersion(
        existing.data?.version
      );
      if (existingVersion === requestedVersion) {
        this.logger.log(
          `Reusing coding statistics job ${existing.id} for workspace ${workspaceId} (version: ${requestedVersion})`
        );
        return existing;
      }
      throw new ConflictException(
        `A coding statistics job is already running for workspace ${workspaceId} ` +
        `(version: ${existingVersion}, job ${existing.id})`
      );
    }
    this.logger.log(
      `Adding coding statistics job for workspace ${workspaceId} (version: ${requestedVersion})`
    );
    return this.codingStatisticsQueue.add(
      'coding-statistics', { workspaceId, version: requestedVersion }, withQueueJobId(options)
    );
  }

  async getActiveCodingStatisticsJob(
    workspaceId: number,
    version?: 'v1' | 'v2' | 'v3'
  ): Promise<Job<CodingStatisticsJobData> | undefined> {
    const requestedVersion = this.normalizeCodingStatisticsVersion(version);
    return this.findActiveJob<CodingStatisticsJobData>(
      this.codingStatisticsQueue,
      d => Number(d.workspaceId) === Number(workspaceId) &&
        this.normalizeCodingStatisticsVersion(d.version) === requestedVersion
    );
  }

  async getCodingStatisticsJob(
    jobId: string
  ): Promise<Job<CodingStatisticsJobData> | null> {
    return (await this.codingStatisticsQueue.getJob(jobId)) ?? null;
  }

  async addFlatResponseFilterOptionsJob(
    workspaceId: number,
    processingDurationThresholdMs: number,
    options?: JobsOptions
  ): Promise<Job<FlatResponseFilterOptionsJobData> | null> {
    const existing = await this.findActiveJob<FlatResponseFilterOptionsJobData>(
      this.flatResponseFilterOptionsQueue,
      d => d.workspaceId === workspaceId
    );
    if (existing) {
      this.logger.debug(
        `Skipping flat-response-filter-options job for workspace ${workspaceId} — already queued (job ${existing.id})`
      );
      return null;
    }
    this.logger.log(
      `Adding flat response filter-options cache job for workspace ${workspaceId}`
    );
    return this.flatResponseFilterOptionsQueue.add(
      'flat-response-filter-options', {
        workspaceId,
        processingDurationThresholdMs
      }, withQueueJobId(options)
    );
  }

  async addUploadJob(
    data: TestResultsUploadJobData,
    options?: JobsOptions
  ): Promise<Job<TestResultsUploadJobData>> {
    this.logger.log(
      `Adding upload job for workspace ${data.workspaceId}, file: ${data.file.originalname}`
    );
    return this.testResultsUploadQueue.add('test-results-upload', data, withQueueJobId(options));
  }

  async assertNoActiveUploadForWorkspace(workspaceId: number): Promise<void> {
    const existing = await this.findActiveJob<TestResultsUploadJobData>(
      this.testResultsUploadQueue,
      d => d.workspaceId === workspaceId
    );
    if (existing) {
      throw new ConflictException(
        `An upload job is already running for workspace ${workspaceId} (job ${existing.id})`
      );
    }
  }

  async getUploadJob(jobId: string): Promise<Job<TestResultsUploadJobData> | null> {
    return (await this.testResultsUploadQueue.getJob(jobId)) ?? null;
  }

  async getTestPersonCodingJobs(
    workspaceId: number
  ): Promise<Job<TestPersonCodingJobData>[]> {
    this.logger.log(
      `Fetching all test person coding jobs for workspace ${workspaceId}`
    );
    const jobs = await this.testPersonCodingQueue.getJobs([
      'completed',
      'failed',
      'active',
      'waiting',
      'prioritized',
      'delayed'
    ]);
    this.logger.log(`Found ${jobs.length} jobs in total`);
    return jobs.filter(job => this.jobMatchesWorkspace(job, workspaceId));
  }

  async cancelTestPersonCodingJob(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'test-person-coding', jobId);
    if (!job) {
      this.logger.warn(`Job with ID ${jobId} not found`);
      return false;
    }

    try {
      const state = await job.getState();

      if (state === 'waiting' || state === 'prioritized' || state === 'delayed') {
        await job.remove();
        this.logger.log(
          `Job ${jobId} has been cancelled and removed from queue`
        );
        return true;
      }

      if (state === 'active') {
        await job.updateData({ ...job.data, skipRetries: true });
        this.logger.log(
          `Job ${jobId} is active, further retries disabled`
        );
        return true;
      }

      if (state === 'completed' || state === 'failed') {
        this.logger.log(`Job ${jobId} is already ${state}, no action needed`);
        return true;
      }

      // Fallback: try to remove
      await job.remove();
      this.logger.log(`Job ${jobId} has been cancelled`);
      return true;
    } catch (error) {
      this.logger.error(`Error cancelling job: ${getErrorMessage(error)}`, getErrorStack(error));
      return false;
    }
  }

  async deleteTestPersonCodingJob(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'test-person-coding', jobId);
    if (!job) {
      this.logger.warn(`Job with ID ${jobId} not found`);
      return false;
    }

    try {
      await job.remove();
      this.logger.log(`Job ${jobId} has been deleted`);
      return true;
    } catch (error) {
      this.logger.error(`Error deleting job: ${getErrorMessage(error)}`, getErrorStack(error));
      return false;
    }
  }

  async addExportJob(
    data: ExportJobData,
    options?: JobsOptions
  ): Promise<Job<ExportJobData>> {
    await this.assertNoDependencyConflicts('data-export', data.workspaceId);
    const existing = await this.findActiveJob<ExportJobData>(
      this.dataExportQueue,
      d => d.workspaceId === data.workspaceId && d.exportType === data.exportType
    );
    if (existing) {
      throw new ConflictException(
        `An export job of type '${data.exportType}' is already running for workspace ${data.workspaceId} (job ${existing.id})`
      );
    }
    this.logger.log(
      `Adding export job for workspace ${data.workspaceId}, type: ${data.exportType}`
    );
    return this.dataExportQueue.add('data-export', data, withQueueJobId(options));
  }

  async getExportJob(jobId: string): Promise<Job<ExportJobData> | null> {
    return (await this.dataExportQueue.getJob(jobId)) ?? null;
  }

  async getExportJobs(workspaceId: number): Promise<Job<ExportJobData>[]> {
    this.logger.log(`Fetching all export jobs for workspace ${workspaceId}`);
    const jobs = await this.dataExportQueue.getJobs([
      'completed',
      'failed',
      'active',
      'waiting',
      'prioritized',
      'delayed'
    ]);
    this.logger.log(`Found ${jobs.length} export jobs in total`);
    return jobs.filter(job => this.jobMatchesWorkspace(job, workspaceId));
  }

  createExportJobCancellationSignal(jobId: string): AbortSignal {
    const controller = new AbortController();
    this.exportCancellationControllers.set(jobId, controller);
    return controller.signal;
  }

  clearExportJobCancellationSignal(jobId: string): void {
    this.exportCancellationControllers.delete(jobId);
  }

  private abortExportJob(jobId: string): void {
    this.exportCancellationControllers.get(jobId)?.abort();
  }

  async cancelExportJob(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'data-export', jobId);
    if (!job) {
      this.logger.warn(`Export job with ID ${jobId} not found`);
      return false;
    }

    try {
      const state = await job.getState();

      // For waiting/delayed jobs, we can remove them directly
      if (state === 'waiting' || state === 'prioritized' || state === 'delayed') {
        await job.remove();
        this.logger.log(
          `Export job ${jobId} has been cancelled and removed from queue`
        );
        return true;
      }

      // For active jobs, we can't remove them - the processor will check the isCancelled flag
      // and handle cancellation. The worker suppresses retries for cancelled jobs.
      if (state === 'active') {
        await job.updateData({ ...job.data, isCancelled: true });
        this.abortExportJob(jobId);
        this.logger.log(
          `Export job ${jobId} is active, marked for cancellation (will stop at next checkpoint)`
        );
        return true;
      }

      // For completed/failed jobs, just log and return true
      if (state === 'completed' || state === 'failed') {
        this.logger.log(
          `Export job ${jobId} is already ${state}, no action needed`
        );
        return true;
      }

      // Fallback: try to remove
      await job.remove();
      this.logger.log(`Export job ${jobId} has been cancelled`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error cancelling export job: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async markExportJobCancelled(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'data-export', jobId);
    if (!job) {
      this.logger.warn(
        `Export job with ID ${jobId} not found for cancellation marking`
      );
      return false;
    }

    try {
      const updatedData = {
        ...job.data,
        isCancelled: true
      };
      await job.updateData(updatedData);
      this.abortExportJob(jobId);
      this.logger.log(`Export job ${jobId} has been marked as cancelled`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error marking export job as cancelled: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async isExportJobCancelled(jobId: string): Promise<boolean> {
    try {
      const job = await this.dataExportQueue.getJob(jobId);
      if (!job) {
        return false;
      }
      return job.data?.isCancelled === true;
    } catch (error) {
      this.logger.error(
        `Error checking export job cancellation: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async deleteExportJob(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'data-export', jobId);
    if (!job) {
      this.logger.warn(`Export job with ID ${jobId} not found`);
      return false;
    }

    try {
      await job.remove();
      this.logger.log(`Export job ${jobId} has been deleted`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error deleting export job: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async addCodebookGenerationJob(
    data: CodebookGenerationJobData,
    options?: JobsOptions
  ): Promise<Job<CodebookGenerationJobData>> {
    const existing = await this.findActiveJob<CodebookGenerationJobData>(
      this.codebookGenerationQueue,
      d => d.workspaceId === data.workspaceId
    );
    if (existing) {
      throw new ConflictException(
        `A codebook generation job is already running for workspace ${data.workspaceId} (job ${existing.id})`
      );
    }
    this.logger.log(
      `Adding codebook generation job for workspace ${data.workspaceId} with ${data.unitIds.length} units`
    );
    return this.codebookGenerationQueue.add('codebook-generation', data, withQueueJobId(options));
  }

  async getCodebookGenerationJob(
    jobId: string
  ): Promise<Job<CodebookGenerationJobData> | null> {
    return (await this.codebookGenerationQueue.getJob(jobId)) ?? null;
  }

  // --- Reset Coding Version Queue Methods ---

  async addResetCodingVersionJob(
    data: ResetCodingVersionJobData,
    options?: JobsOptions
  ): Promise<Job<ResetCodingVersionJobData>> {
    const existing = await this.findActiveJob<ResetCodingVersionJobData>(
      this.resetCodingVersionQueue,
      d => d.workspaceId === data.workspaceId
    );
    if (existing) {
      throw new ConflictException(
        `A reset coding version job is already running for workspace ${data.workspaceId} (job ${existing.id})`
      );
    }
    this.logger.log(
      `Adding reset coding version job for workspace ${data.workspaceId}, version ${data.version}`
    );
    return this.resetCodingVersionQueue.add('reset-coding-version', data, withQueueJobId(options));
  }

  async getResetCodingVersionJob(
    jobId: string
  ): Promise<Job<ResetCodingVersionJobData> | null> {
    return (await this.resetCodingVersionQueue.getJob(jobId)) ?? null;
  }

  async addValidationTaskJob(
    data: ValidationTaskJobData,
    options?: JobsOptions
  ): Promise<Job<ValidationTaskJobData>> {
    const existing = await this.findActiveJob<ValidationTaskJobData>(
      this.validationTaskQueue,
      d => d.taskId === data.taskId
    );
    if (existing) {
      throw new ConflictException(
        `A validation task job is already running for task ${data.taskId} (job ${existing.id})`
      );
    }
    this.logger.log(`Adding validation task job for task ${data.taskId}`);
    return this.validationTaskQueue.add('validation-task', data, withQueueJobId(options));
  }

  async getValidationTaskJob(
    jobId: string
  ): Promise<Job<ValidationTaskJobData> | null> {
    return (await this.validationTaskQueue.getJob(jobId)) ?? null;
  }

  async addCodingAnalysisJob(
    data: CodingAnalysisJobData,
    options?: JobsOptions
  ): Promise<Job<CodingAnalysisJobData>> {
    this.logger.log(
      `Adding coding analysis job for workspace ${data.workspaceId}`
    );
    return this.responseAnalysisQueue.add('response-analysis', data, withQueueJobId(options));
  }

  async getCodingAnalysisJob(
    jobId: string
  ): Promise<Job<CodingAnalysisJobData> | null> {
    return (await this.responseAnalysisQueue.getJob(jobId)) ?? null;
  }

  async getActiveCodingAnalysisJob(
    workspaceId: number
  ): Promise<Job<CodingAnalysisJobData> | null> {
    const jobs = await this.responseAnalysisQueue.getJobs([
      'active',
      'waiting',
      'prioritized',
      'delayed'
    ]);
    return (
      jobs.find(job => this.jobMatchesWorkspace(job, workspaceId)) || null
    );
  }

  async addVariableAnalysisJob(
    data: VariableAnalysisJobData,
    options?: JobsOptions
  ): Promise<Job<VariableAnalysisJobData>> {
    this.logger.log(
      `Adding variable analysis job for workspace ${data.workspaceId}`
    );
    return this.variableAnalysisQueue.add('variable-analysis', data, withQueueJobId({
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
      ...options
    }));
  }

  async getVariableAnalysisJob(
    jobId: string
  ): Promise<Job<VariableAnalysisJobData> | null> {
    return (await this.variableAnalysisQueue.getJob(jobId)) ?? null;
  }

  async getVariableAnalysisJobs(
    workspaceId: number
  ): Promise<Job<VariableAnalysisJobData>[]> {
    this.logger.log(
      `Fetching all variable analysis jobs for workspace ${workspaceId}`
    );
    const jobs = await this.variableAnalysisQueue.getJobs([
      'completed',
      'failed',
      'active',
      'waiting',
      'prioritized',
      'delayed'
    ]);
    return jobs.filter(job => this.jobMatchesWorkspace(job, workspaceId));
  }

  async deleteVariableAnalysisJob(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'variable-analysis', jobId);
    if (!job) {
      this.logger.warn(`Variable analysis job with ID ${jobId} not found`);
      return false;
    }
    try {
      await job.remove();
      this.logger.log(`Variable analysis job ${jobId} has been deleted`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error deleting variable analysis job: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async deleteVariableAnalysisJobs(workspaceId: number): Promise<void> {
    const jobs = await this.getVariableAnalysisJobs(workspaceId);
    this.logger.log(
      `Deleting all ${jobs.length} variable analysis jobs for workspace ${workspaceId}`
    );

    for (const job of jobs) {
      try {
        const state = await job.getState();
        if (state === 'active') {
          await job.updateData({ ...job.data, skipRetries: true });
          // Locked active jobs can finish, but a later failure must not retry them.
          await job.remove().catch(() => { });
        } else {
          await job.remove();
        }
      } catch (error) {
        this.logger.warn(
          `Failed to remove variable analysis job ${job.id}: ${getErrorMessage(error)}`
        );
      }
    }
  }

  async cancelVariableAnalysisJob(jobId: string, workspaceId: number): Promise<boolean> {
    const job = await this.getWorkspaceJob(workspaceId, 'variable-analysis', jobId);
    if (!job) {
      this.logger.warn(`Variable analysis job with ID ${jobId} not found`);
      return false;
    }

    try {
      const state = await job.getState();

      if (state === 'waiting' || state === 'prioritized' || state === 'delayed') {
        await job.remove();
        this.logger.log(
          `Variable analysis job ${jobId} has been cancelled and removed from queue`
        );
        return true;
      }

      if (state === 'active') {
        await job.updateData({ ...job.data, skipRetries: true });
        this.logger.log(
          `Variable analysis job ${jobId} is active, further retries disabled`
        );
        return true;
      }

      return true; // Already finished or failed
    } catch (error) {
      this.logger.error(
        `Error cancelling variable analysis job: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );
      return false;
    }
  }

  async getActiveResetCodingVersionJob(
    workspaceId: number
  ): Promise<Job<ResetCodingVersionJobData> | null> {
    const jobs = await this.resetCodingVersionQueue.getJobs([
      'active',
      'waiting',
      'prioritized',
      'delayed'
    ]);
    return (
      jobs.find(job => this.jobMatchesWorkspace(job, workspaceId)) || null
    );
  }

  async checkRedisConnection(): Promise<RedisConnectionStatus> {
    try {
      this.logger.log('Checking Redis connection status...');

      // Use BullMQ's public Redis backend for the connectivity probe
      const client = await this.testPersonCodingQueue.getBackend().client;

      if (!client) {
        return {
          connected: false,
          message: 'Redis client is not available'
        };
      }

      const startTime = Date.now();
      await client.runCommand('ping', []);
      const pingLatency = Date.now() - startTime;
      const originalJobCounts = await this.testPersonCodingQueue.getJobCounts('waiting', 'prioritized', 'active', 'completed', 'failed', 'delayed');
      const isPaused = await this.testPersonCodingQueue.isPaused();
      const waiting = (originalJobCounts.waiting ?? 0) + (originalJobCounts.prioritized ?? 0);
      const jobCounts = {
        waiting: isPaused ? 0 : waiting,
        active: originalJobCounts.active ?? 0,
        completed: originalJobCounts.completed ?? 0,
        failed: originalJobCounts.failed ?? 0,
        delayed: originalJobCounts.delayed ?? 0,
        paused: isPaused ? waiting : 0
      };
      let isReady = false;
      try {
        await this.testPersonCodingQueue.waitUntilReady();
        isReady = true;
      } catch (readyError) {
        this.logger.warn(`Queue ready check failed: ${getErrorMessage(readyError)}`);
      }

      return {
        connected: true,
        message: 'Redis is connected and jobs can be managed',
        details: {
          pingLatency,
          queueStatus: {
            name: 'test-person-coding',
            isReady,
            jobCounts
          }
        }
      };
    } catch (error) {
      this.logger.error(
        `Redis connection check failed: ${getErrorMessage(error)}`,
        getErrorStack(error)
      );

      return {
        connected: false,
        message: `Redis connection failed: ${getErrorMessage(error)}`
      };
    }
  }

  // --- External Coding Import Queue Methods ---

  async addExternalCodingImportJob(
    data: ExternalCodingImportJobData,
    options?: JobsOptions
  ): Promise<Job<ExternalCodingImportJobData>> {
    const existing = await this.findActiveJob<ExternalCodingImportJobData>(
      this.externalCodingImportQueue,
      d => d.workspaceId === data.workspaceId
    );
    if (existing) {
      throw new ConflictException(
        `An external coding import job is already running for workspace ${data.workspaceId} (job ${existing.id})`
      );
    }
    this.logger.log(
      `Adding external coding import job for workspace ${data.workspaceId}, file: ${data.fileName}`
    );
    return this.externalCodingImportQueue.add('external-coding-import', data, withQueueJobId({
      attempts: 1,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
      ...options
    }));
  }

  async getExternalCodingImportJob(
    jobId: string
  ): Promise<Job<ExternalCodingImportJobData> | null> {
    return (await this.externalCodingImportQueue.getJob(jobId)) ?? null;
  }
}
