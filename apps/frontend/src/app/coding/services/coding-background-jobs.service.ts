import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

export type CodingBackgroundJobKind =
  | 'autocoder-reset'
  | 'response-analysis'
  | 'freshness-coding';

export interface CodingStatusGuardClearedEvent {
  workspaceId: number;
  kind?: CodingBackgroundJobKind;
  jobId?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodingBackgroundJobsService {
  private readonly activeJobsByWorkspace = new Map<number, Map<CodingBackgroundJobKind, Set<string>>>();
  private readonly activeJobSnapshot$ = new BehaviorSubject<Map<number, Set<CodingBackgroundJobKind>>>(new Map());
  private readonly statusGuardClearedSubject = new Subject<CodingStatusGuardClearedEvent>();

  readonly statusGuardCleared$ = this.statusGuardClearedSubject.asObservable();

  setJobRunning(
    workspaceId: number | null | undefined,
    kind: CodingBackgroundJobKind,
    isRunning: boolean,
    jobId = 'default'
  ): void {
    if (!workspaceId) {
      return;
    }

    const wasGuardActive = this.isStatusCheckGuardActive(workspaceId);
    const workspaceJobs = this.getWorkspaceJobs(workspaceId);
    const jobIds = workspaceJobs.get(kind) || new Set<string>();

    if (isRunning) {
      jobIds.add(jobId);
      workspaceJobs.set(kind, jobIds);
    } else {
      jobIds.delete(jobId);
      if (jobIds.size === 0) {
        workspaceJobs.delete(kind);
      } else {
        workspaceJobs.set(kind, jobIds);
      }
    }

    if (workspaceJobs.size === 0) {
      this.activeJobsByWorkspace.delete(workspaceId);
    }

    this.emitSnapshot();

    if (wasGuardActive && !this.isStatusCheckGuardActive(workspaceId)) {
      this.statusGuardClearedSubject.next({ workspaceId, kind, jobId });
    }
  }

  isStatusCheckGuardActive(workspaceId: number | null | undefined): boolean {
    if (!workspaceId) {
      return false;
    }

    return (this.activeJobsByWorkspace.get(workspaceId)?.size || 0) > 0;
  }

  isStatusCheckGuardActive$(
    workspaceId: number
  ): Observable<boolean> {
    return this.activeJobSnapshot$.pipe(
      map(snapshot => (snapshot.get(workspaceId)?.size || 0) > 0),
      distinctUntilChanged()
    );
  }

  private getWorkspaceJobs(
    workspaceId: number
  ): Map<CodingBackgroundJobKind, Set<string>> {
    const existing = this.activeJobsByWorkspace.get(workspaceId);
    if (existing) {
      return existing;
    }

    const created = new Map<CodingBackgroundJobKind, Set<string>>();
    this.activeJobsByWorkspace.set(workspaceId, created);
    return created;
  }

  private emitSnapshot(): void {
    const snapshot = new Map<number, Set<CodingBackgroundJobKind>>();
    this.activeJobsByWorkspace.forEach((jobs, workspaceId) => {
      snapshot.set(workspaceId, new Set(jobs.keys()));
    });
    this.activeJobSnapshot$.next(snapshot);
  }
}
