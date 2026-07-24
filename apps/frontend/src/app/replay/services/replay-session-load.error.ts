import { ReplayServerTimings } from './replay-backend.service';

export interface ReplaySessionLoadTimings {
  requestStartedAt: number;
  responseReceivedAt: number;
  serverTimings: ReplayServerTimings | null;
}

export class ReplaySessionLoadError extends Error {
  constructor(
    readonly requestError: unknown,
    readonly timings: ReplaySessionLoadTimings
  ) {
    super('Replay session load failed');
  }
}
