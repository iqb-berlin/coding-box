import { AxiosError, AxiosResponse } from 'axios';
import { UnauthorizedException } from '@nestjs/common';
import { testcenterAuthenticationError, testcenterAuthenticationResponse } from './testcenter-auth-error';

describe('Testcenter authentication failures', () => {
  it.each([[400, 400], [401, 422], [403, 403], [429, 503], [500, 502], [302, 502]])('maps upstream %i to HTTP %i without echoing provider details', (upstream, expected) => {
    const error = new AxiosError('password=secret', 'ERR_BAD_RESPONSE', undefined, undefined, { status: upstream, data: { password: 'secret' } } as AxiosResponse);
    const result = testcenterAuthenticationError(error);
    expect(result.getStatus()).toBe(expected);
    expect(JSON.stringify(result.getResponse())).not.toContain('secret');
    expect(result.cause).toBe(error);
  });
  it('preserves application authentication failures as HTTP 401', () => {
    const error = new UnauthorizedException();
    expect(testcenterAuthenticationError(error)).toBe(error);
    expect(testcenterAuthenticationError(error).getStatus()).toBe(401);
  });
  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'])('maps timeout %s to 504', code => {
    expect(testcenterAuthenticationError(new AxiosError('timeout', code)).getStatus()).toBe(504);
  });
  it.each([null, [], '<html>Login page</html>'])('rejects malformed successful provider responses: %j', data => {
    expect(() => testcenterAuthenticationResponse(data)).toThrow('Invalid Testcenter authentication response');
  });
  it('maps connectivity and TLS failures to 503', () => {
    expect(testcenterAuthenticationError(new AxiosError('ECONNREFUSED')).getStatus()).toBe(503);
    expect(testcenterAuthenticationError(new Error('certificate failure')).getStatus()).toBe(503);
  });
});
