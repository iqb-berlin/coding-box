import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { Coder } from '../models/coder.model';
import { SERVER_URL } from '../../injection-tokens';

@Injectable({
  providedIn: 'root'
})
export class CoderService {
  private http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL);

  // Initialize with empty array
  private codersSubject = new BehaviorSubject<Coder[]>([]);

  /**
   * Gets all coders (users with accessLevel 1) for the current workspace
   */
  getCoders(): Observable<Coder[]> {
    // Get the current workspace ID from localStorage
    const workspaceId = localStorage.getItem('workspace_id');

    if (!workspaceId) {
      console.error('No workspace ID found in localStorage');
      return of([]);
    }

    // Fetch coders from the API
    const url = `${this.serverUrl}/admin/workspace/${workspaceId}/coders`;

    interface WorkspaceUser {
      userId: number;
      workspaceId: number;
      accessLevel: number;
    }

    this.http.get<{ data: WorkspaceUser[], total: number }>(url).subscribe({
      next: response => {
        // Map the workspace users with accessLevel 1 to Coder objects
        const coders: Coder[] = response.data.map(user => ({
          id: user.userId,
          name: `User ${user.userId}`, // Default name if user details not available
          displayName: `Coder ${user.userId}`, // Default display name
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

  /**
   * Gets a coder by ID
   * @param id The ID of the coder to get
   */
  getCoderById(id: number): Observable<Coder | undefined> {
    const coder = this.codersSubject.value.find(c => c.id === id);
    return of(coder);
  }

  /**
   * Creates a new coder
   * @param coder The coder to create
   */
  createCoder(coder: Omit<Coder, 'id'>): Observable<Coder> {
    const newCoder: Coder = {
      ...coder,
      id: this.getNextId()
    };

    const updatedCoders = [...this.codersSubject.value, newCoder];
    this.codersSubject.next(updatedCoders);

    return of(newCoder);
  }

  /**
   * Updates an existing coder
   * @param id The ID of the coder to update
   * @param coder The updated coder data
   */
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
    const coders = this.codersSubject.value;
    const index = coders.findIndex(c => c.id === coderId);

    if (index === -1) {
      return of(undefined);
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

      return of(updatedCoder);
    }

    return of(coder);
  }

  /**
   * Unassigns a coding job from a coder
   * @param coderId The ID of the coder
   * @param jobId The ID of the coding job
   */
  unassignJob(coderId: number, jobId: number): Observable<Coder | undefined> {
    const coders = this.codersSubject.value;
    const index = coders.findIndex(c => c.id === coderId);

    if (index === -1) {
      return of(undefined);
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

    return of(updatedCoder);
  }

  /**
   * Gets all coders assigned to a specific job
   * @param jobId The ID of the coding job
   */
  getCodersByJobId(jobId: number): Observable<Coder[]> {
    const coders = this.codersSubject.value.filter(
      coder => coder.assignedJobs?.includes(jobId)
    );
    return of(coders);
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
