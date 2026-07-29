import { Injectable, RequestTimeoutException } from '@nestjs/common';

interface PendingPreview {
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
  started: boolean;
}

@Injectable()
export class DistributionPreviewLimiterService {
  private readonly maxConcurrentPreviews = 2;
  private readonly pendingPreviews: PendingPreview[] = [];
  private activePreviews = 0;

  run<T>(execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(this.createCancellationError());
    }

    return new Promise<T>((resolve, reject) => {
      const preview: PendingPreview = {
        execute,
        resolve: value => resolve(value as T),
        reject,
        signal,
        started: false
      };

      if (signal) {
        preview.abortHandler = () => this.cancelPendingPreview(preview);
        signal.addEventListener('abort', preview.abortHandler, { once: true });
      }

      this.pendingPreviews.push(preview);
      this.startPendingPreviews();
    });
  }

  private startPendingPreviews(): void {
    while (
      this.activePreviews < this.maxConcurrentPreviews &&
      this.pendingPreviews.length > 0
    ) {
      const preview = this.pendingPreviews.shift();
      if (!preview) {
        return;
      }

      if (preview.signal?.aborted) {
        this.removeAbortListener(preview);
        preview.reject(this.createCancellationError());
        continue;
      }

      preview.started = true;
      this.activePreviews += 1;

      Promise.resolve()
        .then(preview.execute)
        .then(preview.resolve, preview.reject)
        .finally(() => {
          this.removeAbortListener(preview);
          this.activePreviews -= 1;
          this.startPendingPreviews();
        });
    }
  }

  private cancelPendingPreview(preview: PendingPreview): void {
    if (preview.started) {
      return;
    }

    const index = this.pendingPreviews.indexOf(preview);
    if (index >= 0) {
      this.pendingPreviews.splice(index, 1);
    }
    this.removeAbortListener(preview);
    preview.reject(this.createCancellationError());
  }

  private removeAbortListener(preview: PendingPreview): void {
    if (preview.signal && preview.abortHandler) {
      preview.signal.removeEventListener('abort', preview.abortHandler);
    }
  }

  private createCancellationError(): RequestTimeoutException {
    return new RequestTimeoutException(
      'Distribution preview request was cancelled.'
    );
  }
}
