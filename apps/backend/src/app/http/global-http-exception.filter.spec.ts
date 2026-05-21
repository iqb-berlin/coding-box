import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger
} from '@nestjs/common';
import { Response } from 'express';
import { GlobalHttpExceptionFilter } from './global-http-exception.filter';
import {
  REQUEST_ID_HEADER,
  RequestWithRequestId
} from './request-id';

describe('GlobalHttpExceptionFilter', () => {
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  const createHost = (request: Partial<RequestWithRequestId> = {}) => {
    const response = {
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    } as unknown as Response;
    const requestWithDefaults = {
      method: 'GET',
      url: '/api/admin/workspace/5/journal',
      originalUrl: '/api/admin/workspace/5/journal?page=1&limit=20',
      ...request
    } as RequestWithRequestId;
    const host = {
      switchToHttp: () => ({
        getRequest: () => requestWithDefaults,
        getResponse: () => response
      })
    } as ArgumentsHost;

    return {
      host,
      request: requestWithDefaults,
      response
    };
  };

  it('should return a safe 500 body with the request id', () => {
    const filter = new GlobalHttpExceptionFilter();
    const { host, response } = createHost({ requestId: 'request-1' });

    filter.catch(new Error('database password leaked in stack'), host);

    expect(response.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'request-1');
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: 'Internal server error',
      path: '/api/admin/workspace/5/journal?page=1&limit=20',
      requestId: 'request-1'
    }));
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('[request-1] GET /api/admin/workspace/5/journal?page=1&limit=20 failed with 500'),
      expect.any(String)
    );
  });

  it('should preserve client error bodies and add the request id', () => {
    const filter = new GlobalHttpExceptionFilter();
    const { host, response } = createHost({ requestId: 'request-2' });

    filter.catch(new BadRequestException('Datum ungültig'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 400,
      message: 'Datum ungültig',
      error: 'Bad Request',
      requestId: 'request-2'
    }));
    expect(loggerSpy).not.toHaveBeenCalled();
  });

  it('should hide HttpException messages for server errors', () => {
    const filter = new GlobalHttpExceptionFilter();
    const { host, response } = createHost({ requestId: 'request-3' });

    filter.catch(new HttpException('Sensitive backend detail', 500), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500,
      message: 'Internal server error',
      requestId: 'request-3'
    }));
  });
});
