import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import type { CodingJob } from '../../models/coding-job.model';
import type { ApplyCodingResultsResponse } from '../../services/coding-job-backend.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { ManualCodingCompletionFacade } from './manual-coding-completion.facade';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';

describe('ManualCodingCompletionFacade', () => {
  const job: CodingJob = {
    id: 7,
    workspace_id: 5,
    name: 'Ready job',
    status: 'completed',
    created_at: new Date(),
    updated_at: new Date(),
    assignedCoders: []
  };
  let facade: ManualCodingCompletionFacade;
  let confirmation: Subject<{ overwriteExisting: boolean }>;
  let result: Subject<ApplyCodingResultsResponse>;
  let apply: jest.Mock;
  let dismiss: jest.Mock;
  let app: { selectedWorkspaceId: number; selectedWorkspaceId$: BehaviorSubject<number> };

  beforeEach(() => {
    confirmation = new Subject(); result = new Subject();
    apply = jest.fn().mockReturnValue(result); dismiss = jest.fn();
    app = { selectedWorkspaceId: 5, selectedWorkspaceId$: new BehaviorSubject(5) };
    TestBed.configureTestingModule({
      providers: [ManualCodingCompletionFacade,
        { provide: AppService, useValue: app },
        { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => confirmation }) } },
        { provide: MatSnackBar, useValue: { open: () => ({ dismiss }) } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
        { provide: CodingJobBackendService, useValue: { applyCodingResults: apply } },
        { provide: ManualCodingStatisticsFacade, useValue: { completedJobsReadyForApply: () => [job] } }]
    });
    facade = TestBed.inject(ManualCodingCompletionFacade);
  });

  it('applies a confirmed result and emits refresh only after a successful response', () => {
    const applied = jest.fn(); facade.resultsApplied$.subscribe(applied);
    facade.applyCompletedJobResults(job, () => true);
    expect(apply).not.toHaveBeenCalled();
    confirmation.next({ overwriteExisting: false }); confirmation.complete();
    expect(apply).toHaveBeenCalledWith(5, 7, { overwriteExisting: false });
    expect(facade.isApplyingJobResults(7)).toBe(true);
    result.next({ success: true, updatedResponsesCount: 3 } as ApplyCodingResultsResponse); result.complete();
    expect(applied).toHaveBeenCalledTimes(1);
    expect(facade.isApplyingCodingResults()).toBe(false);
    expect(dismiss).toHaveBeenCalled();
  });

  it('does not apply a confirmation after an A to B to A workspace change', () => {
    facade.applyCompletedJobResults(job, () => true);
    app.selectedWorkspaceId = 6; app.selectedWorkspaceId$.next(6);
    app.selectedWorkspaceId = 5; app.selectedWorkspaceId$.next(5);
    confirmation.next({ overwriteExisting: true });
    expect(apply).not.toHaveBeenCalled();
  });

  it('rechecks permission after confirmation and cancels pending work on destruction', () => {
    let allowed = true;
    facade.applyCompletedJobResults(job, () => allowed);
    allowed = false; confirmation.next({ overwriteExisting: false });
    expect(apply).not.toHaveBeenCalled();
    confirmation.complete();
    confirmation = new Subject();
    allowed = true;
    facade.applyCompletedJobResults(job, () => allowed);
    confirmation.next({ overwriteExisting: false }); confirmation.complete();
    expect(result.observed).toBe(true);
    TestBed.resetTestingModule();
    expect(result.observed).toBe(false);
    expect(facade.isApplyingCodingResults()).toBe(false);
  });
});
