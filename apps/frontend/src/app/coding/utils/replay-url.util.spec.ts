import {
  appendReplayUrlParams,
  normalizeReplayUrlToCurrentOrigin
} from './replay-url.util';

describe('normalizeReplayUrlToCurrentOrigin', () => {
  it('moves backend-generated replay hash URLs to the current frontend origin', () => {
    expect(
      normalizeReplayUrlToCurrentOrigin(
        'http://localhost:3333/#/replay/person/unit/0/var',
        'http://localhost:4200'
      )
    ).toBe('http://localhost:4200/#/replay/person/unit/0/var');
  });

  it('keeps non-replay URLs unchanged', () => {
    expect(
      normalizeReplayUrlToCurrentOrigin(
        'http://localhost:3333/#/workspace/1',
        'http://localhost:4200'
      )
    ).toBe('http://localhost:3333/#/workspace/1');
  });

  it('keeps invalid URLs unchanged', () => {
    expect(
      normalizeReplayUrlToCurrentOrigin('http://[', 'http://localhost:4200')
    ).toBe('http://[');
  });
});

describe('appendReplayUrlParams', () => {
  it('appends hash query params without replacing existing workspaceId', () => {
    expect(
      appendReplayUrlParams(
        'http://localhost:4200/#/replay/person/unit/0/var?workspaceId=1',
        { mode: 'coding', codingJobId: 10, workspaceId: 1 }
      )
    ).toBe('http://localhost:4200/#/replay/person/unit/0/var?workspaceId=1&mode=coding&codingJobId=10');
  });
});
