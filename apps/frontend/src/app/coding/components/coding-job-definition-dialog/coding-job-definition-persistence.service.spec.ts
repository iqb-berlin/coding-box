import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { CodingJob } from '../../models/coding-job.model';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { CodingJobService } from '../../services/coding-job.service';
import { CodingJobDefinitionPersistence } from './coding-job-definition-persistence.service';

describe('CodingJobDefinitionPersistence', () => {
  const job: CodingJob = {
    id: 8,
    workspace_id: 5,
    name: 'Job',
    status: 'pending',
    assignedCoders: [],
    created_at: new Date(0),
    updated_at: new Date(0)
  };
  let persistence: CodingJobDefinitionPersistence;
  let backend: { createCodingJob: jest.Mock; updateCodingJob: jest.Mock };
  let assignments: { assignCoder: jest.Mock };

  beforeEach(() => {
    backend = { createCodingJob: jest.fn(), updateCodingJob: jest.fn() };
    assignments = { assignCoder: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        CodingJobDefinitionPersistence,
        { provide: CodingJobBackendService, useValue: backend },
        { provide: CodingJobService, useValue: assignments }
      ]
    });
    persistence = TestBed.inject(CodingJobDefinitionPersistence);
  });

  it('waits for the saved job and all assignments, preserving selection order in the result', () => {
    const saved = new Subject<CodingJob>();
    const first = new Subject<CodingJob>();
    const second = new Subject<CodingJob>();
    backend.createCodingJob.mockReturnValue(saved);
    assignments.assignCoder.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const result = jest.fn();
    persistence.createJob(5, job, [1, 2]).subscribe(result);
    expect(assignments.assignCoder).not.toHaveBeenCalled();
    saved.next(job);
    saved.complete();
    expect(assignments.assignCoder.mock.calls).toEqual([[8, 1], [8, 2]]);
    const secondReply = { ...job, assignedCoders: [1, 2] };
    second.next(secondReply);
    second.complete();
    expect(result).not.toHaveBeenCalled();
    first.next({ ...job, assignedCoders: [1] });
    first.complete();
    expect(result).toHaveBeenCalledWith({ job: secondReply, assignmentFailed: false });
  });

  it('preserves the undefined-assignment fallback and does not turn it into a new failure', () => {
    backend.createCodingJob.mockReturnValue(of(job));
    assignments.assignCoder.mockReturnValue(of(undefined));
    const result = jest.fn();
    persistence.createJob(5, job, [1]).subscribe(result);
    expect(result).toHaveBeenCalledWith({ job: { ...job, assignedCoders: [1] }, assignmentFailed: false });
  });

  it('reports assignment errors separately from a failed job write', () => {
    backend.updateCodingJob.mockReturnValue(of(job));
    assignments.assignCoder.mockReturnValue(throwError(() => new Error('assignment')));
    const result = jest.fn();
    persistence.updateJob(5, 8, job, [1]).subscribe(result);
    expect(backend.updateCodingJob).toHaveBeenCalledWith(5, 8, job);
    expect(result).toHaveBeenCalledWith({ job: { ...job, assignedCoders: [1] }, assignmentFailed: true });

    const error = new Error('write');
    backend.createCodingJob.mockReturnValue(throwError(() => error));
    const failed = jest.fn();
    assignments.assignCoder.mockClear();
    persistence.createJob(5, job, [1]).subscribe({ error: failed });
    expect(failed).toHaveBeenCalledWith(error);
    expect(assignments.assignCoder).not.toHaveBeenCalled();
  });

  it('returns the saved job directly when no coders are selected', () => {
    backend.createCodingJob.mockReturnValue(of(job));
    const result = jest.fn();
    persistence.createJob(5, job, []).subscribe(result);
    expect(result).toHaveBeenCalledWith({ job, assignmentFailed: false });
    expect(assignments.assignCoder).not.toHaveBeenCalled();
  });

  it('cancels pending assignments with the owning subscription', () => {
    backend.createCodingJob.mockReturnValue(of(job));
    const first = new Subject<CodingJob>();
    const second = new Subject<CodingJob>();
    assignments.assignCoder.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const result = jest.fn();
    const subscription = persistence.createJob(5, job, [1, 2]).subscribe(result);
    subscription.unsubscribe();
    expect(first.observed).toBe(false);
    expect(second.observed).toBe(false);
    expect(result).not.toHaveBeenCalled();
  });
});
