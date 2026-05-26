import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi
} from '@angular/common/http';
import { VariableAnalysisService } from './variable-analysis.service';
import { SERVER_URL } from '../../../injection-tokens';

describe('VariableAnalysisService', () => {
  let service: VariableAnalysisService;
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
        VariableAnalysisService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(VariableAnalysisService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('createAnalysisJob', () => {
    it('should create job with optional params', () => {
      service.createAnalysisJob(mockWorkspaceId, 10, 'var1').subscribe();

      const req = httpMock.expectOne(
        r => r.url ===
            `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs` &&
          r.params.get('unitId') === '10' &&
          r.params.get('variableId') === 'var1'
      );
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('cancelJob', () => {
    it('should cancel job', () => {
      service.cancelJob(mockWorkspaceId, 5).subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs/5/cancel`
      );
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('getAnalysisResultsPage', () => {
    it('should load paginated results with query params', () => {
      service
        .getAnalysisResultsPage(mockWorkspaceId, 5, {
          page: 2,
          pageSize: 100,
          search: 'VAR',
          onlyEmpty: true
        })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url ===
            `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs/5/results/page` &&
          r.params.get('page') === '2' &&
          r.params.get('pageSize') === '100' &&
          r.params.get('search') === 'VAR' &&
          r.params.get('onlyEmpty') === 'true'
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });
});
