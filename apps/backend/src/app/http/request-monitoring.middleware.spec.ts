import { EventEmitter } from 'events';
import { Response } from 'express';
import {
  DEFAULT_SLOW_REQUEST_THRESHOLD_MS,
  DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS,
  createRequestMonitoringMiddleware,
  parseBooleanFlag,
  parseInFlightRequestThresholdMs,
  parseSlowRequestThresholdMs
} from './request-monitoring.middleware';
import { RequestWithRequestId } from './request-id';
import { RequestMonitoringIncidentKind } from '../../../../../api-dto/request-monitoring/request-monitoring-incident.dto';

describe('requestMonitoringMiddleware', () => {
  const createRequest = (request: Partial<RequestWithRequestId> = {}) => Object.assign(new EventEmitter(), {
    method: 'GET',
    url: '/api/admin/workspace/3/coding/incomplete-variables/scope-summary?_t=123',
    originalUrl: '/api/admin/workspace/3/coding/incomplete-variables/scope-summary?_t=123',
    requestId: 'request-1',
    ...request
  }) as unknown as RequestWithRequestId;

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
      '[request-1] GET /api/admin/workspace/:id/coding/incomplete-variables/scope-summary ' +
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
      '[request-1] GET /api/admin/workspace/:id/coding/incomplete-variables/scope-summary failed with 500 in 100 ms'
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should persist aggregated incident data for administrators', async () => {
    const reportIncident = jest.fn().mockResolvedValue(undefined);
    const now = createClock(BigInt(0), BigInt(1500000000));
    const middleware = createRequestMonitoringMiddleware({
      logger: { error: jest.fn(), warn: jest.fn() },
      now,
      reportIncident,
      slowRequestThresholdMs: 1000
    });
    const response = createResponse(200);

    middleware(createRequest(), response, jest.fn());
    response.emit('finish');
    await Promise.resolve();

    expect(reportIncident).toHaveBeenCalledWith({
      durationMs: 1500,
      errorMessage: undefined,
      kind: RequestMonitoringIncidentKind.Slow,
      method: 'GET',
      path: '/api/admin/workspace/:id/coding/incomplete-variables/scope-summary',
      poolSnapshot: undefined,
      requestId: 'request-1',
      statusCode: 200,
      workspaceId: 3
    });
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
      '[request-1] GET /api/admin/workspace/:id/coding ' +
      'completed with 200 in 1500 ms (slow request; threshold 1000 ms)'
    );
  });

  it('should remove replay identifiers from monitored paths', () => {
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
      headers: {
        'x-replay-attempt-id': 'attempt-1'
      },
      originalUrl: '/api/admin/workspace/47/replay-response/login%40code%40booklet/UNIT-1',
      url: '/api/admin/workspace/47/replay-response/login%40code%40booklet/UNIT-1'
    }), response, jest.fn());
    response.emit('finish');

    expect(logger.warn).toHaveBeenCalledWith(
      '[request-1] GET /api/admin/workspace/:id/replay-response/:testPerson/:unitId attempt=attempt-1 ' +
      'completed with 200 in 1500 ms (slow request; threshold 1000 ms)'
    );
  });

  it('should report requests that remain in flight with pool counters', () => {
    jest.useFakeTimers();
    const logger = {
      error: jest.fn(),
      warn: jest.fn()
    };
    const middleware = createRequestMonitoringMiddleware({
      getPoolSnapshot: () => ({
        totalCount: 10,
        idleCount: 0,
        waitingCount: 4
      }),
      inFlightRequestThresholdMs: 5000,
      logger
    });

    middleware(createRequest(), createResponse(200), jest.fn());
    jest.advanceTimersByTime(5000);

    expect(logger.warn).toHaveBeenCalledWith(
      '[request-1] GET /api/admin/workspace/:id/coding/incomplete-variables/scope-summary ' +
      'still running after 5000 ms (postgres pool: total=10, idle=0, waiting=4)'
    );
    jest.useRealTimers();
  });

  it.each(['aborted', 'close'] as const)(
    'should record a single %s terminal state',
    eventName => {
      const logger = {
        error: jest.fn(),
        warn: jest.fn()
      };
      const now = createClock(BigInt(0), BigInt(250000000));
      const middleware = createRequestMonitoringMiddleware({
        logger,
        now
      });
      const request = createRequest();
      const response = createResponse(200);

      middleware(request, response, jest.fn());
      if (eventName === 'aborted') {
        request.emit('aborted');
      } else {
        response.emit('close');
      }
      response.emit('finish');

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[request-1] GET /api/admin/workspace/:id/coding/incomplete-variables/scope-summary ' +
        `${eventName === 'close' ? 'closed' : 'aborted'} after 250 ms`
      );
      expect(logger.error).not.toHaveBeenCalled();
    }
  );
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

describe('parseInFlightRequestThresholdMs', () => {
  it('should parse positive millisecond values', () => {
    expect(parseInFlightRequestThresholdMs('12000')).toBe(12_000);
  });

  it('should fall back for invalid values', () => {
    expect(parseInFlightRequestThresholdMs('invalid'))
      .toBe(DEFAULT_IN_FLIGHT_REQUEST_THRESHOLD_MS);
  });
});

describe('parseBooleanFlag', () => {
  it.each(['1', 'true', 'YES', 'on'])('should accept %s', value => {
    expect(parseBooleanFlag(value)).toBe(true);
  });

  it.each([undefined, '', 'false', '0'])('should reject %s', value => {
    expect(parseBooleanFlag(value)).toBe(false);
  });
});
