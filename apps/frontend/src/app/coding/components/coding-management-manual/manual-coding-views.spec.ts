import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CodingJob } from '../../models/coding-job.model';
import { AppliedResultsOverview, CodingProgressOverview } from '../../services/test-person-coding.service';
import { ManualCodingCompletionFacade } from './manual-coding-completion.facade';
import { ManualCodingCompletionViewComponent } from './manual-coding-completion-view.component';
import { ManualCodingExecutionViewComponent } from './manual-coding-execution-view.component';
import { ManualCodingStatisticsFacade } from './manual-coding-statistics.facade';
import { ManualCodingSummaryFacade } from './manual-coding-summary.facade';
import { ManualCodingViewState } from './manual-coding-view-state.service';

describe('Manual coding views without their coordinating component', () => {
  it('renders delayed progress and preserves expanded details when a tab is remounted', async () => {
    const progress = signal<CodingProgressOverview | null>(null);
    TestBed.configureTestingModule({
      imports: [ManualCodingExecutionViewComponent, TranslateModule.forRoot()],
      providers: [
        ManualCodingViewState,
        {
          provide: ManualCodingStatisticsFacade,
          useValue: {
            codingProgressOverview: progress,
            manualCodingScopeSummary: signal(null),
            codingIncompleteVariables: signal([]),
            isLoadingCodingProgress: signal(false)
          }
        },
        { provide: ManualCodingSummaryFacade, useValue: { getVariableEffectiveCaseCount: () => 0 } }
      ]
    });
    let fixture = TestBed.createComponent(ManualCodingExecutionViewComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.coding-progress-section')).toBeNull();
    progress.set({
      totalCasesToCode: 10,
      completedCases: 4,
      completionPercentage: 40,
      rawTotalCasesToCode: 10,
      rawCompletedCases: 4,
      rawCompletionPercentage: 40,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    });
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.stat-value.percentage').textContent).toContain('40');
    fixture.nativeElement.querySelector('.section-info-button').click();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-info')).not.toBeNull();
    fixture.destroy();
    fixture = TestBed.createComponent(ManualCodingExecutionViewComponent);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.progress-info')).not.toBeNull();
  });

  it('emits completion actions and updates apply controls when permission or loading changes', async () => {
    const job: CodingJob = {
      id: 9,
      workspace_id: 1,
      name: 'Completed job',
      status: 'completed',
      created_at: new Date(),
      updated_at: new Date(),
      assignedCoders: [],
      codedUnits: 4,
      totalUnits: 4
    };
    const applying = signal(false);
    const applied = signal<AppliedResultsOverview>({
      totalIncompleteResponses: 4,
      appliedResponses: 0,
      remainingResponses: 4,
      completionPercentage: 0,
      rawTotalIncompleteResponses: 4,
      rawAppliedResponses: 0,
      rawRemainingResponses: 4,
      rawCompletionPercentage: 0,
      aggregationActive: false,
      aggregationThreshold: null,
      aggregatedDuplicateCases: 0
    });
    TestBed.configureTestingModule({
      imports: [ManualCodingCompletionViewComponent, TranslateModule.forRoot()],
      providers: [
        ManualCodingViewState,
        {
          provide: ManualCodingStatisticsFacade,
          useValue: {
            appliedResultsOverview: applied,
            completedJobsReadyForApply: signal([job]),
            completedJobsBlockedForReview: signal([]),
            isLoadingCompletedJobsReadyForApply: signal(false)
          }
        },
        {
          provide: ManualCodingCompletionFacade,
          useValue: { isApplyingCodingResults: applying, isApplyingJobResults: () => false }
        },
        {
          provide: ManualCodingSummaryFacade,
          useValue: {
            effectiveCodingCases: signal(4),
            aggregationSavings: signal(0),
            hasDeriveErrorManualCases: signal(false),
            deriveErrorAppliedCases: signal(0),
            deriveErrorManualCases: signal(0),
            deriveErrorRemainingCases: signal(0),
            isCompletionComplete: signal(false),
            hasCompletedJobsReadyForApply: signal(true),
            hasCompletedJobsBlockedForReview: signal(false),
            hasExecutionOpenWork: signal(false)
          }
        }
      ]
    });
    const fixture = TestBed.createComponent(ManualCodingCompletionViewComponent);
    const applyAll = jest.fn();
    const applyJob = jest.fn();
    fixture.componentInstance.applyAllRequested.subscribe(applyAll);
    fixture.componentInstance.jobApplyRequested.subscribe(applyJob);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('button[mat-raised-button]')).toBeNull();
    fixture.componentRef.setInput('canApplyCompletedJobResults', true);
    await fixture.whenStable();
    const allButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[mat-raised-button]');
    allButton.click();
    const jobButton: HTMLButtonElement = fixture.nativeElement.querySelector('.completed-job-apply-row button');
    jobButton.click();
    expect(applyAll).toHaveBeenCalledTimes(1);
    expect(applyJob).toHaveBeenCalledWith(job);
    applying.set(true);
    await fixture.whenStable();
    expect(allButton.disabled).toBe(true);
    expect(jobButton.disabled).toBe(true);
  });
});
