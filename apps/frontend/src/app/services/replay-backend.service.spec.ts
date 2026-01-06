import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ReplayBackendService } from './replay-backend.service';
import { SERVER_URL } from '../injection-tokens';

describe('ReplayBackendService', () => {
  let service: ReplayBackendService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api/';

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        ReplayBackendService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ReplayBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('storeReplayStatistics', () => {
    it('should post statistics', () => {
      const data = { unitId: 'u1', durationMilliseconds: 1000 };
      service.storeReplayStatistics(1, data).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/replay-statistics`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({});
    });
  });

  describe('getReplayFrequencyByUnit', () => {
    it('should fetch frequency with params', () => {
      service.getReplayFrequencyByUnit(1, { limit: 10 }).subscribe();
      const req = httpMock.expectOne(r => r.url === `${mockServerUrl}admin/workspace/1/replay-statistics/frequency` &&
            r.params.get('limit') === '10'
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });
});
