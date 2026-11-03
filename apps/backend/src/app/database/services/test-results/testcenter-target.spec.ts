import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { parseAllowedTestcenterUrls, resolveTestcenterBaseUrl } from './testcenter-target';

describe('Testcenter target policy', () => {
  it.each(['', '1', '5', '10'])('allows standard server %s', server => {
    expect(resolveTestcenterBaseUrl(server)).toBe(`https://iqb-testcenter${server}.de`);
  });
  it.each(['http://127.0.0.1', 'http://169.254.169.254', 'https://unapproved.test', 'https://iqb-testcenter1.de.evil.test'])('rejects unapproved target %s', url => {
    expect(() => resolveTestcenterBaseUrl('', url)).toThrow(ForbiddenException);
  });
  it.each(['file:///etc/passwd', 'https://user:password@iqb-testcenter1.de', 'https://iqb-testcenter1.de?x=1', 'https://iqb-testcenter1.de#fragment', ' https://iqb-testcenter1.de', 'https:\\evil.test'])('rejects malformed target %s', url => {
    expect(() => resolveTestcenterBaseUrl('', url)).toThrow(BadRequestException);
  });
  it.each(['11', 'demo', '1.de@127.0.0.1/', '../', '1/evil'])('rejects server interpolation %s', server => {
    expect(() => resolveTestcenterBaseUrl(server)).toThrow(BadRequestException);
  });
  it('matches configured custom base paths exactly and supports deliberately approved private targets', () => {
    const allowed = 'https://custom.test/tci/, http://127.0.0.1:15444/tci';
    expect(resolveTestcenterBaseUrl('', 'https://custom.test/tci', allowed)).toBe('https://custom.test/tci');
    expect(resolveTestcenterBaseUrl('', 'http://127.0.0.1:15444/tci', allowed)).toBe('http://127.0.0.1:15444/tci');
    expect(() => resolveTestcenterBaseUrl('', 'https://custom.test/other', allowed)).toThrow(ForbiddenException);
    expect(() => resolveTestcenterBaseUrl('', 'http://127.0.0.1:15445/tci', allowed)).toThrow(ForbiddenException);
    expect(() => parseAllowedTestcenterUrls('ftp://invalid.test')).toThrow(BadRequestException);
  });
});
