import { normalizeRequestId } from './request-id';

describe('request id helpers', () => {
  it('should accept safe incoming request ids', () => {
    expect(normalizeRequestId('support-123_ABC.1:2')).toBe('support-123_ABC.1:2');
  });

  it('should reject unsafe incoming request ids', () => {
    expect(normalizeRequestId('request id with spaces')).toBeUndefined();
    expect(normalizeRequestId('<script>alert(1)</script>')).toBeUndefined();
    expect(normalizeRequestId('x'.repeat(129))).toBeUndefined();
  });

  it('should use the first value when a header array is provided', () => {
    expect(normalizeRequestId(['first-id', 'second-id'])).toBe('first-id');
  });
});
