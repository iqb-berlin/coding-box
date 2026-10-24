import { Injectable, inject } from '@angular/core';
import {
  Observable, catchError, concatMap, forkJoin, map, of
} from 'rxjs';
import { CodingJob } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingJobService } from '../../services/coding-job.service';

export interface CodingJobSaveResult {
  job: CodingJob;
  assignmentFailed: boolean;
}

/** One subscription owns the job write and the subsequent coder assignments. */
@Injectable()
export class CodingJobDefinitionPersistence {
  private readonly backend = inject(CodingJobBackendService);
  private readonly jobs = inject(CodingJobService);

  createJob(workspaceId: number, job: CodingJob, coderIds: number[]): Observable<CodingJobSaveResult> {
    return this.assignCoders(this.backend.createCodingJob(workspaceId, job), coderIds);
  }

  updateJob(workspaceId: number, jobId: number, job: CodingJob, coderIds: number[]): Observable<CodingJobSaveResult> {
    return this.assignCoders(this.backend.updateCodingJob(workspaceId, jobId, job), coderIds);
  }

  private assignCoders(source: Observable<CodingJob>, coderIds: number[]): Observable<CodingJobSaveResult> {
    return source.pipe(concatMap(job => {
      if (!job?.id || !coderIds.length) return of({ job, assignmentFailed: false });
      const fallback = { ...job, assignedCoders: coderIds };
      return forkJoin(coderIds.map(id => this.jobs.assignCoder(job.id!, id))).pipe(
        map(results => ({
          // Preserve the existing result contract, including undefined assignment replies.
          job: results.filter((result): result is CodingJob => !!result).pop() || fallback,
          assignmentFailed: false
        })),
        catchError(() => of({ job: fallback, assignmentFailed: true }))
      );
    }));
  }
}
