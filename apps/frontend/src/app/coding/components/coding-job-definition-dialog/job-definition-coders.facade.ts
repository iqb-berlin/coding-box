import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { SelectionModel } from '@angular/cdk/collections';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY, Subject, catchError, defer, finalize, switchMap, tap
} from 'rxjs';
import { Coder } from '../../models/coder.model';
import { JobDefinitionCoderConfig } from '../../models/coding-job.model';
import { CoderService } from '../../services/coder.service';
import { DistributionPreviewCoder } from '../../services/distributed-coding.service';
import { CodingJobDefinitionDialogData } from './coding-job-definition.models';
import { CodingJobDefinitionRules } from './coding-job-definition-rules';

type CoderContext = Pick<CodingJobDefinitionDialogData, 'isEdit' | 'codingJob'>;

/** Coder catalog, assignment selection and capacities owned by one dialog. */
@Injectable()
export class JobDefinitionCodersFacade {
  private readonly service = inject(CoderService);
  private readonly rules = new CodingJobDefinitionRules();
  private readonly availableState = signal<Coder[]>([]);
  private readonly assignedState = signal<Coder[]>([]);
  private readonly loadingAvailableState = signal(false);
  private readonly loadingAssignedState = signal(false);
  private readonly selectionState = signal(this.createSelection());
  private readonly availableRequests = new Subject<CoderContext>();
  private readonly assignedRequests = new Subject<number>();
  private readonly changed = new Subject<void>();
  private readonly availableFinished = new Subject<void>();
  private availableGeneration = 0;
  private selectionSubscription = this.selectionState().changed.subscribe(() => this.changed.next());

  readonly available = this.availableState.asReadonly();
  readonly assigned = this.assignedState.asReadonly();
  readonly isLoadingAvailable = this.loadingAvailableState.asReadonly();
  readonly isLoadingAssigned = this.loadingAssignedState.asReadonly();
  // The CDK model remains the view's selection API; replacing it detaches old listeners.
  readonly selection = this.selectionState.asReadonly();
  readonly changed$ = this.changed.asObservable();
  readonly availableFinished$ = this.availableFinished.asObservable();

  constructor() {
    this.availableRequests.pipe(
      switchMap(context => defer(() => {
        this.availableGeneration += 1;
        const generation = this.availableGeneration;
        this.loadingAvailableState.set(true);
        return this.service.getCoders().pipe(
          tap(coders => {
            this.availableState.set(coders.map(coder => ({
              ...coder,
              capacityPercent: this.rules.normalizeCoderCapacityPercent(context.codingJob?.assignedCoderConfigs
                ?.find(config => config.coderId === coder.id)?.capacityPercent)
            })));
            this.loadingAvailableState.set(false);
            const assignedIds = context.isEdit && context.codingJob?.assignedCoders ?
              context.codingJob.assignedCoders : this.assignedState().map(coder => coder.id);
            this.replaceSelection(this.available().filter(coder => assignedIds.includes(coder.id)));
            this.availableFinished.next();
          }),
          catchError(() => {
            this.loadingAvailableState.set(false);
            this.availableFinished.next();
            return EMPTY;
          }),
          finalize(() => {
            if (generation === this.availableGeneration) this.loadingAvailableState.set(false);
          })
        );
      })),
      takeUntilDestroyed()
    ).subscribe();
    this.assignedRequests.pipe(
      switchMap(jobId => defer(() => {
        this.loadingAssignedState.set(true);
        return this.service.getCodersByJobId(jobId).pipe(
          tap(coders => {
            this.assignedState.set(coders);
            this.loadingAssignedState.set(false);
            const ids = coders.map(coder => coder.id);
            this.replaceSelection(this.available().filter(coder => ids.includes(coder.id)));
          }),
          catchError(() => EMPTY),
          finalize(() => this.loadingAssignedState.set(false))
        );
      })),
      takeUntilDestroyed()
    ).subscribe();
    inject(DestroyRef).onDestroy(() => {
      this.selectionSubscription.unsubscribe();
      this.availableRequests.complete();
      this.assignedRequests.complete();
      this.changed.complete();
      this.availableFinished.complete();
    });
  }

  loadAvailable(context: CoderContext): void { this.availableRequests.next(context); }

  loadAssigned(jobId: number): void { this.assignedRequests.next(jobId); }

  capacityPercent(coder: Coder): number {
    return this.rules.normalizeCoderCapacityPercent(coder.capacityPercent);
  }

  updateCapacity(coder: Coder, value: unknown): void {
    const capacityPercent = this.rules.normalizeCoderCapacityPercent(value);
    this.availableState.update(coders => coders.map(candidate => (candidate.id === coder.id ?
      { ...candidate, capacityPercent } : candidate)));
    const updatedCoder = this.available().find(candidate => candidate.id === coder.id);
    this.replaceSelection(this.selection().selected.map(candidate => (candidate.id === coder.id ?
      updatedCoder || { ...candidate, capacityPercent } : candidate)));
  }

  restore(configs: JobDefinitionCoderConfig[]): void {
    const capacities = new Map(configs.map(config => [
      config.coderId, this.rules.normalizeCoderCapacityPercent(config.capacityPercent)
    ]));
    this.availableState.update(coders => coders.map(coder => ({
      ...coder, capacityPercent: capacities.get(coder.id) ?? this.capacityPercent(coder)
    })));
    this.replaceSelection(this.available().filter(coder => capacities.has(coder.id)));
  }

  selectedConfigs(): JobDefinitionCoderConfig[] {
    return this.selection().selected.map(coder => ({ coderId: coder.id, capacityPercent: this.capacityPercent(coder) }));
  }

  selectedCoders(): Coder[] {
    return this.selection().selected.map(coder => ({ ...coder, capacityPercent: this.capacityPercent(coder) }));
  }

  distributionCoders(coders = this.selection().selected): DistributionPreviewCoder[] {
    return coders.map(coder => ({
      id: coder.id, name: coder.name, username: coder.name, capacityPercent: this.capacityPercent(coder)
    }));
  }

  private createSelection(coders: Coder[] = []): SelectionModel<Coder> {
    return new SelectionModel<Coder>(true, coders, true, (first, second) => first.id === second.id);
  }

  private replaceSelection(coders: Coder[]): void {
    this.selectionSubscription.unsubscribe();
    const selection = this.createSelection(coders);
    this.selectionState.set(selection);
    this.selectionSubscription = selection.changed.subscribe(() => this.changed.next());
    this.changed.next();
  }
}
