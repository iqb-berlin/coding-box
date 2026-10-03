import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ImportService, ImportOptions } from './import.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('ImportService', () => {
  let service: ImportService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        ImportService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ImportService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('bounds the import request without interpreting a timeout as a server failure', async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const options: ImportOptions = {
      responses: 'true',
      definitions: 'false',
      units: 'false',
      player: 'false',
      codings: 'false',
      logs: 'false',
      testTakers: 'false',
      booklets: 'false',
      metadata: 'false'
    };
    try {
      service.importWorkspaceFiles(1, 'tc', '1', '', 'token', options, ['g1'], false, undefined, 'run').subscribe({ error: onError });
      const request = httpMock.expectOne(req => req.url.endsWith('/importWorkspaceFiles'));
      await jest.advanceTimersByTimeAsync(180001);
      expect(request.cancelled).toBe(true);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ name: 'TimeoutError' }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns an unknown progress result when its request does not respond', async () => {
    jest.useFakeTimers();
    const onProgress = jest.fn();
    try {
      service.getImportWorkspaceFilesProgress(1, 'run').subscribe(onProgress);
      const request = httpMock.expectOne(req => req.url.endsWith('/progress'));
      await jest.advanceTimersByTimeAsync(10001);
      expect(request.cancelled).toBe(true);
      expect(onProgress).toHaveBeenCalledWith(null);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('importWorkspaceFiles', () => {
    it('should send import request with all options', () => {
      const options: ImportOptions = {
        responses: 'true',
        definitions: 'true',
        units: 'true',
        player: 'true',
        codings: 'true',
        logs: 'true',
        testTakers: 'true',
        booklets: 'true',
        metadata: 'true'
      };

      service.importWorkspaceFiles(mockWorkspaceId, 'ws1', 'srv', 'url', 'tok', options, ['g1'])
        .subscribe(res => {
          expect(res).toBeDefined();
        });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/importWorkspaceFiles` &&
        request.params.get('tc_workspace') === 'ws1' &&
        request.params.get('testGroups') === 'g1' &&
        request.params.get('responses') === 'true' &&
        request.params.get('responseOverwriteMode') === 'skip'
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });

    it('should send the selected response overwrite mode', () => {
      const options: ImportOptions = {
        responses: 'true',
        definitions: 'false',
        units: 'false',
        player: 'false',
        codings: 'false',
        logs: 'false',
        testTakers: 'false',
        booklets: 'false',
        metadata: 'false'
      };

      service.importWorkspaceFiles(
        mockWorkspaceId,
        'ws1',
        'srv',
        'url',
        'tok',
        options,
        ['g1'],
        false,
        undefined,
        undefined,
        'merge'
      ).subscribe(res => {
        expect(res).toBeDefined();
      });

      const req = httpMock.expectOne(
        request => request.params.get('responseOverwriteMode') === 'merge'
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });
});
