import { Logger } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import {
  RequestWithRequestId,
  createRequestId
} from './request-id';

export const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1000;
export const SLOW_REQUEST_THRESHOLD_ENV = 'SLOW_REQUEST_THRESHOLD_MS';

interface RequestMonitoringLogger {
  error(message: string): void;
  warn(message: string): void;
}

interface RequestMonitoringOptions {
  logger?: RequestMonitoringLogger;
  now?: () => bigint;
  slowRequestThresholdMs?: number;
}

const NANOSECONDS_PER_MILLISECOND = BigInt(1000000);

export function parseSlowRequestThresholdMs(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return DEFAULT_SLOW_REQUEST_THRESHOLD_MS;
  }

  return Math.floor(parsedValue);
}

export function createRequestMonitoringMiddleware(options: RequestMonitoringOptions = {}) {
  const logger = options.logger || new Logger('HttpRequestMonitoring');
  const now = options.now || process.hrtime.bigint;
  const slowRequestThresholdMs = parseSlowRequestThresholdMs(options.slowRequestThresholdMs);

  return (
    request: RequestWithRequestId,
    response: Response,
    next: NextFunction
  ): void => {
    const startedAt = now();

    response.on('finish', () => {
      const durationMs = getDurationMs(startedAt, now());
      const requestId = getRequestId(request);
      const requestDescription = `${request.method} ${getRequestPath(request)}`;

      if (response.statusCode >= 500) {
        logger.error(
          `[${requestId}] ${requestDescription} failed with ${response.statusCode} in ${durationMs} ms`
        );
        return;
      }

      if (durationMs >= slowRequestThresholdMs) {
        logger.warn(
          `[${requestId}] ${requestDescription} completed with ${response.statusCode} in ${durationMs} ms ` +
          `(slow request; threshold ${slowRequestThresholdMs} ms)`
        );
      }
    });

    next();
  };
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
  return (url.split('?', 1)[0] || '/').replace(/\/{2,}/g, '/');
}
