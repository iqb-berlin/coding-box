import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { catchError, map } from 'rxjs/operators';
import { Coder } from '../models/coder.model';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../services/app.service';
import { CodingJob } from '../models/coding-job.model';

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
        const coders: Coder[] = response.data.map(user => ({
          id: user.userId,
          name: user.username || `User ${user.userId}`,
          displayName: user.username || `Coder ${user.userId}`,
          assignedJobs: []
        }));
        this.codersSubject.next(coders);
      }
    });

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

  deleteCoder(id: number): Observable<boolean> {
    const coders = this.codersSubject.value;
    const updatedCoders = coders.filter(c => c.id !== id);

    if (updatedCoders.length === coders.length) {
      return of(false);
    }

    this.codersSubject.next(updatedCoders);

    return of(true);
  }

  getJobsByCoderId(coderId: number): Observable<CodingJob[]> {
    const baseUrl = this.serverUrl.endsWith('/') ? this.serverUrl.slice(0, -1) : this.serverUrl;
    const url = `${baseUrl}/admin/coding-jobs/${coderId}/coders`;

    return this.http.get<{ data: CodingJob[], total: number }>(url).pipe(
      map(response => response.data)
    );
  }

  getCodersByJobId(jobId: number): Observable<Coder[]> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return of([]);
    }

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
        const fetchedCoders: Coder[] = response.data.map(user => ({
          id: user.userId,
          name: user.username || `User ${user.userId}`,
          displayName: user.username || `Coder ${user.userId}`,
          assignedJobs: [jobId]
        }));

        const existingCoders = this.codersSubject.value;
        const mergedCoders = [...existingCoders];

        fetchedCoders.forEach(fetchedCoder => {
          const index = mergedCoders.findIndex(c => c.id === fetchedCoder.id);
          if (index !== -1) {
            mergedCoders[index] = {
              ...mergedCoders[index],
              ...fetchedCoder,
              assignedJobs: [...(mergedCoders[index].assignedJobs || []), jobId]
            };
          } else {
            mergedCoders.push(fetchedCoder);
          }
        });

        this.codersSubject.next(mergedCoders);

        return fetchedCoders;
      }),
      catchError(() => {
        const coders = this.codersSubject.value.filter(
          coder => coder.assignedJobs?.includes(jobId)
        );
        return of(coders);
      })
    );
  }

  private getNextId(): number {
    const coders = this.codersSubject.value;
    return coders.length > 0 ?
      Math.max(...coders.map(c => c.id)) + 1 :
      1;
  }
}
