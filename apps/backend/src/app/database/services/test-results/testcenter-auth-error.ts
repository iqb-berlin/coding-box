import {
  BadGatewayException, BadRequestException, ForbiddenException, GatewayTimeoutException,
  HttpException, ServiceUnavailableException, UnprocessableEntityException
} from '@nestjs/common';
import { isAxiosError } from 'axios';

export function testcenterAuthenticationError(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  const options = { cause: error };
  if (isAxiosError(error)) {
    if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(error.code || '')) {
      return new GatewayTimeoutException('Testcenter authentication timed out', options);
    }
    switch (error.response?.status) {
      case 400:
        return error.response.data === 'No login with this password.' ?
          new UnprocessableEntityException('Invalid Testcenter credentials', options) :
          new BadRequestException('Testcenter rejected the authentication request', options);
      // A provider login failure must not invalidate the application's bearer session.
      case 401: return new UnprocessableEntityException('Invalid Testcenter credentials', options);
      case 403: return new ForbiddenException('Testcenter access denied', options);
      case 429: return new ServiceUnavailableException('Testcenter authentication is temporarily unavailable', options);
      default:
        if (error.response) return new BadGatewayException('Invalid Testcenter authentication response', options);
    }
  }
  return new ServiceUnavailableException('Testcenter authentication is unavailable', options);
}

export function testcenterAuthenticationResponse(data: unknown, status?: number): Record<string, unknown> {
  if (status === 202 || status === 204) throw new ForbiddenException('Testcenter access denied');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new BadGatewayException('Invalid Testcenter authentication response');
  }
  return data as Record<string, unknown>;
}
