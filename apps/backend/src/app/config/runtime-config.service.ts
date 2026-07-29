import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_POSTGRES_POOL_MAX = 10;
export const MINIMUM_POSTGRES_POOL_MAX = 2;
export const DEFAULT_CODING_FILE_LOAD_CONCURRENCY = 4;
export const DEFAULT_RESPONSE_CACHE_WORKSPACE_CONCURRENCY = 1;
export const DEFAULT_RESPONSE_CACHE_ITEM_CONCURRENCY = 4;
export const DEFAULT_SLOW_REQUEST_THRESHOLD_MS = 1000;
export const DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS = 10_000;

export const POSTGRES_POOL_MAX_ENV = 'POSTGRES_POOL_MAX';
export const CODING_FILE_LOAD_CONCURRENCY_ENV =
  'CODING_FILE_LOAD_CONCURRENCY';
export const RESPONSE_CACHE_WORKSPACE_CONCURRENCY_ENV =
  'RESPONSE_CACHE_WORKSPACE_CONCURRENCY';
export const RESPONSE_CACHE_ITEM_CONCURRENCY_ENV =
  'RESPONSE_CACHE_ITEM_CONCURRENCY';
export const SLOW_REQUEST_THRESHOLD_ENV = 'SLOW_REQUEST_THRESHOLD_MS';
export const IN_FLIGHT_REQUEST_THRESHOLD_ENV =
  'IN_FLIGHT_REQUEST_THRESHOLD_MS';
export const REQUEST_START_LOGGING_ENV = 'REQUEST_START_LOGGING';

export function parsePositiveInteger(
  value: unknown,
  fallback: number
): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePostgresPoolMax(value: unknown): number {
  const parsed = parsePositiveInteger(value, DEFAULT_POSTGRES_POOL_MAX);
  return parsed >= MINIMUM_POSTGRES_POOL_MAX ?
    parsed :
    DEFAULT_POSTGRES_POOL_MAX;
}

export function parsePositiveMilliseconds(
  value: unknown,
  fallback: number
): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return fallback;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallback;
  }

  return Math.floor(parsedValue);
}

export function parseBooleanFlag(value: unknown): boolean {
  return typeof value === 'string' &&
    ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function parseSlowRequestThresholdMs(value: unknown): number {
  return parsePositiveMilliseconds(value, DEFAULT_SLOW_REQUEST_THRESHOLD_MS);
}

export function parseInFlightRequestThresholdMs(value: unknown): number {
  return parsePositiveMilliseconds(
    value,
    DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS
  );
}

@Injectable()
export class RuntimeConfigService {
  readonly postgresPoolMax: number;
  readonly codingFileLoadConcurrency: number;
  readonly responseCacheWorkspaceConcurrency: number;
  readonly responseCacheItemConcurrency: number;
  readonly slowRequestThresholdMs: number;
  readonly inFlightRequestThresholdMs: number;
  readonly requestStartLogging: boolean;

  constructor(configService: ConfigService) {
    this.postgresPoolMax = parsePostgresPoolMax(
      configService.get(POSTGRES_POOL_MAX_ENV)
    );
    const databaseConcurrencyBudget = Math.max(
      1,
      this.postgresPoolMax - 1
    );

    this.codingFileLoadConcurrency = Math.min(
      parsePositiveInteger(
        configService.get(CODING_FILE_LOAD_CONCURRENCY_ENV),
        DEFAULT_CODING_FILE_LOAD_CONCURRENCY
      ),
      databaseConcurrencyBudget
    );
    this.responseCacheWorkspaceConcurrency = Math.min(
      parsePositiveInteger(
        configService.get(RESPONSE_CACHE_WORKSPACE_CONCURRENCY_ENV),
        DEFAULT_RESPONSE_CACHE_WORKSPACE_CONCURRENCY
      ),
      databaseConcurrencyBudget
    );
    const itemConcurrencyBudget = Math.max(
      1,
      Math.floor(
        databaseConcurrencyBudget /
        this.responseCacheWorkspaceConcurrency
      )
    );
    this.responseCacheItemConcurrency = Math.min(
      parsePositiveInteger(
        configService.get(RESPONSE_CACHE_ITEM_CONCURRENCY_ENV),
        DEFAULT_RESPONSE_CACHE_ITEM_CONCURRENCY
      ),
      itemConcurrencyBudget
    );
    this.slowRequestThresholdMs = parseSlowRequestThresholdMs(
      configService.get(SLOW_REQUEST_THRESHOLD_ENV)
    );
    this.inFlightRequestThresholdMs = parseInFlightRequestThresholdMs(
      configService.get(IN_FLIGHT_REQUEST_THRESHOLD_ENV)
    );
    this.requestStartLogging = parseBooleanFlag(
      configService.get(REQUEST_START_LOGGING_ENV)
    );
  }
}
