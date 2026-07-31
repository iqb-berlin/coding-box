import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  RequestTimeoutException
} from '@nestjs/common';

interface PendingPreview {
  execute: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
  started: boolean;
}

export interface DistributionPreviewLimiterSnapshot {
  active: number;
  pending: number;
  maxConcurrent: number;
  maxPending: number;
  rejected: number;
  cancelled: number;
}

@Injectable()
export class DistributionPreviewLimiterService {
  private readonly logger = new Logger(DistributionPreviewLimiterService.name);
  private readonly maxConcurrentPreviews = 2;
  private readonly maxPendingPreviews = 8;
  private readonly pendingPreviews: PendingPreview[] = [];
  private activePreviews = 0;
  private rejectedPreviews = 0;
  private cancelledPreviews = 0;

  run<T>(execute: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      this.cancelledPreviews += 1;
      this.logState('cancelled before queueing');
      return Promise.reject(this.createCancellationError());
    }

    if (
      this.activePreviews >= this.maxConcurrentPreviews &&
      this.pendingPreviews.length >= this.maxPendingPreviews
    ) {
      this.rejectedPreviews += 1;
      this.logState('rejected because the queue is full', true);
      return Promise.reject(this.createCapacityError());
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
      if (!preview.started) {
        this.logState('queued');
      }
    });
  }

  getSnapshot(): DistributionPreviewLimiterSnapshot {
    return {
      active: this.activePreviews,
      pending: this.pendingPreviews.length,
      maxConcurrent: this.maxConcurrentPreviews,
      maxPending: this.maxPendingPreviews,
      rejected: this.rejectedPreviews,
      cancelled: this.cancelledPreviews
    };
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
        this.cancelledPreviews += 1;
        preview.reject(this.createCancellationError());
        this.logState('cancelled before execution');
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
    this.cancelledPreviews += 1;
    preview.reject(this.createCancellationError());
    this.logState('cancelled while queued');
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

  private createCapacityError(): HttpException {
    return new HttpException(
      'Distribution preview capacity is temporarily exhausted. Please try again.',
      HttpStatus.TOO_MANY_REQUESTS
    );
  }

  private logState(event: string, warn = false): void {
    const snapshot = this.getSnapshot();
    const message =
      `Distribution preview ${event}: ` +
      `active=${snapshot.active}/${snapshot.maxConcurrent} ` +
      `pending=${snapshot.pending}/${snapshot.maxPending} ` +
      `rejected=${snapshot.rejected} cancelled=${snapshot.cancelled}`;

    if (warn) {
      this.logger.warn(message);
    } else {
      this.logger.log(message);
    }
  }
}
