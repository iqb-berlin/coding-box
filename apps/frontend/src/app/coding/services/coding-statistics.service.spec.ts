import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { of } from 'rxjs';
import { CodingStatisticsService } from './coding-statistics.service';
import { AppService } from '../../core/services/app.service';
import { SERVER_URL } from '../../injection-tokens';

describe('CodingStatisticsService', () => {
  let service: CodingStatisticsService;
  let httpMock: HttpTestingController;
  let appServiceMock: jest.Mocked<AppService>;
  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    appServiceMock = {
      loggedUser: { sub: 'user' },
      createToken: jest.fn().mockReturnValue(of('auth-token'))
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

  it('should get replay URL', () => {
    const mockRes = { replayUrl: 'http://replay' };
    service.getReplayUrl(1, 123, 'token').subscribe(res => {
      expect(res.replayUrl).toBe('http://replay');
    });

    const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/coding/responses/123/replay-url?authToken=token`);
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });

  it('should get variable analysis', () => {
    const mockRes = {
      data: [], total: 0, page: 1, limit: 10
    };
    service.getVariableAnalysis(1, 1, 10, 'unit1').subscribe(res => {
      expect(res.total).toBe(0);
    });

    const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/1/coding/variable-analysis` &&
            request.params.get('unitId') === 'unit1'
    );
    expect(req.request.method).toBe('GET');
    req.flush(mockRes);
  });
});
