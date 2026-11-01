import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { AppService } from '../../../../core/services/app.service';
import { JobStatus, TestPersonCodingService } from '../../../services/test-person-coding.service';
import { CodingFreshnessPollingFacade, FreshnessJobCompletion } from './coding-freshness-polling.facade';

describe('CodingFreshnessPollingFacade', () => {
  let facade: CodingFreshnessPollingFacade;
  let backend: { getJobStatus: jest.Mock; trackFreshnessCodingGuardUntilComplete: jest.Mock };
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: Subject<number> };

  beforeEach(() => {
    jest.useFakeTimers();
    backend = {
      getJobStatus: jest.fn().mockReturnValue(of({ status: 'processing', progress: 25 })),
      trackFreshnessCodingGuardUntilComplete: jest.fn()
    };
    app = { selectedWorkspaceId: 1, selectedWorkspaceId$: new Subject<number>() };
    TestBed.configureTestingModule({ providers: [
      CodingFreshnessPollingFacade,
      { provide: TestPersonCodingService, useValue: backend },
      { provide: AppService, useValue: app }
    ] });
    facade = TestBed.inject(CodingFreshnessPollingFacade);
  });

  afterEach(() => {
    facade.dispose();
    jest.useRealTimers();
  });

  it('tracks dialog-owned jobs without polling until the view explicitly resumes', () => {
    facade.track('job', 1);
    jest.advanceTimersByTime(10_000);
    expect(facade.jobId).toBe('job');
    expect(facade.progress()).toBe(0);
    expect(facade.isPolling()).toBe(false);
    expect(backend.getJobStatus).not.toHaveBeenCalled();
    facade.start('job', 1);
    jest.advanceTimersByTime(1999);
    expect(backend.getJobStatus).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(backend.getJobStatus).toHaveBeenCalledWith(1, 'job');
    expect(facade.progress()).toBe(25);
  });

  it('waits for a slow status response instead of overlapping requests or canceling it on every tick', () => {
    const pending = new Subject<JobStatus>();
    backend.getJobStatus.mockReturnValueOnce(pending);
    facade.start('job', 1);
    jest.advanceTimersByTime(6000);
    expect(backend.getJobStatus).toHaveBeenCalledTimes(1);
    pending.next({ status: 'processing', progress: 50 });
    pending.complete();
    expect(facade.progress()).toBe(50);
    jest.advanceTimersByTime(2000);
    expect(backend.getJobStatus).toHaveBeenCalledTimes(2);
  });

  it('stops in-flight status replies and timers when polling is stopped', () => {
    const pending = new Subject<JobStatus>();
    backend.getJobStatus.mockReturnValue(pending);
    facade.start('job', 1);
    jest.advanceTimersByTime(2000);
    facade.stop();
    pending.next({ status: 'processing', progress: 90 });
    jest.advanceTimersByTime(6000);
    expect(pending.observed).toBe(false);
    expect(facade.progress()).toBeNull();
    expect(facade.jobId).toBeNull();
    expect(backend.getJobStatus).toHaveBeenCalledTimes(1);
  });

  it('hands replaced jobs to persistent tracking and ignores their late replies', () => {
    const pending = new Subject<JobStatus>();
    backend.getJobStatus.mockReturnValueOnce(pending);
    facade.start('old', 1);
    jest.advanceTimersByTime(2000);
    facade.start('new', 1);
    pending.next({ status: 'processing', progress: 90 });
    jest.advanceTimersByTime(2000);
    expect(backend.trackFreshnessCodingGuardUntilComplete).toHaveBeenCalledWith(1, 'old');
    expect(pending.observed).toBe(false);
    expect(facade.jobId).toBe('new');
    expect(facade.progress()).toBe(25);
  });

  it.each(['completed', 'failed', 'cancelled', 'paused'] as const)('emits %s once and stops view polling', status => {
    const completions: FreshnessJobCompletion[] = [];
    facade.completed$.subscribe(completion => completions.push(completion));
    backend.getJobStatus.mockReturnValue(of({ status, progress: 100 }));
    facade.start('job', 1);
    jest.advanceTimersByTime(10_000);
    expect(completions).toEqual([{ workspaceId: 1, jobId: 'job', status: { status, progress: 100 } }]);
    expect(facade.isPolling()).toBe(false);
    expect(backend.getJobStatus).toHaveBeenCalledTimes(1);
    expect(backend.trackFreshnessCodingGuardUntilComplete).not.toHaveBeenCalled();
  });

  it('suppresses consecutive polling errors and enables feedback again after recovery', () => {
    const errors: string[] = [];
    facade.errors$.subscribe(message => errors.push(message));
    backend.getJobStatus.mockReturnValueOnce(of({ error: 'Unavailable' }))
      .mockReturnValueOnce(of({ error: 'Unavailable' }))
      .mockReturnValueOnce(of({ status: 'processing', progress: 50 }))
      .mockReturnValueOnce(of({ error: 'Unavailable again' }));
    facade.start('job', 1);
    jest.advanceTimersByTime(8000);
    expect(errors).toEqual(['Unavailable', 'Unavailable again']);
    expect(facade.isPolling()).toBe(true);
  });

  it('keeps polling after an observable error', () => {
    backend.getJobStatus.mockReturnValueOnce(throwError(() => new Error('Temporary error')));
    const errors: string[] = [];
    facade.errors$.subscribe(message => errors.push(message));
    facade.start('job', 1);
    jest.advanceTimersByTime(4000);
    expect(errors).toEqual(['Temporary error']);
    expect(facade.progress()).toBe(25);
  });

  it.each(['workspace-return', 'destroy', 'dispose'])('hands unfinished jobs off exactly once after %s', end => {
    const pending = new Subject<JobStatus>();
    backend.getJobStatus.mockReturnValue(pending);
    facade.start('job', 1);
    jest.advanceTimersByTime(2000);
    if (end === 'destroy') TestBed.resetTestingModule();
    else if (end === 'dispose') facade.dispose();
    else {
      app.selectedWorkspaceId = 2;
      app.selectedWorkspaceId$.next(2);
      app.selectedWorkspaceId = 1;
      app.selectedWorkspaceId$.next(1);
    }
    pending.next({ status: 'completed', progress: 100 });
    facade.dispose();
    jest.advanceTimersByTime(4000);
    expect(backend.trackFreshnessCodingGuardUntilComplete).toHaveBeenCalledTimes(1);
    expect(backend.trackFreshnessCodingGuardUntilComplete).toHaveBeenCalledWith(1, 'job');
    expect(pending.observed).toBe(false);
    expect(facade.isPolling()).toBe(false);
  });

  it('retains tracking on repeated notifications for the same workspace', () => {
    facade.start('job', 1);
    app.selectedWorkspaceId$.next(1);
    expect(facade.isPolling()).toBe(true);
    expect(backend.trackFreshnessCodingGuardUntilComplete).not.toHaveBeenCalled();
  });

  it('does not start stale workspace polling or restart a disposed view', () => {
    app.selectedWorkspaceId = 2;
    facade.start('old-job', 1);
    expect(backend.trackFreshnessCodingGuardUntilComplete).toHaveBeenCalledWith(1, 'old-job');
    expect(facade.jobId).toBeNull();
    facade.dispose();
    facade.start('job', 2);
    jest.advanceTimersByTime(4000);
    expect(backend.getJobStatus).not.toHaveBeenCalled();
  });
});
