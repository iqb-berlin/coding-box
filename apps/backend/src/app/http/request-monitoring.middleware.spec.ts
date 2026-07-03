import { EventEmitter } from 'events';
import { Response } from 'express';
import {
  DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  createRequestMonitoringMiddleware,
  parseSlowRequestThresholdMs
} from './request-monitoring.middleware';
import { RequestWithRequestId } from './request-id';

describe('requestMonitoringMiddleware', () => {
  const createRequest = (request: Partial<RequestWithRequestId> = {}) => ({
    method: 'GET',
    url: '/api/admin/workspace/3/coding/incomplete-variables/scope-summary?_t=123',
    originalUrl: '/api/admin/workspace/3/coding/incomplete-variables/scope-summary?_t=123',
    requestId: 'request-1',
    ...request
  } as RequestWithRequestId);

  const createResponse = (statusCode: number) => {
    const response = new EventEmitter() as Response & EventEmitter;
    response.statusCode = statusCode;
    return response;
  };

  const createClock = (...times: bigint[]) => {
    const values = [...times];
    return jest.fn(() => values.shift() ?? times[times.length - 1]);
  };

  it('should warn about slow successful requests', () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn()
    };
    const now = createClock(BigInt(0), BigInt(1500000000));
    const middleware = createRequestMonitoringMiddleware({
      logger,
      now,
      slowRequestThresholdMs: 1000
    });
    const response = createResponse(200);
    const next = jest.fn();

    middleware(createRequest(), response, next);
    response.emit('finish');

    expect(next).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[request-1] GET /api/admin/workspace/3/coding/incomplete-variables/scope-summary ' +
      'completed with 200 in 1500 ms (slow request; threshold 1000 ms)'
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should not log fast successful requests', () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn()
    };
    const now = createClock(BigInt(0), BigInt(999000000));
    const middleware = createRequestMonitoringMiddleware({
      logger,
      now,
      slowRequestThresholdMs: 1000
    });
    const response = createResponse(200);

    middleware(createRequest(), response, jest.fn());
    response.emit('finish');

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should log failed requests even when they are fast', () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn()
    };
    const now = createClock(BigInt(0), BigInt(100000000));
    const middleware = createRequestMonitoringMiddleware({
      logger,
      now,
      slowRequestThresholdMs: 1000
    });
    const response = createResponse(500);

    middleware(createRequest(), response, jest.fn());
    response.emit('finish');

    expect(logger.error).toHaveBeenCalledWith(
      '[request-1] GET /api/admin/workspace/3/coding/incomplete-variables/scope-summary failed with 500 in 100 ms'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should normalize repeated slashes in monitored paths', () => {
    const logger = {
      error: jest.fn(),
      warn: jest.fn()
    };
    const now = createClock(BigInt(0), BigInt(1500000000));
    const middleware = createRequestMonitoringMiddleware({
      logger,
      now,
      slowRequestThresholdMs: 1000
    });
    const response = createResponse(200);

    middleware(createRequest({
      originalUrl: '/api//admin///workspace/3/coding?_t=123',
      url: '/api/admin/workspace/3/coding?_t=123'
    }), response, jest.fn());
    response.emit('finish');

    expect(logger.warn).toHaveBeenCalledWith(
      '[request-1] GET /api/admin/workspace/3/coding ' +
      'completed with 200 in 1500 ms (slow request; threshold 1000 ms)'
    );
  });
});

describe('parseSlowRequestThresholdMs', () => {
  it('should parse positive millisecond values', () => {
    expect(parseSlowRequestThresholdMs('2500')).toBe(2500);
    expect(parseSlowRequestThresholdMs(1200.9)).toBe(1200);
  });

  it('should fall back to the default threshold for invalid values', () => {
    expect(parseSlowRequestThresholdMs('not-a-number')).toBe(DEFAULT_SLOW_REQUEST_THRESHOLD_MS);
    expect(parseSlowRequestThresholdMs(0)).toBe(DEFAULT_SLOW_REQUEST_THRESHOLD_MS);
    expect(parseSlowRequestThresholdMs(undefined)).toBe(DEFAULT_SLOW_REQUEST_THRESHOLD_MS);
  });
});
