import {
  getResponseStatusLabel,
  getResponseStatusMetadata,
  getResponseStatusTooltipKey
} from './response-status-metadata.util';

describe('response-status-metadata util', () => {
  it('keeps DERIVE_ERROR visible as the technical status label', () => {
    expect(getResponseStatusLabel(4)).toBe('DERIVE_ERROR');
    expect(getResponseStatusLabel('DERIVE_ERROR')).toBe('DERIVE_ERROR');
  });

  it('provides a DERIVE_ERROR tooltip key', () => {
    expect(getResponseStatusTooltipKey(4)).toBe('response-status.tooltips.DERIVE_ERROR');
    expect(getResponseStatusMetadata('DERIVE_ERROR')).toMatchObject({
      numeric: 4,
      status: 'DERIVE_ERROR',
      label: 'DERIVE_ERROR'
    });
  });

  it('falls back to unknown status values unchanged', () => {
    expect(getResponseStatusLabel('UNKNOWN_STATUS')).toBe('UNKNOWN_STATUS');
    expect(getResponseStatusLabel(200)).toBe('200');
    expect(getResponseStatusLabel('4abc')).toBe('4abc');
    expect(getResponseStatusTooltipKey('UNKNOWN_STATUS')).toBe('');
    expect(getResponseStatusTooltipKey('4abc')).toBe('');
  });
});
