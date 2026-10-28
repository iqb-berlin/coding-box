import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { ManualCodingSettingsFacade } from './manual-coding-settings.facade';

/** Response-analysis polling and the background guard have distinct lifetimes. */
@Injectable()
export class ManualCodingAnalysisFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly appService = inject(AppService);
  private readonly testPersonCodingService = inject(TestPersonCodingService);
  private readonly codingBackgroundJobsService = inject(CodingBackgroundJobsService);
  private readonly settings = inject(ManualCodingSettingsFacade);
  private readonly snackBar = inject(MatSnackBar);
  // Snapshot settlement follows the final data/error state, independently of navigation.
  private readonly viewUpdatedSubject = new Subject<void>();
  readonly viewUpdated$ = this.viewUpdatedSubject.asObservable();
  private readonly settledSubject = new Subject<void>();
  readonly settled$ = this.settledSubject.asObservable();
  private readonly failedSubject = new Subject<void>();
  readonly failed$ = this.failedSubject.asObservable();
  private readonly reloadRequestedSubject = new Subject<void>();
  readonly reloadRequested$ = this.reloadRequestedSubject.asObservable();
  private isViewActive: () => boolean = () => false;

  setViewActivity(isActive: () => boolean): void { this.isViewActive = isActive; }
  private readonly responseAnalysisState = signal<ResponseAnalysisDto | null>(null);
  readonly responseAnalysis = this.responseAnalysisState.asReadonly();

  private readonly responseAnalysisErrorState = signal<string | null>(null);
  readonly responseAnalysisError = this.responseAnalysisErrorState.asReadonly();

  private readonly isLoadingResponseAnalysisState = signal(false);
  readonly isLoadingResponseAnalysis = this.isLoadingResponseAnalysisState.asReadonly();

  private readonly responseAnalysisRequestCancelSubject = new Subject<void>();
  readonly responseAnalysisRequestCancel$ = this.responseAnalysisRequestCancelSubject.asObservable();

  private responseAnalysisRequestId = 0;

  private analysisPollingTimer?: ReturnType<typeof setTimeout>;

  private guardActive = false;
  get responseAnalysisGuardActive(): boolean { return this.guardActive; }

  private responseAnalysisGuardWorkspaceId: number | null = null;

  private hasShownResponseAnalysisPollingError = false;

  private readonly emptyPageIndexState = signal(0);
  readonly emptyPageIndex = this.emptyPageIndexState.asReadonly();

  private readonly emptyPageSizeState = signal(5);
  readonly emptyPageSize = this.emptyPageSizeState.asReadonly();

  private readonly duplicatePageIndexState = signal(0);
  readonly duplicatePageIndex = this.duplicatePageIndexState.asReadonly();

  private readonly duplicatePageSizeState = signal(50);
  readonly duplicatePageSize = this.duplicatePageSizeState.asReadonly();

  restoreAnalysis(analysis: ResponseAnalysisDto | null, error: string | null = null): void {
    this.responseAnalysisState.set(analysis);
    this.responseAnalysisErrorState.set(error);
  }

  beginAnalysis(): void {
    this.isLoadingResponseAnalysisState.set(true);
    this.responseAnalysisErrorState.set(null);
  }

  analysisStartFailed(): void { this.isLoadingResponseAnalysisState.set(false); }

  resetPages(): void {
    this.emptyPageIndexState.set(0);
    this.duplicatePageIndexState.set(0);
  }

  changeEmptyPage(index: number, size: number): void {
    this.emptyPageIndexState.set(index);
    this.emptyPageSizeState.set(size);
  }

  changeDuplicatePage(index: number, size: number): void {
    this.duplicatePageIndexState.set(index);
    this.duplicatePageSizeState.set(size);
  }

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) { this.stop(); this.responseAnalysisState.set(null); this.responseAnalysisErrorState.set(null); workspaceId = id; }
    });
    this.destroyRef.onDestroy(() => {
      this.cancelResponseAnalysisRequest();
      this.finalizeResponseAnalysisGuardOnDestroy();
      this.responseAnalysisRequestCancelSubject.complete();
      this.viewUpdatedSubject.complete(); this.settledSubject.complete(); this.failedSubject.complete(); this.reloadRequestedSubject.complete();
    });
  }

  stop(): void {
    this.cancelResponseAnalysisRequest();
    this.handOffResponseAnalysisGuardUntilComplete();
  }

  cancelResponseAnalysisRequest(
    options: { markNotLoading?: boolean } = {}
  ): void {
    this.responseAnalysisRequestId += 1;
    if (this.analysisPollingTimer) {
      clearTimeout(this.analysisPollingTimer);
      this.analysisPollingTimer = undefined;
    }
    this.responseAnalysisRequestCancelSubject.next();
    if (options.markNotLoading !== false) {
      this.isLoadingResponseAnalysisState.set(false);
    }
  }

  shouldAcceptResponseAnalysisResult(
    requestId: number,
    workspaceId: number
  ): boolean {
    return !this.destroyRef.destroyed && requestId === this.responseAnalysisRequestId &&
      this.appService.selectedWorkspaceId === workspaceId &&
      this.isViewActive();
  }

  handOffResponseAnalysisGuardUntilComplete(): void {
    if (!this.responseAnalysisGuardActive) {
      return;
    }

    this.trackManualResponseAnalysisGuardUntilComplete(
      this.responseAnalysisGuardWorkspaceId || this.appService.selectedWorkspaceId,
      this.settings.normalizeAggregationThreshold(this.settings.duplicateAggregationThreshold())
    );
    this.guardActive = false;
    this.responseAnalysisGuardWorkspaceId = null;
  }

  setManualResponseAnalysisGuardRunning(
    workspaceId: number,
    isActive: boolean
  ): void {
    const guardService = this.testPersonCodingService as unknown as {
      setResponseAnalysisGuardRunning?: (
        guardedWorkspaceId: number,
        guardedIsActive: boolean
      ) => void;
    };

    if (guardService.setResponseAnalysisGuardRunning) {
      guardService.setResponseAnalysisGuardRunning(workspaceId, isActive);
      return;
    }

    this.codingBackgroundJobsService.setJobRunning(
      workspaceId,
      'response-analysis',
      isActive,
      'manual-response-analysis'
    );
  }

  trackManualResponseAnalysisGuardUntilComplete(
    workspaceId: number | null | undefined,
    threshold: number
  ): void {
    if (!workspaceId) {
      return;
    }

    const guardService = this.testPersonCodingService as unknown as {
      trackResponseAnalysisGuardUntilComplete?: (
        guardedWorkspaceId: number,
        guardedThreshold?: number
      ) => void;
    };

    if (guardService.trackResponseAnalysisGuardUntilComplete) {
      guardService.trackResponseAnalysisGuardUntilComplete(workspaceId, threshold);
      return;
    }

    this.setManualResponseAnalysisGuardRunning(workspaceId, true);
  }

  setResponseAnalysisGuardActive(isActive: boolean): void {
    if (!isActive && !this.responseAnalysisGuardActive) {
      return;
    }

    const workspaceId = isActive ?
      this.appService.selectedWorkspaceId :
      this.responseAnalysisGuardWorkspaceId;
    if (!workspaceId ||
      (this.guardActive === isActive &&
        this.responseAnalysisGuardWorkspaceId === workspaceId)) {
      return;
    }

    if (isActive &&
      this.responseAnalysisGuardActive &&
      this.responseAnalysisGuardWorkspaceId &&
      this.responseAnalysisGuardWorkspaceId !== workspaceId) {
      this.setManualResponseAnalysisGuardRunning(
        this.responseAnalysisGuardWorkspaceId,
        false
      );
    }

    this.guardActive = isActive;
    this.responseAnalysisGuardWorkspaceId = isActive ? workspaceId : null;
    this.setManualResponseAnalysisGuardRunning(
      workspaceId,
      isActive
    );
  }

  finalizeResponseAnalysisGuardOnDestroy(): void {
    if (!this.responseAnalysisGuardActive) {
      return;
    }

    this.trackManualResponseAnalysisGuardUntilComplete(
      this.responseAnalysisGuardWorkspaceId || this.appService.selectedWorkspaceId,
      this.settings.normalizeAggregationThreshold(this.settings.duplicateAggregationThreshold())
    );
  }

  shouldKeepResponseAnalysisGuardAfterPollingError(
    workspaceId: number
  ): boolean {
    return this.responseAnalysisGuardActive &&
      this.responseAnalysisGuardWorkspaceId === workspaceId;
  }

  scheduleResponseAnalysisPollingRetry(workspaceId: number): void {
    if (this.analysisPollingTimer) {
      clearTimeout(this.analysisPollingTimer);
    }

    this.analysisPollingTimer = setTimeout(() => {
      this.analysisPollingTimer = undefined;
      if (this.shouldKeepResponseAnalysisGuardAfterPollingError(workspaceId)) {
        this.reloadRequestedSubject.next();
      }
    }, 5000);
  }

  loadResponseAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.cancelResponseAnalysisRequest();
      this.setResponseAnalysisGuardActive(false);
      this.isLoadingResponseAnalysisState.set(false);
      return;
    }

    if (!this.isViewActive()) {
      this.stop();
      return;
    }

    this.cancelResponseAnalysisRequest({
      markNotLoading: false
    });
    const requestId = this.responseAnalysisRequestId + 1;
    this.responseAnalysisRequestId = requestId;
    this.isLoadingResponseAnalysisState.set(true);
    this.responseAnalysisErrorState.set(null);
    this.testPersonCodingService
      .getResponseAnalysis(
        workspaceId,
        this.settings.normalizeAggregationThreshold(this.settings.duplicateAggregationThreshold()),
        this.emptyPageIndex() + 1,
        this.emptyPageSize(),
        this.duplicatePageIndex() + 1,
        this.duplicatePageSize()
      )
      .pipe(
        takeUntil(this.responseAnalysisRequestCancel$),
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (analysis: ResponseAnalysisDto & { isCalculating?: boolean }) => {
          if (!this.shouldAcceptResponseAnalysisResult(requestId, workspaceId)) {
            return;
          }

          this.responseAnalysisState.set(analysis);
          this.responseAnalysisErrorState.set(null);
          this.isLoadingResponseAnalysisState.set(false);
          this.hasShownResponseAnalysisPollingError = false;
          this.setResponseAnalysisGuardActive(analysis.isCalculating === true);
          this.viewUpdatedSubject.next();

          if (analysis.isCalculating) {
            // Poll every 5 seconds if calculating
            this.analysisPollingTimer = setTimeout(() => {
              this.analysisPollingTimer = undefined;
              if (this.responseAnalysis()?.isCalculating &&
                this.shouldAcceptResponseAnalysisResult(requestId, workspaceId)) {
                this.reloadRequestedSubject.next();
              }
            }, 5000);
          }
          this.settledSubject.next();
        },
        error: error => {
          if (!this.shouldAcceptResponseAnalysisResult(requestId, workspaceId)) {
            return;
          }

          this.isLoadingResponseAnalysisState.set(false);
          this.viewUpdatedSubject.next();
          const responseAnalysisError = `Fehler beim Laden der Antwortanalyse: ${error.message || error}`;
          if (this.shouldKeepResponseAnalysisGuardAfterPollingError(workspaceId)) {
            if (!this.hasShownResponseAnalysisPollingError) {
              this.hasShownResponseAnalysisPollingError = true;
              this.snackBar.open(
                responseAnalysisError,
                'OK',
                { duration: 3000 }
              );
            }
            this.scheduleResponseAnalysisPollingRetry(workspaceId);
            return;
          }

          this.setResponseAnalysisGuardActive(false);
          this.responseAnalysisState.set(null);
          this.responseAnalysisErrorState.set(responseAnalysisError);
          this.failedSubject.next();
          this.settledSubject.next();
          this.snackBar.open(
            responseAnalysisError,
            'OK',
            { duration: 3000 }
          );
        }
      });
  }
}
