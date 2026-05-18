import { Response } from 'express';
import { requestIdMiddleware } from './request-id.middleware';
import {
  REQUEST_ID_HEADER,
  RequestWithRequestId
} from './request-id';

describe('requestIdMiddleware', () => {
  const createResponse = () => ({
    setHeader: jest.fn()
  } as unknown as Response);

  it('should preserve a safe incoming request id', () => {
    const request = {
      header: jest.fn().mockReturnValue('client-request-1')
    } as unknown as RequestWithRequestId;
    const response = createResponse();
    const next = jest.fn();

    requestIdMiddleware(request, response, next);

    expect(request.requestId).toBe('client-request-1');
    expect(response.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'client-request-1');
    expect(next).toHaveBeenCalled();
  });

  it('should generate a request id when the incoming header is unsafe', () => {
    const request = {
      header: jest.fn().mockReturnValue('<bad>')
    } as unknown as RequestWithRequestId;
    const response = createResponse();

    requestIdMiddleware(request, response, jest.fn());

    expect(request.requestId).toEqual(expect.any(String));
    expect(request.requestId).not.toBe('<bad>');
    expect(response.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, request.requestId);
  });
});
