import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { CodingVersionService } from './coding-version.service';
import { SERVER_URL } from '../../injection-tokens';

describe('CodingVersionService', () => {
  let service: CodingVersionService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CodingVersionService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingVersionService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts a read-only preview with the exact selected scope and polls its result', () => {
    const scope = { version: 'v1' as const, unitFilters: ['DHB003'], variableFilters: ['V1'] };
    service.previewReset(5, scope).subscribe();
    const start = httpMock.expectOne(`${mockServerUrl}admin/workspace/5/coding/reset-version/preview`);
    expect(start.request.method).toBe('POST');
    expect(start.request.body).toEqual(scope);
    start.flush({ jobId: 'preview-1' });
    service.getResetPreview(5, 'preview-1').subscribe(status => expect(status.status).toBe('processing'));
    httpMock.expectOne(`${mockServerUrl}admin/workspace/5/coding/reset-version/preview/preview-1`)
      .flush({ status: 'processing' });
  });

  it('should reset coding version', () => {
    const mockRes = {
      affectedResponseCount: 10,
      cascadeResetVersions: ['v2'] as ('v2' | 'v3')[],
      message: 'Success'
    };

    service.resetCodingVersion(1, 'v1', ['u1'], ['v1']).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/reset-version`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      version: 'v1',
      unitFilters: ['u1'],
      variableFilters: ['v1']
    });
    req.flush(mockRes);
  });

  it.each([
    { unitFilters: undefined, variableFilters: undefined },
    { unitFilters: ['DHB003'], variableFilters: undefined },
    { unitFilters: undefined, variableFilters: ['V1'] }
  ])('sends the selected reset filters %j', ({ unitFilters, variableFilters }) => {
    service.resetCodingVersion(1, 'v1', unitFilters, variableFilters).subscribe();

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/reset-version`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ version: 'v1', unitFilters: unitFilters ?? [], variableFilters: variableFilters ?? [] });
    req.flush({ jobId: 'reset-1', message: 'Started' });
  });
});
