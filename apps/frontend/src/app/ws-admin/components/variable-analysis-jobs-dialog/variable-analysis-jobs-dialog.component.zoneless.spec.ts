import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';
import { VariableAnalysisService, JobCancelResult } from '../../../shared/services/response/variable-analysis.service';
import { VariableAnalysisJobsDialogComponent } from './variable-analysis-jobs-dialog.component';

const job: VariableAnalysisJobDto = {
  id: 41,
  workspace_id: 17,
  type: 'variable-analysis',
  status: 'pending',
  created_at: new Date('2026-10-04T10:00:00Z'),
  updated_at: new Date('2026-10-04T10:00:00Z')
};

describe('OnPush analysis jobs without Zone.js', () => {
  let fixture: ComponentFixture<VariableAnalysisJobsDialogComponent>;
  let response: Subject<VariableAnalysisJobDto[]>;
  let cancellation: Subject<JobCancelResult>;
  let getAllJobs: jest.Mock;
  let cancelJob: jest.Mock;
  const data = { workspaceId: 17, jobs: [job] };

  beforeEach(async () => {
    response = new Subject<VariableAnalysisJobDto[]>();
    cancellation = new Subject<JobCancelResult>();
    getAllJobs = jest.fn(() => response);
    cancelJob = jest.fn(() => cancellation);
    await TestBed.configureTestingModule({
      imports: [VariableAnalysisJobsDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: VariableAnalysisService, useValue: { getAllJobs, cancelJob } }
      ]
    }).compileComponents();
    fixture = TestBed.createComponent(VariableAnalysisJobsDialogComponent);
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it('renders a delayed filtered response and a subsequent empty response without mutating the caller data', async () => {
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    response.next([{ ...job, status: 'completed' }, { ...job, id: 42, type: 'other' }]);
    response.complete();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('completed');
    expect(fixture.nativeElement.querySelectorAll('tr.mat-mdc-row')).toHaveLength(1);
    expect(data.jobs).toEqual([job]);
    const empty = new Subject<VariableAnalysisJobDto[]>();
    getAllJobs.mockReturnValue(empty);
    (fixture.nativeElement.querySelector('.actions-container button') as HTMLButtonElement).click();
    await fixture.whenStable();
    empty.next([]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('.empty-state')).not.toBeNull();
  });

  it('stops loading after a delayed failure and permits a successful retry', async () => {
    response.error(new Error('Unavailable'));
    await fixture.whenStable();
    const refresh = fixture.nativeElement.querySelector('.actions-container button') as HTMLButtonElement;
    expect(refresh.disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    const retry = new Subject<VariableAnalysisJobDto[]>();
    getAllJobs.mockReturnValue(retry);
    refresh.click();
    await fixture.whenStable();
    retry.next([{ ...job, status: 'completed' }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('completed');
  });

  it('refreshes visible status after a delayed successful cancellation', async () => {
    response.next([job]);
    response.complete();
    await fixture.whenStable();
    const refreshed = new Subject<VariableAnalysisJobDto[]>();
    getAllJobs.mockReturnValue(refreshed);
    (fixture.nativeElement.querySelector('.mat-column-actions button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(cancelJob).toHaveBeenCalledWith(17, 41);
    expect(fixture.nativeElement.querySelector('.loading-container')).not.toBeNull();
    cancellation.next({ success: true, message: 'Cancelled' });
    await fixture.whenStable();
    refreshed.next([{ ...job, status: 'cancelled' }]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.loading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('cancelled');
  });

  it('unsubscribes requests on destruction and avoids a refresh after a late cancellation', async () => {
    fixture.componentInstance.cancelJob(41);
    fixture.destroy();
    expect(response.observed).toBe(false);
    expect(cancellation.observed).toBe(false);
    cancellation.next({ success: true });
    expect(getAllJobs).toHaveBeenCalledTimes(1);
  });

  it('discards a superseded refresh response', async () => {
    const newer = new Subject<VariableAnalysisJobDto[]>();
    getAllJobs.mockReturnValue(newer);
    fixture.componentInstance.refreshJobs();
    newer.next([{ ...job, status: 'completed' }]);
    response.next([job]);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('tr.mat-mdc-row')?.textContent).toContain('completed');
    expect(response.observed).toBe(false);
  });
});
