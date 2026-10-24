import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of, Subject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AppService } from '../../../core/services/app.service';
import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';
import { TestResultService, TestResultsOverviewResponse } from '../../../shared/services/test-result/test-result.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { TestResultsExportFacade } from './test-results-export.facade';
import { TestResultsDeletionFacade } from './test-results-deletion.facade';
import { TestResultsStatisticsFacade } from './test-results-statistics.facade';

@Component({
  standalone: true,
  template: '<span class="progress">{{exports.exportJobProgress()}}</span><span class="persons">{{statistics.overview()?.testPersons}}</span>',
  providers: [TestResultsExportFacade, TestResultsDeletionFacade, TestResultsStatisticsFacade]
})
class ResultsFacadeHost {
  readonly exports = inject(TestResultsExportFacade);
  readonly deletion = inject(TestResultsDeletionFacade);
  readonly statistics = inject(TestResultsStatisticsFacade);
}

const overview = (testPersons: number): TestResultsOverviewResponse => ({
  testPersons,
  testGroups: 1,
  uniqueBooklets: 1,
  uniqueUnits: 1,
  uniqueResponses: 1,
  responseStatusCounts: {},
  sessionBrowserCounts: {},
  sessionOsCounts: {},
  sessionScreenCounts: {}
});

describe('test-results feature request and polling lifetimes', () => {
  let fixture: ComponentFixture<ResultsFacadeHost>;
  let host: ResultsFacadeHost;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };
  let backend: { getExportTestResultsJobs: jest.Mock; downloadExportTestResultsJob: jest.Mock };
  let results: { getWorkspaceOverview: jest.Mock; invalidateCache: jest.Mock };
  let validation: { getValidationTask: jest.Mock; getValidationResults: jest.Mock };
  let coding: { notifyTestResultsChanged: jest.Mock };
  let snack: { open: jest.Mock };
  const changeWorkspace = (id: number): void => { app.selectedWorkspaceId = id; app.selectedWorkspaceId$.next(id); };

  beforeEach(() => {
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    backend = { getExportTestResultsJobs: jest.fn(), downloadExportTestResultsJob: jest.fn() };
    results = { getWorkspaceOverview: jest.fn(), invalidateCache: jest.fn() };
    validation = { getValidationTask: jest.fn(), getValidationResults: jest.fn() };
    coding = { notifyTestResultsChanged: jest.fn() };
    snack = { open: jest.fn().mockReturnValue({ onAction: () => of() }) };
    TestBed.configureTestingModule({
      imports: [ResultsFacadeHost],
      providers: [
        { provide: AppService, useValue: app }, { provide: TestResultBackendService, useValue: backend },
        { provide: TestResultService, useValue: results }, { provide: TestPersonCodingService, useValue: coding },
        { provide: ValidationService, useValue: validation }, { provide: ValidationTaskStateService, useValue: { invalidateWorkspace: jest.fn() } },
        { provide: CodingStatisticsService, useValue: {} }, { provide: WorkspaceSettingsService, useValue: {} },
        { provide: MatDialog, useValue: { open: jest.fn() } }, { provide: MatSnackBar, useValue: snack }
      ]
    });
    fixture = TestBed.createComponent(ResultsFacadeHost); host = fixture.componentInstance; fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); jest.useRealTimers(); });

  it('renders the newest delayed overview without a manual change detection call', async () => {
    const old = new Subject<TestResultsOverviewResponse>(); const latest = new Subject<TestResultsOverviewResponse>();
    results.getWorkspaceOverview.mockReturnValueOnce(old).mockReturnValueOnce(latest);
    host.statistics.loadWorkspaceOverview(); host.statistics.loadWorkspaceOverview();
    expect(old.observed).toBe(false);
    latest.next(overview(8)); latest.complete(); old.next(overview(99));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.persons').textContent).toBe('8');
  });

  it('exposes feature state through read-only signals', () => {
    for (const state of [
      host.statistics.overview, host.statistics.isLoadingOverview,
      host.statistics.codingFreshnessSummary, host.statistics.manualAppliedResultsOverview,
      host.exports.isExporting, host.exports.exportJobProgress,
      host.deletion.activeDeleteTask, host.deletion.deleteProgress
    ]) {
      expect('set' in state).toBe(false);
      expect('update' in state).toBe(false);
    }
  });

  it('does not let delayed job recovery replace a newly started export', () => {
    const recovery = new Subject<unknown[]>();
    backend.getExportTestResultsJobs.mockReturnValue(recovery);
    const start = jest.fn().mockReturnValue(of({ jobId: 'new' }));
    Object.assign(backend, { startExportTestResultsJob: start });
    const dialog = TestBed.inject(MatDialog) as unknown as { open: jest.Mock };
    dialog.open.mockReturnValue({ afterClosed: () => of({}), close: jest.fn() });
    host.exports.checkExistingExportJobs();
    host.exports.startExportJob('results');
    expect(recovery.observed).toBe(false);
    recovery.next([{
      jobId: 'old', status: 'active', exportType: 'test-results', progress: 20
    }]);
    expect(host.exports.exportJobId()).toBe('new');
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does not overlap export status requests and stops at one terminal notification', () => {
    jest.useFakeTimers(); const pending = new Subject<unknown[]>();
    backend.getExportTestResultsJobs.mockReturnValueOnce(pending).mockReturnValue(of([{ jobId: 'job', status: 'completed', progress: 100 }]));
    host.exports.pollExportJobStatus('job');
    jest.advanceTimersByTime(8000); expect(backend.getExportTestResultsJobs).toHaveBeenCalledTimes(1);
    pending.next([{ jobId: 'job', status: 'active', progress: 25 }]); pending.complete();
    jest.advanceTimersByTime(2000);
    expect(host.exports.exportJobProgress()).toBe(100);
    expect(snack.open).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10000);
    expect(backend.getExportTestResultsJobs).toHaveBeenCalledTimes(2);
  });

  it.each(['workspace', 'destroy', 'replacement'] as const)('cancels an export request on %s and ignores its late response', target => {
    jest.useFakeTimers(); const pending = new Subject<unknown[]>();
    backend.getExportTestResultsJobs.mockReturnValue(pending);
    host.exports.pollExportJobStatus('old'); jest.advanceTimersByTime(2000);
    if (target === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else if (target === 'destroy') fixture.destroy();
    else host.exports.pollExportJobStatus('new');
    expect(pending.observed).toBe(false);
    pending.next([{ jobId: 'old', status: 'completed', progress: 100 }]);
    expect(snack.open).not.toHaveBeenCalled();
    expect(host.exports.exportJobProgress()).toBe(0);
  });

  it('releases failed export polling and permits an explicit retry', () => {
    jest.useFakeTimers(); const pending = new Subject<unknown[]>();
    backend.getExportTestResultsJobs.mockReturnValueOnce(of([{
      jobId: 'old', status: 'active', exportType: 'test-results', progress: 0
    }]))
      .mockReturnValueOnce(pending).mockReturnValue(of([{ jobId: 'retry', status: 'active', progress: 60 }]));
    host.exports.checkExistingExportJobs(); host.exports.pollExportJobStatus('old'); jest.advanceTimersByTime(2000);
    pending.error(new Error('offline')); expect(host.exports.isExporting()).toBe(false);
    host.exports.pollExportJobStatus('retry'); jest.advanceTimersByTime(2000);
    expect(host.exports.exportJobProgress()).toBe(60);
  });

  it('cancels a pending download when its workspace changes', () => {
    const pending = new Subject<Blob>(); backend.downloadExportTestResultsJob.mockReturnValue(pending);
    host.exports.downloadExportResult('job'); changeWorkspace(6); changeWorkspace(5);
    expect(pending.observed).toBe(false);
  });

  it.each(['workspace', 'destroy'] as const)('cancels delete polling on %s before it can load results', target => {
    jest.useFakeTimers(); const pending = new Subject<unknown>(); validation.getValidationTask.mockReturnValue(pending);
    host.deletion.pollDeleteTask(17); jest.advanceTimersByTime(0);
    if (target === 'workspace') { changeWorkspace(6); changeWorkspace(5); } else fixture.destroy();
    expect(pending.observed).toBe(false);
    pending.next({ id: 17, status: 'completed', progress: 100 });
    expect(validation.getValidationResults).not.toHaveBeenCalled();
    expect(coding.notifyTestResultsChanged).not.toHaveBeenCalled();
  });

  it('does not overlap delete polling and emits the completed change once', () => {
    jest.useFakeTimers(); const pending = new Subject<unknown>(); const changed = jest.fn();
    host.deletion.changed$.subscribe(changed);
    validation.getValidationTask.mockReturnValueOnce(pending).mockReturnValue(of({ id: 17, status: 'completed', progress: 100 }));
    validation.getValidationResults.mockReturnValue(of({ deletedTargetCount: 4 }));
    host.deletion.pollDeleteTask(17); jest.advanceTimersByTime(3000);
    expect(validation.getValidationTask).toHaveBeenCalledTimes(1);
    pending.next({ id: 17, status: 'processing', progress: 10 }); pending.complete();
    jest.advanceTimersByTime(1000);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(coding.notifyTestResultsChanged).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(validation.getValidationTask).toHaveBeenCalledTimes(2);
  });
});
