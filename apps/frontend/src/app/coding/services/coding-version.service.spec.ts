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
});
