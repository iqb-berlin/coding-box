import { Injectable, inject, EventEmitter } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject, Observable, catchError, map, of, tap
} from 'rxjs';
import { CodingJob } from '../models/coding-job.model';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../core/services/app.service';
import { ResponseEntity } from '../../shared/models/response-entity.model';

@Injectable({
  providedIn: 'root'
})
export class CodingJobService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private appService: AppService = inject(AppService);
  private codingJobsSubject = new BehaviorSubject<CodingJob[]>([]);

  // Event emitter for auto-refresh after bulk job creation
  jobsCreatedEvent = new EventEmitter<void>();

  assignCoder(codingJobId: number, coderId: number): Observable<CodingJob | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs/${codingJobId}/assign/${coderId}`;

    return this.http.post<CodingJob>(url, {}).pipe(
      map(updatedJob => ({
        ...updatedJob,
        created_at: new Date((updatedJob).created_at),
        updated_at: new Date((updatedJob).updated_at)
      })),
      tap(updatedJob => {
        if (updatedJob) {
          const currentJobs = this.codingJobsSubject.value;
          const index = currentJobs.findIndex(j => j.id === codingJobId);
          if (index !== -1) {
            const updatedJobs = [...currentJobs];
            updatedJobs[index] = updatedJob;
            this.codingJobsSubject.next(updatedJobs);
          }
        }
      }),
      catchError(() => of(undefined))
    );
  }

  getResponsesForCodingJob(codingJobId: number): Observable<ResponseEntity[]> {
    const url = `${this.serverUrl}admin/coding-jobs/${codingJobId}/responses`;
    return this.http.get<{ data: ResponseEntity[] }>(url).pipe(
      map(response => response.data)
    );
  }
}
