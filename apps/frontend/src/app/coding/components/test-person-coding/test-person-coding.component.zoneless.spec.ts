import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { TestPersonCodingComponent } from './test-person-coding.component';
import {
  JobInfo, JobStatus, TestPersonCodingService, WorkspaceGroupCodingStats
} from '../../services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';

describe('Test person coding delayed responses without Zone.js', () => {
  let fixture: ComponentFixture<TestPersonCodingComponent>;
  let jobs: Subject<JobInfo[]>;
  let groups: Subject<WorkspaceGroupCodingStats[]>;
  let status: Subject<JobStatus | { error: string }>;
  let coding: Subject<{ jobId: string; message: string }>;
  let testPersons: Subject<string[]>;
  let service: jest.Mocked<Partial<TestPersonCodingService>>;
  const appService = { selectedWorkspaceId: 1 };
  const snackBar = { open: jest.fn() };

  beforeEach(async () => {
    jobs = new Subject();
    groups = new Subject();
    status = new Subject();
    coding = new Subject();
    testPersons = new Subject();
    appService.selectedWorkspaceId = 1;
    snackBar.open.mockClear();
    service = {
      getAllJobs: jest.fn(() => jobs),
      getWorkspaceGroups: jest.fn(() => groups),
      getJobStatus: jest.fn(() => status),
      codeTestPersons: jest.fn(() => coding),
      getCodingStatistics: jest.fn(() => of({ totalResponses: 0, statusCounts: {} })),
      notifyAutoCodingCompleted: jest.fn()
    };
    await TestBed.configureTestingModule({
      imports: [TestPersonCodingComponent, TranslateModule.forRoot()],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: TestPersonCodingService, useValue: service },
        { provide: AppService, useValue: appService },
        { provide: TestResultService, useValue: { getTestPersons: () => testPersons } },
        { provide: BackendMessageTranslatorService, useValue: { translateMessage: (message: string) => message } },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MatDialog, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(TestPersonCodingComponent);
    fixture.autoDetectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());
  const element = (): HTMLElement => fixture.nativeElement;

  it('replaces job loading with delayed rows and enables group selection', async () => {
    expect(element().querySelector('.jobs-card mat-spinner')).not.toBeNull();
    const selectAll = element().querySelector('.group-selection-container button') as HTMLButtonElement;
    expect(selectAll.disabled).toBe(true);
    groups.next([{ groupName: 'delayed-group', testPersonCount: 4, responsesToCode: 10 }]);
    groups.complete();
    jobs.next([{ jobId: 'delayed-job', status: 'processing', progress: 37 }]);
    jobs.complete();
    await fixture.whenStable();
    expect(element().querySelector('.jobs-card mat-spinner')).toBeNull();
    expect(element().querySelector('table')?.textContent).toContain('delayed-job');
    expect(element().querySelector('table')?.textContent).toContain('37%');
    expect(selectAll.disabled).toBe(false);
    const select = element().querySelector('mat-select') as HTMLElement;
    select.click();
    await fixture.whenStable();
    expect(document.querySelector('.cdk-overlay-container')?.textContent).toContain('delayed-group');
  });

  it('renders delayed empty service fallbacks and permits refreshing jobs', async () => {
    // The service converts failed list/group requests into empty arrays.
    jobs.next([]);
    jobs.complete();
    groups.next([]);
    groups.complete();
    await fixture.whenStable();
    expect(element().querySelector('.jobs-card mat-spinner')).toBeNull();
    expect(element().querySelector('.jobs-card .no-data')?.textContent).toContain('test-person-coding.jobs.no-jobs');
    jobs = new Subject();
    (element().querySelector('.jobs-actions button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(element().querySelector('.jobs-card mat-spinner')).not.toBeNull();
    jobs.next([{ jobId: 'retry-job', status: 'pending', progress: 0 }]);
    jobs.complete();
    await fixture.whenStable();
    expect(element().querySelector('table')?.textContent).toContain('retry-job');
  });

  it('renders delayed job submission, polling progress and terminal status automatically', async () => {
    fixture.componentInstance.codeTestPersons('delayed-group');
    await fixture.whenStable();
    const codeAll = element().querySelector('.button-container button:last-child') as HTMLButtonElement;
    expect(codeAll.disabled).toBe(true);
    coding.next({ jobId: 'submitted-job', message: 'started' });
    coding.complete();
    await fixture.whenStable();
    expect(codeAll.disabled).toBe(false);
    status.next({ status: 'processing', progress: 61, groupNames: 'delayed-group' });
    await fixture.whenStable();
    expect(element().querySelector('.job-status-card')?.textContent).toContain('61%');
    expect(element().querySelector('.job-status-card')?.textContent).toContain('delayed-group');
    status.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    expect(element().querySelector('.job-status-card')).toBeNull();
    expect(service.notifyAutoCodingCompleted).toHaveBeenCalledWith('submitted-job');
    expect(snackBar.open).toHaveBeenCalledWith('test-person-coding.job-completed', 'close', { duration: 3000 });
  });

  it('re-enables submission after a delayed error', async () => {
    fixture.componentInstance.codeTestPersons('delayed-group');
    await fixture.whenStable();
    coding.error(new Error('coding timeout'));
    await fixture.whenStable();
    const codeAll = element().querySelector('.button-container button:last-child') as HTMLButtonElement;
    expect(codeAll.disabled).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('test-person-coding.job-error', 'close', { duration: 5000 });
  });

  it('ignores an old job response after switching to another job', async () => {
    const oldStatus = status;
    fixture.componentInstance.startJobStatusPolling('old-job');
    status = new Subject();
    fixture.componentInstance.startJobStatusPolling('new-job');
    status.next({ status: 'processing', progress: 25 });
    await fixture.whenStable();
    oldStatus.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    expect(element().querySelector('.job-status-card')?.textContent).toContain('new-job');
    expect(element().querySelector('.job-status-card')?.textContent).toContain('25%');
    expect(service.notifyAutoCodingCompleted).not.toHaveBeenCalled();
  });

  it('ignores a delayed status from the previous workspace', async () => {
    fixture.componentInstance.startJobStatusPolling('old-workspace-job');
    appService.selectedWorkspaceId = 2;
    status.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    expect(service.notifyAutoCodingCompleted).not.toHaveBeenCalled();
    expect(element().querySelector('.job-status-card')).toBeNull();
  });

  it('keeps newer job and group lists when older refreshes finish later', async () => {
    const oldJobs = jobs;
    const oldGroups = groups;
    jobs = new Subject();
    groups = new Subject();
    fixture.componentInstance.loadAllJobs();
    fixture.componentInstance.loadWorkspaceGroups();
    jobs.next([{ jobId: 'newer-job', status: 'processing', progress: 80 }]);
    jobs.complete();
    groups.next([{ groupName: 'newer-group', testPersonCount: 1, responsesToCode: 2 }]);
    groups.complete();
    await fixture.whenStable();
    oldJobs.next([{ jobId: 'older-job', status: 'pending', progress: 0 }]);
    oldJobs.complete();
    oldGroups.next([]);
    oldGroups.complete();
    await fixture.whenStable();
    expect(element().querySelector('table')?.textContent).toContain('newer-job');
    expect(element().querySelector('table')?.textContent).not.toContain('older-job');
    expect((element().querySelector('.group-selection-container button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ignores a status from an earlier polling session of the same job', async () => {
    const oldStatus = status;
    fixture.componentInstance.startJobStatusPolling('same-job');
    fixture.componentInstance.stopJobStatusPolling();
    status = new Subject();
    fixture.componentInstance.startJobStatusPolling('same-job');
    status.next({ status: 'processing', progress: 20 });
    await fixture.whenStable();
    oldStatus.next({ status: 'completed', progress: 100 });
    await fixture.whenStable();
    expect(element().querySelector('.job-status-card')?.textContent).toContain('20%');
    expect(service.notifyAutoCodingCompleted).not.toHaveBeenCalled();
  });

  it('keeps submission disabled while a delayed test-person lookup starts coding', async () => {
    const codeAll = element().querySelector('.button-container button:last-child') as HTMLButtonElement;
    codeAll.click();
    await fixture.whenStable();
    expect(codeAll.disabled).toBe(true);
    testPersons.next(['person-1']);
    testPersons.complete();
    await fixture.whenStable();
    expect(codeAll.disabled).toBe(true);
    expect(service.codeTestPersons).toHaveBeenCalledWith(1, 'person-1', 1);
    coding.next({ jobId: 'all-persons-job', message: 'started' });
    coding.complete();
    await fixture.whenStable();
    expect(codeAll.disabled).toBe(false);
  });

  it.each(['empty', 'error'])('re-enables coding after a delayed %s test-person lookup', async outcome => {
    const codeAll = element().querySelector('.button-container button:last-child') as HTMLButtonElement;
    codeAll.click();
    await fixture.whenStable();
    if (outcome === 'error') testPersons.error(new Error('lookup timeout'));
    else {
      testPersons.next([]);
      testPersons.complete();
    }
    await fixture.whenStable();
    expect(codeAll.disabled).toBe(false);
    expect(service.codeTestPersons).not.toHaveBeenCalled();
  });

  it('unsubscribes from pending requests when destroyed', async () => {
    fixture.componentInstance.startJobStatusPolling('pending-job');
    fixture.componentInstance.codeTestPersons('delayed-group');
    await fixture.whenStable();
    fixture.destroy();
    expect(jobs.observed).toBe(false);
    expect(groups.observed).toBe(false);
    expect(status.observed).toBe(false);
    expect(coding.observed).toBe(false);
    coding.next({ jobId: 'late-job', message: 'late' });
    expect(service.getJobStatus).toHaveBeenCalledTimes(1);
  });
});
