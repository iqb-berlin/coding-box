import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, takeUntil } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import { ResponseAnalysisDto } from '../../../../../../../api-dto/coding/response-analysis.dto';
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
  readonly viewUpdated$ = new Subject<void>();
  readonly settled$ = new Subject<void>();
  readonly failed$ = new Subject<void>();
  readonly reloadRequested$ = new Subject<void>();
  isViewActive: () => boolean = () => false;
  readonly responseAnalysis = signal<ResponseAnalysisDto | null>(null);

  readonly responseAnalysisError = signal<string | null>(null);

  readonly isLoadingResponseAnalysis = signal(false);

  readonly responseAnalysisRequestCancel$ = new Subject<void>();

  responseAnalysisRequestId = 0;

  analysisPollingTimer?: ReturnType<typeof setTimeout>;

  responseAnalysisGuardActive = false;

  responseAnalysisGuardWorkspaceId: number | null = null;

  hasShownResponseAnalysisPollingError = false;

  readonly emptyPageIndex = signal(0);

  readonly emptyPageSize = signal(5);

  readonly duplicatePageIndex = signal(0);

  readonly duplicatePageSize = signal(50);

  constructor() {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$?.pipe(takeUntilDestroyed()).subscribe(id => {
      if (id !== workspaceId) { this.stop(); this.responseAnalysis.set(null); this.responseAnalysisError.set(null); workspaceId = id; }
    });
    this.destroyRef.onDestroy(() => {
      this.cancelResponseAnalysisRequest();
      this.finalizeResponseAnalysisGuardOnDestroy();
      this.responseAnalysisRequestCancel$.complete();
      this.viewUpdated$.complete(); this.settled$.complete(); this.failed$.complete(); this.reloadRequested$.complete();
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
    this.responseAnalysisRequestCancel$.next();
    if (options.markNotLoading !== false) {
      this.isLoadingResponseAnalysis.set(false);
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
    this.responseAnalysisGuardActive = false;
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
      (this.responseAnalysisGuardActive === isActive &&
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

    this.responseAnalysisGuardActive = isActive;
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
        this.reloadRequested$.next();
      }
    }, 5000);
  }

  loadResponseAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.cancelResponseAnalysisRequest();
      this.setResponseAnalysisGuardActive(false);
      this.isLoadingResponseAnalysis.set(false);
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
    this.isLoadingResponseAnalysis.set(true);
    this.responseAnalysisError.set(null);
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

          this.responseAnalysis.set(analysis);
          this.responseAnalysisError.set(null);
          this.isLoadingResponseAnalysis.set(false);
          this.hasShownResponseAnalysisPollingError = false;
          this.setResponseAnalysisGuardActive(analysis.isCalculating === true);
          this.viewUpdated$.next();

          if (analysis.isCalculating) {
            // Poll every 5 seconds if calculating
            this.analysisPollingTimer = setTimeout(() => {
              this.analysisPollingTimer = undefined;
              if (this.responseAnalysis()?.isCalculating &&
                this.shouldAcceptResponseAnalysisResult(requestId, workspaceId)) {
                this.reloadRequested$.next();
              }
            }, 5000);
          }
          this.settled$.next();
        },
        error: error => {
          if (!this.shouldAcceptResponseAnalysisResult(requestId, workspaceId)) {
            return;
          }

          this.isLoadingResponseAnalysis.set(false);
          this.viewUpdated$.next();
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
          this.responseAnalysis.set(null);
          this.responseAnalysisError.set(responseAnalysisError);
          this.failed$.next();
          this.settled$.next();
          this.snackBar.open(
            responseAnalysisError,
            'OK',
            { duration: 3000 }
          );
        }
      });
  }
}
