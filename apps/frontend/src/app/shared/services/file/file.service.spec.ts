import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { FileService } from './file.service';
import { TestResultService } from '../test-result/test-result.service';
import { SERVER_URL } from '../../../injection-tokens';
import { ValidationTaskStateService } from '../validation/validation-task-state.service';

describe('FileService', () => {
  let service: FileService;
  let httpMock: HttpTestingController;
  let testResultServiceMock: jest.Mocked<TestResultService>;
  let validationTaskStateServiceMock: { invalidateWorkspace: jest.Mock };

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    testResultServiceMock = {
      invalidateCache: jest.fn()
    } as unknown as jest.Mocked<TestResultService>;
    validationTaskStateServiceMock = {
      invalidateWorkspace: jest.fn()
    };

    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        FileService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: TestResultService, useValue: testResultServiceMock },
        {
          provide: ValidationTaskStateService,
          useValue: validationTaskStateServiceMock
        },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(FileService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('reads metadata through the restricted read-only endpoint', () => {
    const response = { filename: 'UNIT.vomd', base64Data: 'e30=', mimeType: 'application/json' };
    service.readMetadataFile(1, 7).subscribe(result => expect(result).toEqual(response));
    const request = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/files/7/metadata`);
    expect(request.request.method).toBe('GET');
    request.flush(response);
  });

  describe('getFilesList', () => {
    it('should get files list with parameters', () => {
      const mockResponse = {
        data: [], total: 0, page: 1, limit: 10, fileTypes: []
      };

      service.getFilesList(mockWorkspaceId, 1, 10, 'xml', '100', 'test').subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` &&
        request.params.get('page') === '1' &&
        request.params.get('limit') === '10' &&
        request.params.get('fileType') === 'xml' &&
        request.params.get('fileSize') === '100' &&
        request.params.get('searchText') === 'test'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('deleteFiles', () => {
    it('should batch delete requests', () => {
      // Create 150 IDs
      const fileIds = Array.from({ length: 150 }, (_, i) => i + 1);

      service.deleteFiles(mockWorkspaceId, fileIds).subscribe(result => {
        expect(result).toBe(true);
      });

      // Sequential requests:
      // First batch (0-100)
      const req1 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      const firstBatchIds = req1.request.params.get('fileIds');
      expect(firstBatchIds?.split(',').length).toBe(100);
      req1.flush(true);

      // Second batch (100-150) - Only appears after first one resolves
      const req2 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      const secondBatchIds = req2.request.params.get('fileIds');
      expect(secondBatchIds?.split(',').length).toBe(50);
      req2.flush(true);

      expect(validationTaskStateServiceMock.invalidateWorkspace).toHaveBeenCalledWith(mockWorkspaceId);
    });

    it('should invalidate validation state when the backend handles the request but reports false', () => {
      const fileIds = [1, 2, 3];

      service.deleteFiles(mockWorkspaceId, fileIds).subscribe(result => {
        expect(result).toBe(false);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` &&
        request.method === 'DELETE'
      );
      expect(req.request.params.get('fileIds')).toBe('1,2,3');
      req.flush(false);

      expect(validationTaskStateServiceMock.invalidateWorkspace).toHaveBeenCalledWith(mockWorkspaceId);
    });

    it('should expose whether a failed delete response was handled by the backend', () => {
      service.deleteFilesWithResult(mockWorkspaceId, [1, 2, 3]).subscribe(result => {
        expect(result).toEqual({
          success: false,
          requestHandled: true
        });
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` &&
        request.method === 'DELETE'
      );
      req.flush(false);

      expect(validationTaskStateServiceMock.invalidateWorkspace).toHaveBeenCalledWith(mockWorkspaceId);
    });

    it('should stop deleting further batches after a failed batch', () => {
      const fileIds = Array.from({ length: 150 }, (_, i) => i + 1);

      service.deleteFiles(mockWorkspaceId, fileIds).subscribe(result => {
        expect(result).toBe(false);
      });

      const req1 = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      req1.flush('failed', { status: 500, statusText: 'Server Error' });

      httpMock.expectNone(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      expect(validationTaskStateServiceMock.invalidateWorkspace).not.toHaveBeenCalled();
    });

    it('should isolate handled delete state per subscription', () => {
      const request$ = service.deleteFiles(mockWorkspaceId, [1]);

      request$.subscribe(result => {
        expect(result).toBe(true);
      });
      const firstReq = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      firstReq.flush(true);
      expect(validationTaskStateServiceMock.invalidateWorkspace).toHaveBeenCalledWith(mockWorkspaceId);

      validationTaskStateServiceMock.invalidateWorkspace.mockClear();

      request$.subscribe(result => {
        expect(result).toBe(false);
      });
      const secondReq = httpMock.expectOne(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files` && req.method === 'DELETE');
      secondReq.flush('failed', { status: 500, statusText: 'Server Error' });

      expect(validationTaskStateServiceMock.invalidateWorkspace).not.toHaveBeenCalled();
    });

    it('should return false without a request when no file IDs are provided', () => {
      service.deleteFiles(mockWorkspaceId, []).subscribe(result => {
        expect(result).toBe(false);
      });

      httpMock.expectNone(req => req.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/files`);
      expect(validationTaskStateServiceMock.invalidateWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('uploadTestFiles', () => {
    it('should upload FormData', () => {
      const file = new File(['content'], 'test.xml', { type: 'text/xml' });
      const fileList = {
        0: file,
        length: 1,
        item: () => file
      } as unknown as FileList;

      service.uploadTestFiles(mockWorkspaceId, fileList).subscribe();

      const req = httpMock.expectOne(request => request.url.includes('/upload'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body instanceof FormData).toBe(true);
      expect(req.request.body.has('files')).toBe(true);
      req.flush({});
    });
  });
  describe('chunked result uploads', () => {
    const file = new File(['abcdefghij'], 'results.csv', { type: 'text/csv' });
    const url = `${mockServerUrl}admin/workspace/1/upload/results`;

    it('waits for each chunk acknowledgement, refreshes authorization and completes with the selected import policy', () => {
      const progress = jest.fn();
      const received = jest.fn();
      service.uploadTestResultsChunked(1, file, 'responses', {
        overwriteExisting: true,
        overwriteMode: 'merge',
        scope: 'variable',
        filters: { groupName: 'A & B', variableId: 'VAR' }
      }, progress).subscribe(received);
      const init = httpMock.expectOne(`${url}/responses/init`);
      expect(init.request.body).toEqual({ fileName: 'results.csv', fileSize: 10, mimeType: 'text/csv' });
      init.flush({ uploadId: 'upload-1', chunkSize: 4, totalChunks: 3 });

      const first = httpMock.expectOne(`${url}/upload-1/chunk/0`);
      expect(first.request.method).toBe('PUT');
      expect(first.request.body.size).toBe(4);
      expect(first.request.headers.get('Content-Type')).toBe('application/octet-stream');
      httpMock.expectNone(`${url}/upload-1/chunk/1`);
      expect(progress).not.toHaveBeenCalled();
      jest.mocked(window.localStorage.getItem).mockReturnValue('refreshed-token');
      first.flush({});
      expect(progress).toHaveBeenLastCalledWith(33);
      const second = httpMock.expectOne(`${url}/upload-1/chunk/1`);
      expect(second.request.headers.get('Authorization')).toBe('Bearer refreshed-token');
      second.flush({});
      expect(progress).toHaveBeenLastCalledWith(67);
      const third = httpMock.expectOne(`${url}/upload-1/chunk/2`);
      expect(third.request.body.size).toBe(2);
      third.flush({});
      expect(progress).toHaveBeenLastCalledWith(100);
      const complete = httpMock.expectOne(`${url}/upload-1/complete`);
      expect(complete.request.body).toEqual({
        overwriteExisting: true, overwriteMode: 'merge', scope: 'variable', groupName: 'A & B', variableId: 'VAR'
      });
      expect(received).not.toHaveBeenCalled();
      complete.flush([]);
      expect(received).toHaveBeenCalledWith([]);
    });

    it('stops after a rejected chunk without reporting completion or sending later chunks', () => {
      const progress = jest.fn();
      const failed = jest.fn();
      service.uploadTestResultsChunked(1, file, 'logs', {}, progress).subscribe({ error: failed });
      httpMock.expectOne(`${url}/logs/init`).flush({ uploadId: 'upload-2', chunkSize: 4, totalChunks: 3 });
      httpMock.expectOne(`${url}/upload-2/chunk/0`).flush({});
      httpMock.expectOne(`${url}/upload-2/chunk/1`).flush('failed', { status: 503, statusText: 'Unavailable' });
      expect(failed).toHaveBeenCalled();
      expect(progress.mock.calls).toEqual([[33]]);
      httpMock.expectNone(`${url}/upload-2/chunk/2`);
      httpMock.expectNone(`${url}/upload-2/complete`);
    });

    it('cancels the current upload request when the consumer unsubscribes', () => {
      const subscription = service.uploadTestResultsChunked(1, file, 'logs', {}).subscribe();
      httpMock.expectOne(`${url}/logs/init`).flush({ uploadId: 'upload-3', chunkSize: 4, totalChunks: 3 });
      const chunk = httpMock.expectOne(`${url}/upload-3/chunk/0`);
      subscription.unsubscribe();
      expect(chunk.cancelled).toBe(true);
      httpMock.expectNone(`${url}/upload-3/complete`);
    });
  });

  it('preserves supplied FormData, encodes overwrite IDs and invalidates validation only after a successful upload', () => {
    const form = new FormData();
    form.append('files', new File(['xml'], 'unit.xml'));
    const failed = jest.fn();
    service.uploadTestFiles(1, form, true, ['unit,1', 'unit 2']).subscribe({ error: failed });
    const request = httpMock.expectOne(req => req.url.includes('overwriteFileIds='));
    expect(request.request.body).toBe(form);
    expect(request.request.url).toContain('overwriteExisting=true&overwriteFileIds=unit%2C1%2Cunit%202');
    request.flush('failed', { status: 409, statusText: 'Conflict' });
    expect(failed).toHaveBeenCalled();
    expect(validationTaskStateServiceMock.invalidateWorkspace).not.toHaveBeenCalled();
  });

  it('submits result import filters without losing special characters', () => {
    service.uploadTestResults(1, null, 'logs', false, 'replace', 'variable', {
      groupName: 'A & B', bookletName: 'Book/1', unitNameOrAlias: 'Unit?', variableId: 'V=1', subform: 'S 1'
    }).subscribe();
    const req = httpMock.expectOne(request => request.url.includes('/upload/results/logs?'));
    const params = new URL(req.request.url).searchParams;
    expect(Object.fromEntries(params)).toEqual({
      overwriteExisting: 'false',
      overwriteMode: 'replace',
      scope: 'variable',
      groupName: 'A & B',
      bookletName: 'Book/1',
      unitNameOrAlias: 'Unit?',
      variableId: 'V=1',
      subform: 'S 1'
    });
    expect(req.request.body.getAll('files')).toEqual([]);
    req.flush([]);
  });

  it('keeps a successful earlier delete visible when a later batch fails', () => {
    const received = jest.fn();
    service.deleteFilesWithResult(1, Array.from({ length: 201 }, (_, index) => index + 1)).subscribe(received);
    const match = (req: import('@angular/common/http').HttpRequest<unknown>) => req.method === 'DELETE';
    httpMock.expectOne(match).flush(true);
    httpMock.expectOne(match).flush('failed', { status: 500, statusText: 'Error' });
    httpMock.expectNone(match);
    expect(received).toHaveBeenCalledWith({ success: false, requestHandled: true });
    expect(validationTaskStateServiceMock.invalidateWorkspace).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit replay token and carries person and availability options when loading booklet units', () => {
    service.getBookletUnits(1, 'BOOK', 'replay-token', { testPerson: 'login@code@group', includeReplayStatus: true }).subscribe();
    const req = httpMock.expectOne(request => request.url.endsWith('/booklet/BOOK/units'));
    expect(req.request.headers.get('Authorization')).toBe('Bearer replay-token');
    expect(req.request.params.get('testPerson')).toBe('login@code@group');
    expect(req.request.params.get('includeReplayStatus')).toBe('true');
    req.flush([]);
  });

  it.each([
    ['unit XML', () => service.getUnitContentXml(1, 'UNIT'), '/unit/UNIT/content', null],
    ['testtaker XML', () => service.getTestTakerContentXml(1, 'TESTTAKER'), '/files/testtakers/TESTTAKER/content', null],
    ['coding scheme', () => service.getCodingSchemeFile(1, 'SCHEME'), '/files/coding-scheme/SCHEME', null],
    ['units', () => service.getUnitsWithFileIds(1), '/files/units-with-file-ids', []],
    ['variables', () => service.getVariableInfoForScheme(1, 'SCHEME'), '/files/variable-info/SCHEME', []],
    ['item IDs', () => service.getItemIdsFromMetadata(1), '/files/item-ids', []],
    ['validation', () => service.validateFiles(1), '/files/validation', false]
  ] as const)('returns the documented fallback when %s is unavailable', (_label, load, suffix, fallback) => {
    const received = jest.fn();
    load().subscribe(received);
    httpMock.expectOne(`${mockServerUrl}admin/workspace/1${suffix}`).flush('failed', { status: 500, statusText: 'Error' });
    expect(received).toHaveBeenCalledWith(fallback);
  });

  it.each([true, false])('invalidates validation state for dummy testtaker creation only when success=%s', success => {
    service.createDummyTestTakerFile(1).subscribe();
    httpMock.expectOne(`${mockServerUrl}admin/workspace/1/files/create-dummy-testtaker`).flush(success);
    expect(validationTaskStateServiceMock.invalidateWorkspace).toHaveBeenCalledTimes(success ? 1 : 0);
  });
  it.each([
    ['definition', (token?: string) => service.getUnitDef(1, 'UNIT', token), '/UNIT/unitDef'],
    ['player', (token?: string) => service.getPlayer(1, 'PLAYER', token), '/player/PLAYER'],
    ['unit', (token?: string) => service.getUnit(1, 'UNIT', token), '/unit/UNIT']
  ] as const)('uses the replay token instead of the session token for a %s', (_label, load, suffix) => {
    load('external-replay-token').subscribe();
    const external = httpMock.expectOne(`${mockServerUrl}admin/workspace/1${suffix}`);
    expect(external.request.headers.get('Authorization')).toBe('Bearer external-replay-token');
    external.flush([]);
    load().subscribe();
    const session = httpMock.expectOne(`${mockServerUrl}admin/workspace/1${suffix}`);
    expect(session.request.headers.get('Authorization')).toBe('Bearer mock-token');
    session.flush([]);
  });

  it.each([
    ['unit', () => service.getUnitContentXml(1, 'UNIT'), '/unit/UNIT/content'],
    ['testtaker', () => service.getTestTakerContentXml(1, 'TESTTAKER'), '/files/testtakers/TESTTAKER/content']
  ] as const)('unwraps %s XML content without modifying the XML', (_label, load, suffix) => {
    const received = jest.fn();
    load().subscribe(received);
    httpMock.expectOne(`${mockServerUrl}admin/workspace/1${suffix}`).flush({ content: '<root id="A &amp; B" />' });
    expect(received).toHaveBeenCalledWith('<root id="A &amp; B" />');
  });

  it.each([
    ['booklet', () => service.getBookletInfo(1, 'BOOK', 'replay-token'), '/booklet/BOOK/info'],
    ['unit', () => service.getUnitInfo(1, 'UNIT', 'replay-token'), '/unit/UNIT/info']
  ] as const)('preserves %s metadata authorization errors for the caller', (_label, load, suffix) => {
    const failed = jest.fn();
    load().subscribe({ error: failed });
    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1${suffix}`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer replay-token');
    req.flush({ message: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
    expect(failed.mock.calls[0][0].status).toBe(403);
  });
});
