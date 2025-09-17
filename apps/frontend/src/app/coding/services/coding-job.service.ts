import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  BehaviorSubject, Observable, catchError, map, of, tap
} from 'rxjs';
import { CodingJob } from '../models/coding-job.model';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../services/app.service';

@Injectable({
  providedIn: 'root'
})
export class CodingJobService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private appService = inject(AppService);
  private codingJobsSubject = new BehaviorSubject<CodingJob[]>([]);

  /**
   * Gets all coding jobs for the current workspace
   */
  getCodingJobs(): Observable<CodingJob[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of([]);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs`;

    this.http.get<{ data: CodingJob[], total: number }>(url).subscribe({
      next: response => {
        // Map the response data to CodingJob objects
        const codingJobs: CodingJob[] = response.data.map(job => ({
          ...job,
          createdAt: new Date(job.createdAt),
          updatedAt: new Date(job.updatedAt)
        }));

        // Update the subject with the fetched coding jobs
        this.codingJobsSubject.next(codingJobs);
      },
      error: () => {
        // Keep the current value in case of error
      }
    });

    // Return the observable from the subject
    return this.codingJobsSubject.asObservable();
  }

  /**
   * Gets a coding job by ID
   * @param id The ID of the coding job
   */
  getCodingJob(id: number): Observable<CodingJob | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs/${id}`;

    return this.http.get<CodingJob>(url).pipe(
      map(job => ({
        ...job,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt)
      })),
      catchError(() => of(undefined))
    );
  }

  /**
   * Creates a new coding job
   * @param job The coding job to create
   */
  createCodingJob(job: Omit<CodingJob, 'id' | 'createdAt' | 'updatedAt'>): Observable<CodingJob | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs`;

    return this.http.post<CodingJob>(url, job).pipe(
      map(newJob => ({
        ...newJob,
        createdAt: new Date(newJob.createdAt),
        updatedAt: new Date(newJob.updatedAt)
      })),
      tap(newJob => {
        if (newJob) {
          const currentJobs = this.codingJobsSubject.value;
          this.codingJobsSubject.next([...currentJobs, newJob]);
        }
      }),
      catchError(() => of(undefined))
    );
  }

  /**
   * Updates a coding job
   * @param id The ID of the coding job to update
   * @param job The updated coding job data
   */
  updateCodingJob(id: number, job: Partial<CodingJob>): Observable<CodingJob | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs/${id}`;

    return this.http.put<CodingJob>(url, job).pipe(
      map(updatedJob => ({
        ...updatedJob,
        createdAt: new Date(updatedJob.createdAt),
        updatedAt: new Date(updatedJob.updatedAt)
      })),
      tap(updatedJob => {
        if (updatedJob) {
          const currentJobs = this.codingJobsSubject.value;
          const index = currentJobs.findIndex(j => j.id === id);
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

  /**
   * Deletes a coding job
   * @param id The ID of the coding job to delete
   */
  deleteCodingJob(id: number): Observable<boolean> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(false);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs/${id}`;

    return this.http.delete<{ success: boolean }>(url).pipe(
      map(response => response.success),
      tap(success => {
        if (success) {
          const currentJobs = this.codingJobsSubject.value;
          this.codingJobsSubject.next(currentJobs.filter(job => job.id !== id));
        }
      }),
      catchError(() => of(false))
    );
  }

  /**
   * Assigns a coder to a coding job
   * @param codingJobId The ID of the coding job
   * @param coderId The ID of the coder
   */
  assignCoder(codingJobId: number, coderId: number): Observable<CodingJob | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs/${codingJobId}/assign/${coderId}`;

    return this.http.post<CodingJob>(url, {}).pipe(
      map(updatedJob => ({
        ...updatedJob,
        createdAt: new Date(updatedJob.createdAt),
        updatedAt: new Date(updatedJob.updatedAt)
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

  /**
   * Unassigns a coder from a coding job
   * @param codingJobId The ID of the coding job
   * @param coderId The ID of the coder
   */
  unassignCoder(codingJobId: number, coderId: number): Observable<CodingJob | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of(undefined);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coding-jobs/${codingJobId}/assign/${coderId}`;

    return this.http.delete<CodingJob>(url).pipe(
      map(updatedJob => ({
        ...updatedJob,
        createdAt: new Date(updatedJob.createdAt),
        updatedAt: new Date(updatedJob.updatedAt)
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

  /**
   * Gets all coding jobs assigned to a coder
   * @param coderId The ID of the coder
   */
  getCodingJobsByCoder(coderId: number): Observable<CodingJob[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      console.error('No workspace ID available');
      return of([]);
    }

    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coders/${coderId}/coding-jobs`;

    return this.http.get<{ data: CodingJob[] }>(url).pipe(
      map(response => response.data.map(job => ({
        ...job,
        createdAt: new Date(job.createdAt),
        updatedAt: new Date(job.updatedAt)
      }))),
      catchError(error => {
        console.error(`Error fetching coding jobs for coder ${coderId}:`, error);
        return of([]);
      })
    );
  }
}
