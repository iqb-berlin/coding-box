import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { catchError, map } from 'rxjs/operators';
import { Coder } from '../models/coder.model';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../services/app.service';

@Injectable({
  providedIn: 'root'
})
export class CoderService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);
  private appService = inject(AppService);
  private codersSubject = new BehaviorSubject<Coder[]>([]);

  getCoders(): Observable<Coder[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      console.error('No workspace ID available');
      return of([]);
    }
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/coders`;

    interface WorkspaceUser {
      userId: number;
      workspaceId: number;
      accessLevel: number;
      username: string;
    }

    this.http.get<{ data: WorkspaceUser[], total: number }>(url).subscribe({
      next: response => {
        // Map the workspace users with accessLevel 1 to Coder objects
        const coders: Coder[] = response.data.map(user => ({
          id: user.userId,
          name: user.username || `User ${user.userId}`, // Use username if available, otherwise fallback to default
          displayName: user.username || `Coder ${user.userId}`, // Use username if available, otherwise fallback to default
          assignedJobs: []
        }));

        // Update the subject with the fetched coders
        this.codersSubject.next(coders);
      },
      error: error => {
        console.error('Error fetching coders:', error);
        // Keep the current value in case of error
      }
    });

    // Return the observable from the subject
    return this.codersSubject.asObservable();
  }

  createCoder(coder: Omit<Coder, 'id'>): Observable<Coder> {
    const newCoder: Coder = {
      ...coder,
      id: this.getNextId()
    };

    const updatedCoders = [...this.codersSubject.value, newCoder];
    this.codersSubject.next(updatedCoders);

    return of(newCoder);
  }

  updateCoder(id: number, coder: Partial<Coder>): Observable<Coder | undefined> {
    const coders = this.codersSubject.value;
    const index = coders.findIndex(c => c.id === id);

    if (index === -1) {
      return of(undefined);
    }

    const updatedCoder: Coder = {
      ...coders[index],
      ...coder
    };

    const updatedCoders = [...coders];
    updatedCoders[index] = updatedCoder;

    this.codersSubject.next(updatedCoders);

    return of(updatedCoder);
  }

  /**
   * Deletes a coder
   * @param id The ID of the coder to delete
   */
  deleteCoder(id: number): Observable<boolean> {
    const coders = this.codersSubject.value;
    const updatedCoders = coders.filter(c => c.id !== id);

    if (updatedCoders.length === coders.length) {
      return of(false);
    }

    this.codersSubject.next(updatedCoders);

    return of(true);
  }

  /**
   * Assigns a coding job to a coder
   * @param coderId The ID of the coder
   * @param jobId The ID of the coding job
   */
  assignJob(coderId: number, jobId: number): Observable<Coder | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      console.error('No workspace ID available');
      return of(undefined);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/coding-jobs/${jobId}/assign/${coderId}`;

    return this.http.post<{ success: boolean }>(url, {}).pipe(
      map(() => {
        // Update the local state after successful assignment
        const coders = this.codersSubject.value;
        const index = coders.findIndex(c => c.id === coderId);

        if (index === -1) {
          return undefined;
        }

        const coder = coders[index];
        const assignedJobs = coder.assignedJobs || [];

        // Only add the job if it's not already assigned
        if (!assignedJobs.includes(jobId)) {
          const updatedCoder: Coder = {
            ...coder,
            assignedJobs: [...assignedJobs, jobId]
          };

          const updatedCoders = [...coders];
          updatedCoders[index] = updatedCoder;

          this.codersSubject.next(updatedCoders);

          return updatedCoder;
        }

        return coder;
      }),
      catchError(error => {
        console.error(`Error assigning job ${jobId} to coder ${coderId}:`, error);
        return of(undefined);
      })
    );
  }

  /**
   * Unassigns a coding job from a coder
   * @param coderId The ID of the coder
   * @param jobId The ID of the coding job
   */
  unassignJob(coderId: number, jobId: number): Observable<Coder | undefined> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      console.error('No workspace ID available');
      return of(undefined);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/coding-jobs/${jobId}/unassign/${coderId}`;

    return this.http.delete<{ success: boolean }>(url).pipe(
      map(() => {
        // Update the local state after successful unassignment
        const coders = this.codersSubject.value;
        const index = coders.findIndex(c => c.id === coderId);

        if (index === -1) {
          return undefined;
        }

        const coder = coders[index];
        const assignedJobs = coder.assignedJobs || [];

        const updatedCoder: Coder = {
          ...coder,
          assignedJobs: assignedJobs.filter(id => id !== jobId)
        };

        const updatedCoders = [...coders];
        updatedCoders[index] = updatedCoder;

        this.codersSubject.next(updatedCoders);

        return updatedCoder;
      }),
      catchError(error => {
        console.error(`Error unassigning job ${jobId} from coder ${coderId}:`, error);
        return of(undefined);
      })
    );
  }

  /**
   * Gets all coders assigned to a specific job
   * @param jobId The ID of the coding job
   */
  getCodersByJobId(jobId: number): Observable<Coder[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      console.error('No workspace ID available');
      return of([]);
    }

    // Remove trailing slash from serverUrl if present to avoid double slashes
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/workspace/${workspaceId}/coding-jobs/${jobId}/coders`;

    interface WorkspaceUser {
      userId: number;
      workspaceId: number;
      accessLevel: number;
      username: string;
    }

    return this.http.get<{ data: WorkspaceUser[], total: number }>(url).pipe(
      map(response => {
        // Map WorkspaceUser objects to Coder objects
        const fetchedCoders: Coder[] = response.data.map(user => ({
          id: user.userId,
          name: user.username || `User ${user.userId}`,
          displayName: user.username || `Coder ${user.userId}`,
          assignedJobs: [jobId]
        }));

        // Merge with existing coders to maintain other properties
        const existingCoders = this.codersSubject.value;
        const mergedCoders = [...existingCoders];

        fetchedCoders.forEach(fetchedCoder => {
          const index = mergedCoders.findIndex(c => c.id === fetchedCoder.id);
          if (index !== -1) {
            // Update existing coder
            mergedCoders[index] = {
              ...mergedCoders[index],
              ...fetchedCoder,
              assignedJobs: [...(mergedCoders[index].assignedJobs || []), jobId]
            };
          } else {
            // Add new coder
            mergedCoders.push(fetchedCoder);
          }
        });

        // Update the subject with the merged coders
        this.codersSubject.next(mergedCoders);

        return fetchedCoders;
      }),
      catchError(error => {
        console.error(`Error fetching coders for job ${jobId}:`, error);

        // Fallback to local data if API call fails
        const coders = this.codersSubject.value.filter(
          coder => coder.assignedJobs?.includes(jobId)
        );
        return of(coders);
      })
    );
  }

  /**
   * Gets the next available ID for a new coder
   */
  private getNextId(): number {
    const coders = this.codersSubject.value;
    return coders.length > 0 ?
      Math.max(...coders.map(c => c.id)) + 1 :
      1;
  }
}
