import {
  buildBrowserReplayUrl,
  compressDiagnostics,
  sanitizeArtifactName
} from './replay-health.browser.utils';

describe('replay-health browser utils', () => {
  it('should rebuild replay URLs against a production base URL', () => {
    const browserUrl = buildBrowserReplayUrl(
      'https://coding.example.org/app',
      'http://localhost/#/replay/login%40code%40%40BOOKLET/UNIT-1/2/VAR_A?auth=',
      'signed-token'
    );

    expect(browserUrl).toBe(
      'https://coding.example.org/app#/replay/login%40code%40%40BOOKLET/UNIT-1/2/VAR_A?auth=signed-token&healthCheck=1'
    );
  });

  it('should sanitize artifact names for screenshot files', () => {
    expect(sanitizeArtifactName('login@code@@BOOKLET__UNIT-1/page:2')).toBe(
      'login_code_BOOKLET__UNIT-1_page_2'
    );
  });

  it('should compress diagnostics to a small list', () => {
    expect(
      compressDiagnostics(['  first ', '', 'second', 'third', 'fourth'])
    ).toEqual(['first', 'second', 'third']);
  });
});
