import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { Coder } from '../models/coder.model';

@Injectable({
  providedIn: 'root'
})
export class CoderService {
  // Sample data for demonstration
  private sampleCoders: Coder[] = [
    {
      id: 1,
      name: 'Kodierer 1',
      displayName: 'Max Mustermann',
      email: 'max.mustermann@example.com',
      assignedJobs: [1]
    },
    {
      id: 2,
      name: 'Kodierer 2',
      displayName: 'Anna Schmidt',
      email: 'anna.schmidt@example.com',
      assignedJobs: [2]
    },
    {
      id: 3,
      name: 'Kodierer 3',
      displayName: 'Tom Meyer',
      email: 'tom.meyer@example.com',
      assignedJobs: [3]
    }
  ];

  private codersSubject = new BehaviorSubject<Coder[]>(this.sampleCoders);

  /**
   * Gets all coders
   */
  getCoders(): Observable<Coder[]> {
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
