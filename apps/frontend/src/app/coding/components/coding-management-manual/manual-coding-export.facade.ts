import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY, Observable, catchError, defer, finalize, map, of, switchMap, take
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { ExportJobConfig, ExportJobService } from '../../../shared/services/file/export-job.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { createCompactByVariableExportConfig, requiresWorksheetEstimate } from './manual-coding-export-plan';

export interface ManualExportWorksheetWarning { actual: number; max: number }
export type ManualExportDecision = true | 'compact' | false | undefined;
export type ManualExportOutcome = 'started' | 'estimate-failed';

/** One startup attempt; the root export service owns the resulting background job and polling. */
@Injectable()
export class ManualCodingExportFacade {
  private readonly appService = inject(AppService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly jobs = inject(ExportJobService);
  readonly isStarting = signal(false);
  private active = false;

  start(
    workspaceId: number,
    config: ExportJobConfig,
    choose: (warning: ManualExportWorksheetWarning) => Observable<ManualExportDecision>
  ): Observable<ManualExportOutcome> {
    return defer(() => {
      if (this.active) return EMPTY;
      this.active = true;
      this.isStarting.set(true);
      const preparation = requiresWorksheetEstimate(config) ? this.jobs.estimateJob(workspaceId, {
        ...config, exportType: 'by-variable', doubleCodingMethod: undefined
      }).pipe(
        switchMap(estimate => {
          if (!estimate.exceedsWorksheetLimit || !estimate.worksheetLimit) return of(config);
          this.isStarting.set(false);
          return choose({ actual: estimate.unitVariableCount, max: estimate.worksheetLimit }).pipe(
            take(1),
            switchMap(decision => {
              if (decision === true) return of(config);
              if (decision === 'compact') return of(createCompactByVariableExportConfig(config));
              return EMPTY;
            })
          );
        }),
        catchError(() => of('estimate-failed' as const))
      ) : of(config);
      return preparation.pipe(
        switchMap(prepared => {
          if (prepared === 'estimate-failed') return of(prepared);
          this.isStarting.set(true);
          // The root service already reports job startup failures.
          return this.jobs.startJob(workspaceId, prepared).pipe(map(() => 'started' as const), catchError(() => EMPTY));
        }),
        finalize(() => { this.active = false; this.isStarting.set(false); })
      );
    }).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef));
  }
}
