import { Logger } from '@nestjs/common';
import { QueryPerformanceLogger } from './query-performance.logger';

describe('QueryPerformanceLogger', () => {
  it('reports stable fingerprints and duration without SQL, parameter or error contents', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    try {
      const logger = new QueryPerformanceLogger();
      logger.logQuerySlow(1200.2, "SELECT 'secret-answer'::text");
      logger.logQuerySlow(1201, "SELECT 'secret-answer'::text");
      logger.logQueryError();
      expect(warn.mock.calls[0][0]).toMatch(/^Slow SQL fingerprint=[a-f0-9]{16} duration_ms=1200$/);
      expect(String(warn.mock.calls[1][0]).split(' ')[2]).toBe(String(warn.mock.calls[0][0]).split(' ')[2]);
      expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain('secret-answer');
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
