import {
  computed, inject, Injectable, OnDestroy, signal
} from '@angular/core';
import {
  Subscription, switchMap, takeWhile, timer
} from 'rxjs';
import { CodingVersionService } from '../../../services/coding-version.service';
import { ResetCodingPreviewResult, ResetCodingScope } from '../../../../../../../../api-dto/coding/reset-coding-preview.dto';

@Injectable()
export class ResetCodingPreviewState implements OnDestroy {
  private readonly backend = inject(CodingVersionService);
  private subscription?: Subscription;
  private scopeKey = '';
  private workspaceId = 0;
  private scope: ResetCodingScope | null = null;
  readonly busy = signal(false);
  readonly failed = signal(false);
  readonly result = signal<ResetCodingPreviewResult | null>(null);
  readonly hasScope = signal(false);
  readonly canConfirm = computed(() => this.result()?.status === 'valid' && (this.result()?.affectedResponseCount ?? 0) > 0 && !this.busy());

  matches(workspaceId: number, scope: ResetCodingScope | null): boolean {
    return this.scopeKey === JSON.stringify([workspaceId, scope]);
  }

  configure(workspaceId: number, scope: ResetCodingScope | null): void {
    const key = JSON.stringify([workspaceId, scope]);
    if (key === this.scopeKey) return;
    this.scopeKey = key;
    this.subscription?.unsubscribe();
    this.workspaceId = workspaceId;
    this.scope = scope;
    this.hasScope.set(!!scope && workspaceId > 0);
    this.busy.set(false);
    this.failed.set(false);
    this.result.set(null);
  }

  check(): void {
    if (!this.scope || !this.hasScope() || this.busy()) return;
    this.busy.set(true);
    this.failed.set(false);
    this.result.set(null);
    const workspaceId = this.workspaceId;
    this.subscription = this.backend.previewReset(workspaceId, this.scope).pipe(
      switchMap(({ jobId }) => timer(0, 1500).pipe(
        switchMap(() => this.backend.getResetPreview(workspaceId, jobId)),
        takeWhile(status => ['pending', 'processing'].includes(status.status), true)
      ))
    ).subscribe({
      next: status => {
        if (status.status === 'completed' && status.result) {
          this.result.set(status.result);
          this.busy.set(false);
        } else if (!['pending', 'processing'].includes(status.status)) {
          this.failed.set(true);
          this.busy.set(false);
        }
      },
      error: () => { this.failed.set(true); this.busy.set(false); }
    });
  }

  ngOnDestroy(): void { this.subscription?.unsubscribe(); }
}
