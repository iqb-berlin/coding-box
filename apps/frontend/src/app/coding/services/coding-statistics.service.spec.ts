import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { CodingStatisticsService } from './coding-statistics.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';
import { SUPPRESS_GLOBAL_HTTP_ERROR } from '../../core/interceptors/http-error-context';

describe('CodingStatisticsService', () => {
  let service: CodingStatisticsService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    appServiceMock = {
      loggedUser: { sub: 'user' },
      createOwnToken: jest.fn().mockReturnValue(of('auth-token'))
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        CodingStatisticsService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: AppService, useValue: appServiceMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(CodingStatisticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should get coding statistics', () => {
    const mockRes = { totalResponses: 10, statusCounts: {} };
    service.getCodingStatistics(1, 'v2').subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/statistics?version=v2`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should get coding freshness', () => {
    const mockRes = {
      workspaceId: 1,
      currentRevision: 2,
      items: [
        {
          version: 'v1' as const,
          state: 'STALE' as const,
          unitCount: 3,
          affectedResponseCount: 12
        }
      ]
    };
    service.getCodingFreshness(1).subscribe(res => {
      expect(res).toEqual(mockRes);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/freshness`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should get responses by status', () => {
    const mockRes = {
      data: [], total: 0, page: 1, limit: 100
    };
    service.getResponsesByStatus(1, 'pending', 'v1').subscribe(res => {
      expect(res.total).toBe(0);
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/responses/pending?version=v1&page=1&limit=100`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should pass response sort params when getting responses by status', () => {
    const mockRes = {
      data: [], total: 0, page: 2, limit: 50
    };
    service.getResponsesByStatus(1, 'pending', 'v2', 2, 50, 'score', 'desc').subscribe(res => {
      expect(res.total).toBe(0);
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/responses/pending` &&
      request.params.get('version') === 'v2' &&
      request.params.get('page') === '2' &&
      request.params.get('limit') === '50' &&
      request.params.get('sortBy') === 'score' &&
      request.params.get('sortDirection') === 'desc'
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should get replay URL', () => {
    const mockRes = { replayUrl: 'http://replay' };
    service.getReplayUrl(1, 123).subscribe(res => {
      expect(res.replayUrl).toBe('http://replay');
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/responses/123/replay-url`);
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
    req.flush(mockRes);
  });

  it('should get variable analysis', () => {
    const mockRes = {
      data: [], total: 0, page: 1, limit: 10
    };
    service.getVariableAnalysis(1, 1, 10, 'unit1', 'VAR_.*', undefined, true).subscribe(res => {
      expect(res.total).toBe(0);
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/variable-analysis` &&
            request.params.get('unitId') === 'unit1' &&
            request.params.get('variableId') === 'VAR_.*' &&
            request.params.get('regexSearch') === 'true'
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });
});
