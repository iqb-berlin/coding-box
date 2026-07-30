import { Logger } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import {
  REPLAY_ATTEMPT_ID_HEADER,
  RequestWithRequestId,
  createRequestId,
  normalizeReplayAttemptId
} from './request-id';
import {
  PostgresPoolSnapshot,
  PostgresPoolSnapshotProvider
} from '../database/postgres-pool-monitor';
import {
  parseInFlightRequestThresholdMs,
  parseSlowRequestThresholdMs
} from '../config/runtime-config.service';
import { RequestMonitoringIncidentKind } from '../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';

export {
  DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS,
  DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  parseBooleanFlag,
  parseInFlightRequestThresholdMs,
  parseSlowRequestThresholdMs
} from '../config/runtime-config.service';

interface RequestMonitoringLogger {
  error(message: string): void;
  log?(message: string): void;
  warn(message: string): void;
}

interface RequestMonitoringOptions {
  clearTimer?: (timer: NodeJS.Timeout) => void;
  getPoolSnapshot?: PostgresPoolSnapshotProvider;
  inFlightRequestThresholdMs?: number;
  logStartedRequests?: boolean;
  logger?: RequestMonitoringLogger;
  now?: () => bigint;
  reportIncident?: (incident: RequestMonitoringIncidentReport) => Promise<void> | void;
  setTimer?: (
    callback: () => void,
    delayMs: number
  ) => NodeJS.Timeout;
  slowRequestThresholdMs?: number;
}

export interface RequestMonitoringIncidentReport {
  durationMs: number;
  errorMessage?: string;
  kind: RequestMonitoringIncidentKind;
  method: string;
  path: string;
  poolSnapshot?: PostgresPoolSnapshot;
  requestId: string;
  statusCode?: number;
  workspaceId?: number;
}

const NANOSECONDS_PER_MILLISECOND = BigInt(1000000);

export function createRequestMonitoringMiddleware(options: RequestMonitoringOptions = {}) {
  const logger = options.logger || new Logger('HttpRequestMonitoring');
  const now = options.now || process.hrtime.bigint;
  const slowRequestThresholdMs = parseSlowRequestThresholdMs(options.slowRequestThresholdMs);
  const inFlightRequestThresholdMs = parseInFlightRequestThresholdMs(
    options.inFlightRequestThresholdMs
  );
  const setTimer = options.setTimer ||
    ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const clearTimer = options.clearTimer ||
    ((timer: NodeJS.Timeout) => clearTimeout(timer));

  return (
    request: RequestWithRequestId,
    response: Response,
    next: NextFunction
  ): void => {
    const startedAt = now();
    const requestId = getRequestId(request);
    const replayAttemptId = normalizeReplayAttemptId(
      getHeaderValue(request, REPLAY_ATTEMPT_ID_HEADER)
    );
    const requestDescription =
      `${request.method} ${getRequestPath(request)}${replayAttemptId ?
        ` attempt=${replayAttemptId}` :
        ''}`;
    const requestPath = getRequestPath(request);
    const workspaceId = getWorkspaceId(request);
    let terminalStateRecorded = false;

    const reportIncident = (
      kind: RequestMonitoringIncidentKind,
      durationMs: number,
      poolSnapshot?: PostgresPoolSnapshot,
      statusCode?: number
    ): void => {
      if (!options.reportIncident) {
        return;
      }
      try {
        Promise.resolve(options.reportIncident({
          durationMs,
          errorMessage: request.monitoringErrorMessage,
          kind,
          method: request.method,
          path: requestPath,
          poolSnapshot,
          requestId,
          statusCode,
          workspaceId
        })).catch(error => logger.error(
          `[${requestId}] Could not persist request monitoring incident: ${String(error)}`
        ));
      } catch (error) {
        logger.error(
          `[${requestId}] Could not persist request monitoring incident: ${String(error)}`
        );
      }
    };

    if (options.logStartedRequests) {
      logger.log?.(`[${requestId}] ${requestDescription} started`);
    }

    const inFlightTimer = setTimer(() => {
      if (terminalStateRecorded) {
        return;
      }
      const poolSnapshot = options.getPoolSnapshot?.();
      logger.warn(
        `[${requestId}] ${requestDescription} still running after ` +
        `${inFlightRequestThresholdMs} ms${formatPoolSnapshot(
          poolSnapshot
        )}`
      );
      reportIncident(
        RequestMonitoringIncidentKind.InFlight,
        inFlightRequestThresholdMs,
        poolSnapshot
      );
    }, inFlightRequestThresholdMs);

    const recordTerminalState = (
      state: 'aborted' | 'closed' | 'finished'
    ): void => {
      if (terminalStateRecorded) {
        return;
      }
      terminalStateRecorded = true;
      clearTimer(inFlightTimer);

      const durationMs = getDurationMs(startedAt, now());
      const poolSnapshot = options.getPoolSnapshot?.();

      if (state === 'aborted' || state === 'closed') {
        logger.warn(
          `[${requestId}] ${requestDescription} ${state} after ${durationMs} ms${formatPoolSnapshot(poolSnapshot)}`
        );
        reportIncident(
          state === 'aborted' ?
            RequestMonitoringIncidentKind.Aborted :
            RequestMonitoringIncidentKind.Closed,
          durationMs,
          poolSnapshot
        );
        return;
      }

      if (response.statusCode >= 500) {
        logger.error(
          `[${requestId}] ${requestDescription} failed with ${response.statusCode} in ${durationMs} ms${formatPoolSnapshot(poolSnapshot)}`
        );
        reportIncident(
          RequestMonitoringIncidentKind.Failed,
          durationMs,
          poolSnapshot,
          response.statusCode
        );
        return;
      }

      if (durationMs >= slowRequestThresholdMs) {
        logger.warn(
          `[${requestId}] ${requestDescription} completed with ${response.statusCode} in ${durationMs} ms ` +
          `(slow request; threshold ${slowRequestThresholdMs} ms)${formatPoolSnapshot(poolSnapshot)}`
        );
        reportIncident(
          RequestMonitoringIncidentKind.Slow,
          durationMs,
          poolSnapshot,
          response.statusCode
        );
      }
    };

    request.on('aborted', () => {
      recordTerminalState('aborted');
    });
    response.on('close', () => {
      recordTerminalState('closed');
    });
    response.on('finish', () => {
      recordTerminalState('finished');
    });

    next();
  };
}

function getWorkspaceId(request: RequestWithRequestId): number | undefined {
  const url = request.originalUrl || request.url || '';
  const match = url.match(/\/workspace\/(\d+)(?:\/|$)/i);
  const parsed = Number(match?.[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getHeaderValue(
  request: RequestWithRequestId,
  headerName: string
): unknown {
  if (typeof request.header === 'function') {
    return request.header(headerName);
  }

  const headers = request.headers as Record<string, unknown> | undefined;
  return headers?.[headerName.toLowerCase()];
}

function getDurationMs(startedAt: bigint, finishedAt: bigint): number {
  return Number((finishedAt - startedAt) / NANOSECONDS_PER_MILLISECOND);
}

function getRequestId(request: RequestWithRequestId): string {
  if (request.requestId) {
    return request.requestId;
  }

  const requestId = createRequestId();
  request.requestId = requestId;
  return requestId;
}

function getRequestPath(request: RequestWithRequestId): string {
  const url = request.originalUrl || request.url || '/';
  const normalizedSlashes =
    (url.split('?', 1)[0] || '/').replace(/\/{2,}/g, '/');
  const replayPath = normalizedSlashes
    .replace(
      /(\/replay-response)\/[^/]+\/[^/]+$/i,
      '$1/:testPerson/:unitId'
    )
    .replace(
      /(\/replay-assets)\/[^/]+$/i,
      '$1/:unitId'
    );

  return replayPath
    .split('/')
    .map(segment => (
      /^\d+$/.test(segment) ||
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
      segment.includes('@') ||
      /%40/i.test(segment) ?
        ':id' :
        segment
    ))
    .join('/');
}

function formatPoolSnapshot(
  snapshot: PostgresPoolSnapshot | undefined
): string {
  return snapshot ?
    ` (postgres pool: total=${snapshot.totalCount}, ` +
      `idle=${snapshot.idleCount}, waiting=${snapshot.waitingCount})` :
    '';
}
