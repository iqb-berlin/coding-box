import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Subject, catchError, defer, map, of, switchMap, timer
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import {
  DistributedCodingService, DistributionCalculationResponse, DistributionPreviewCoder,
  DistributionVariable, DistributionVariableBundle
} from '../../services/distributed-coding.service';
import { DistributionPreviewSummary } from './coding-workload';

export interface JobDistributionPreviewRequest {
  variables: DistributionVariable[];
  coders: DistributionPreviewCoder[];
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  bundles: DistributionVariableBundle[];
  caseOrderingMode?: 'continuous' | 'alternating';
  maxCodingCases?: number;
  distributionSeed: string;
}

/** Debounced, replaceable previews; form and selection ownership stay with the view. */
@Injectable()
export class JobDistributionPreviewFacade {
  private readonly backend = inject(DistributedCodingService);
  private readonly app = inject(AppService);
  private readonly summaryState = signal<DistributionPreviewSummary | null>(null);
  private readonly requests = new Subject<{
    workspaceId: number;
    readRequest: () => JobDistributionPreviewRequest | null;
  }>();

  readonly summary = this.summaryState.asReadonly();

  constructor() {
    this.requests.pipe(
      // Replace immediately, then debounce the next request. debounceTime before
      // switchMap would leave the old HTTP subscription alive for another 300 ms.
      switchMap(({ workspaceId, readRequest }) => timer(300).pipe(
        switchMap(() => defer(() => {
          const request = readRequest();
          if (!request || !workspaceId) return of(null);
          return this.backend.calculateDistribution(
            workspaceId, request.variables, request.coders, request.doubleCodingAbsolute, request.doubleCodingPercentage, request.bundles, request.caseOrderingMode, request.maxCodingCases, request.distributionSeed
          ).pipe(map(preview => this.summarize(preview)), catchError(() => of(null)));
        })),
        takeUntilWorkspaceChanged(this.app, workspaceId)
      )),
      takeUntilDestroyed()
    ).subscribe(summary => this.summaryState.set(summary));
  }

  refresh(workspaceId: number, readRequest: () => JobDistributionPreviewRequest | null): void {
    this.summaryState.set(null);
    this.requests.next({ workspaceId, readRequest });
  }

  private summarize(preview: DistributionCalculationResponse): DistributionPreviewSummary {
    return Object.values(preview.doubleCodingInfo || {}).reduce(
      (summary, info) => {
        const distinctCases = Number(info.distinctCases);
        const doubleCodedCases = Number(info.doubleCodedCases || 0);
        const singleCodedCasesAssigned = Number(info.singleCodedCasesAssigned);
        const totalCases = Number.isFinite(distinctCases) ?
          distinctCases : doubleCodedCases + (Number.isFinite(singleCodedCasesAssigned) ? singleCodedCasesAssigned : 0);
        const codingTasksTotal = Number(info.codingTasksTotal);
        summary.totalCases += totalCases;
        summary.doubleCodedCases += doubleCodedCases;
        summary.totalCodingTasks += Number.isFinite(codingTasksTotal) ? codingTasksTotal : totalCases + doubleCodedCases;
        return summary;
      },
      {
        totalCases: 0, doubleCodedCases: 0, totalCodingTasks: 0, tasksPerCoder: preview.tasksPerCoder
      } as DistributionPreviewSummary
    );
  }
}
