import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { WorkspaceSettingsService } from '../../shared/services/workspace/workspace-settings.service';
import { SERVER_URL } from '../../injection-tokens';
import { CodingBackgroundJobsService } from './coding-background-jobs.service';
import { TestPersonCodingService } from './test-person-coding.service';

describe('external coding import request cancellation', () => {
  let service: TestPersonCodingService;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), TestPersonCodingService, { provide: SERVER_URL, useValue: '/api/' },
        { provide: AuthService, useValue: {} }, { provide: WorkspaceSettingsService, useValue: {} },
        { provide: CodingBackgroundJobsService, useValue: {} }
      ]
    });
    service = TestBed.inject(TestPersonCodingService);
    globalThis.fetch = jest.fn();
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('does not post a file when cancellation happens while acquiring the token', async () => {
    let release!: (token: string) => void;
    jest.spyOn(service as unknown as { getValidAuthToken: () => Promise<string> }, 'getValidAuthToken')
      .mockReturnValue(new Promise(resolve => { release = resolve; }));
    const controller = new AbortController(); const error = jest.fn();
    const work = service.importExternalCodingWithProgress(5, { file: 'data' }, jest.fn(), jest.fn(), error, controller.signal);
    controller.abort(); release('token'); await work;
    expect(fetch).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });

  it('passes the signal to fetch and treats an aborted request as cancellation', async () => {
    jest.spyOn(service as unknown as { getValidAuthToken: () => Promise<string> }, 'getValidAuthToken').mockResolvedValue('token');
    (fetch as jest.Mock).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const controller = new AbortController(); const error = jest.fn();
    const work = service.importExternalCodingWithProgress(5, { file: 'data' }, jest.fn(), jest.fn(), error, controller.signal);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith('/api/admin/workspace/5/coding/external-coding-import/stream', expect.objectContaining({ signal: controller.signal }));
    controller.abort(); await work; expect(error).not.toHaveBeenCalled();
  });
});
