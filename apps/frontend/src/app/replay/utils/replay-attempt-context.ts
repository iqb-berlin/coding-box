import type {
  ReplayClientTimings,
  ReplayServerTimings
} from '../services/replay-backend.service';
import { createReplayAttemptId } from './replay-request-correlation';

export interface ReplaySessionTimings {
  requestStartedAt: number;
  responseReceivedAt: number;
  serverTimings: ReplayServerTimings | null;
}

export class ReplayAttemptContext {
  readonly id: string;
  readonly routeStartedAt: number;

  private replayStartedAt = 0;
  private loadStartedAt = 0;
  private payloadRequestStartedAt = 0;
  private payloadResponseAt = 0;
  private playerReadyAt = 0;
  private payloadServerTimings: ReplayServerTimings | null = null;
  private codingSessionRequestStartedAt = 0;
  private codingSessionResponseAt = 0;
  private codingSessionServerTimings: ReplayServerTimings | null = null;
  private statisticsFinalized = false;

  constructor(
    routeStartedAt: number = 0,
    id: string = createReplayAttemptId()
  ) {
    this.routeStartedAt = routeStartedAt;
    this.id = id;
    this.replayStartedAt = routeStartedAt;
  }

  startPayloadLoad(startedAt: number): void {
    this.replayStartedAt = startedAt;
    this.loadStartedAt = startedAt;
    this.payloadRequestStartedAt = startedAt;
    this.payloadResponseAt = 0;
    this.playerReadyAt = 0;
    this.payloadServerTimings = null;
    this.statisticsFinalized = false;
  }

  startDirectPageNavigation(): void {
    this.replayStartedAt = this.routeStartedAt;
    this.statisticsFinalized = false;
  }

  recordCodingSession(timings: ReplaySessionTimings): void {
    this.codingSessionRequestStartedAt = timings.requestStartedAt;
    this.codingSessionResponseAt = timings.responseReceivedAt;
    this.codingSessionServerTimings = timings.serverTimings;
  }

  recordPayloadResponse(
    receivedAt: number,
    serverTimings?: ReplayServerTimings | null
  ): void {
    this.payloadResponseAt = receivedAt;
    if (serverTimings !== undefined) {
      this.payloadServerTimings = serverTimings;
    }
  }

  recordPayloadServerTimings(serverTimings?: ReplayServerTimings | null): void {
    this.payloadServerTimings = serverTimings ?? null;
  }

  recordPlayerReady(readyAt: number): void {
    if (!this.playerReadyAt) {
      this.playerReadyAt = readyAt;
    }
  }

  tryFinalizeStatistics(): boolean {
    if (this.statisticsFinalized) {
      return false;
    }
    this.statisticsFinalized = true;
    return true;
  }

  getDurationMilliseconds(endTime: number): number {
    return this.replayStartedAt ?
      Math.max(0, Math.round(endTime - this.replayStartedAt)) :
      0;
  }

  getClientTimings(visibleTime: number): ReplayClientTimings {
    return {
      codingSessionMs: this.elapsedOrNull(
        this.codingSessionRequestStartedAt,
        this.codingSessionResponseAt
      ),
      routeToCodingSessionRequestMs: this.elapsedOrNull(
        this.routeStartedAt,
        this.codingSessionRequestStartedAt
      ),
      codingSessionResponseToPayloadRequestMs: this.elapsedOrNull(
        this.codingSessionResponseAt,
        this.payloadRequestStartedAt
      ),
      routeToVisibleMs: this.elapsedOrNull(this.routeStartedAt, visibleTime),
      loadToVisibleMs: this.elapsedOrNull(this.loadStartedAt, visibleTime),
      routeToPayloadRequestMs: this.elapsedOrNull(
        this.routeStartedAt,
        this.payloadRequestStartedAt
      ),
      payloadMs: this.elapsedOrNull(
        this.payloadRequestStartedAt,
        this.payloadResponseAt
      ),
      payloadToVisibleMs: this.elapsedOrNull(this.payloadResponseAt, visibleTime),
      payloadToPlayerReadyMs: this.elapsedOrNull(
        this.payloadResponseAt,
        this.playerReadyAt
      ),
      playerReadyToVisibleMs: this.elapsedOrNull(this.playerReadyAt, visibleTime)
    };
  }

  getServerTimings(): ReplayServerTimings | undefined {
    const serverTimings = {
      ...(this.codingSessionServerTimings ?? {}),
      ...(this.payloadServerTimings ?? {})
    };
    return Object.keys(serverTimings).length > 0 ? serverTimings : undefined;
  }

  private elapsedOrNull(startTime: number, endTime: number): number | null {
    return startTime && endTime ?
      Math.max(0, Math.round(endTime - startTime)) :
      null;
  }
}
