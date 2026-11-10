import { HttpException, HttpStatus } from '@nestjs/common';
import { isAxiosError } from 'axios';

export type TestcenterConnectionErrorCode =
  'TESTCENTER_CONNECTION_TIMEOUT' | 'TESTCENTER_CERTIFICATE_ERROR' |
  'TESTCENTER_CONNECTION_FAILED' | 'TESTCENTER_INVALID_VERSION';

/** Only this fixed diagnostic code is exposed by the global filter; provider details stay private. */
export class TestcenterConnectionException extends HttpException {
  constructor(readonly diagnostic: TestcenterConnectionErrorCode, status: HttpStatus, cause?: unknown) {
    super('Testcenter connection failed', status, { cause });
  }
}

export function testcenterConnectionError(error: unknown): TestcenterConnectionException {
  const code = isAxiosError(error) ? error.code || '' : '';
  if (['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'].includes(code)) {
    return new TestcenterConnectionException('TESTCENTER_CONNECTION_TIMEOUT', HttpStatus.GATEWAY_TIMEOUT, error);
  }
  const tls = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code);
  return new TestcenterConnectionException(
    tls ? 'TESTCENTER_CERTIFICATE_ERROR' : 'TESTCENTER_CONNECTION_FAILED', HttpStatus.SERVICE_UNAVAILABLE, error
  );
}
