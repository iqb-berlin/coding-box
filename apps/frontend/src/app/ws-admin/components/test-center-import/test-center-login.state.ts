import {
  DestroyRef, inject, Injectable, signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import {
  catchError, defer, finalize, Observable, of, take
} from 'rxjs';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import type { ServerResponse } from '../../../core/services/authentication.service';
import type { TestcenterInstanceDto } from '../../../../../../../api-dto/testcenter/testcenter-instance.dto';
import { testcenterLoginErrorKey } from './test-center-instance-selection';

@Injectable()
export class TestCenterLoginState {
  private readonly backend = inject(UserBackendService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private generation = 0;
  private loading = false;
  readonly instances = signal<TestcenterInstanceDto[]>([]);
  readonly instancesError = signal(false);
  readonly message = signal('');
  readonly pending = signal(false);

  load(): void {
    if (this.loading) return;
    this.loading = true;
    this.instancesError.set(false);
    this.backend.getTestcenterInstances().pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => { this.loading = false; })
    ).subscribe({
      next: instances => this.instances.set(instances),
      error: () => this.instancesError.set(true)
    });
  }

  login(name: string, password: string, server: string, url: string): Observable<ServerResponse | undefined> {
    return defer(() => {
      this.generation += 1;
      const generation = this.generation;
      this.pending.set(true);
      this.message.set('');
      return this.backend.authenticate(name, password, server, url).pipe(
        take(1),
        catchError(error => {
          if (generation === this.generation) this.message.set(this.translate.instant(testcenterLoginErrorKey(error)));
          return of(undefined);
        }),
        finalize(() => { if (generation === this.generation) this.pending.set(false); }),
        takeUntilDestroyed(this.destroyRef)
      );
    });
  }

  reset(): void {
    this.generation += 1;
    this.pending.set(false);
    this.message.set('');
  }
}
