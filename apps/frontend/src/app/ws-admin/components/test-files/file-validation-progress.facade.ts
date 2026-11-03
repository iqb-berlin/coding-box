import {
  DestroyRef, Injectable, computed, inject, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Observable, Subject, defer, exhaustMap, filter, of, take, takeUntil, tap, timer
} from 'rxjs';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { AppService } from '../../../core/services/app.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';

export interface ValidationProgressStep {
  threshold: number;
  label: string;
}

const STEPS = [
  [0, 'checking-changes'], [3, 'preparing'], [8, 'load-exclusions'], [12, 'analyze-booklets'],
  [22, 'unit-references'], [30, 'load-resources'], [38, 'xml-schemas'], [48, 'coding-schemes'],
  [55, 'process-test-takers'], [84, 'unused-files'], [88, 'duplicate-test-takers'],
  [90, 'person-status'], [92, 'geogebra-units'], [94, 'geogebra-package'],
  [98, 'prepare-result'], [100, 'completed']
] as const;

/** Owns bounded validation polling, progress and its localized presentation. */
@Injectable()
export class FileValidationProgressFacade {
  private readonly backend = inject(ValidationService);
  private readonly app = inject(AppService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = injectUiTranslator();
  private readonly progressState = signal(0);
  private readonly serverMessage = signal('');
  private readonly overrideMessage = signal('');
  private readonly replaced = new Subject<void>();
  readonly progress = this.progressState.asReadonly();
  readonly message = computed(() => {
    if (this.overrideMessage()) return this.overrideMessage();
    if (this.serverMessage()) return `${this.progress()}% - ${this.serverMessage()}`;
    return this.translate(this.progress() >= 100 ?
      'test-files.validation.loading-result' : 'test-files.validation.in-progress', { progress: this.progress() });
  });

  readonly steps = computed<ValidationProgressStep[]>(() => STEPS.map(([threshold, key]) => ({
    threshold, label: this.translate(`test-files.validation.steps.${key}`)
  })));

  constructor() {
    this.destroyRef.onDestroy(() => this.replaced.complete());
  }

  start(message: string): void {
    this.replaced.next();
    this.progressState.set(0);
    this.serverMessage.set('');
    this.overrideMessage.set(message);
  }

  finish(message?: string): void {
    this.progressState.set(100);
    this.serverMessage.set('');
    this.overrideMessage.set(message || '');
  }

  accept(task: ValidationTaskDto): void {
    this.progressState.set(Math.max(this.progress(), task.progress ?? 0));
    this.serverMessage.set(task.progress_message || '');
    this.overrideMessage.set('');
  }

  watch(workspaceId: number, task: ValidationTaskDto): Observable<ValidationTaskDto> {
    return defer(() => {
      this.accept(task);
      if (task.status === 'completed' || task.status === 'failed') return of(task);
      return timer(0, 300).pipe(
        // A slow status response must finish before the next poll can start.
        exhaustMap(() => this.backend.getValidationTask(workspaceId, task.id)),
        tap(next => this.accept(next)),
        filter(next => next.status !== 'pending' && next.status !== 'processing'),
        take(1)
      );
    }).pipe(
      takeUntil(this.replaced),
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntilDestroyed(this.destroyRef)
    );
  }
}
