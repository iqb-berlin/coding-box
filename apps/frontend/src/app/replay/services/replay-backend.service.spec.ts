import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ReplayBackendService } from './replay-backend.service';
import { SERVER_URL } from '../../injection-tokens';
import {
  SUPPRESS_AUTH_ERROR_REDIRECT,
  SUPPRESS_GLOBAL_HTTP_ERROR
} from '../../core/interceptors/http-error-context';

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
      const data = {
        unitId: 'u1',
        durationMilliseconds: 1000,
        clientTimings: {
          payloadMs: 100,
          routeToVisibleMs: null,
          loadToVisibleMs: 200,
          routeToPayloadRequestMs: null,
          payloadToVisibleMs: 50,
          payloadToPlayerReadyMs: 20,
          playerReadyToVisibleMs: 30
        },
        serverTimings: {
          responseTotalMs: 5
        }
      };
      service.storeReplayStatistics(1, data).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/replay-statistics`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      expect(req.request.headers.get('Authorization')).toBe('Bearer mock-token');
      expect(req.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      expect(req.request.context.get(SUPPRESS_AUTH_ERROR_REDIRECT)).toBe(true);
      req.flush({});
    });

    it('should use the replay auth token when supplied', () => {
      const data = {
        unitId: 'u1',
        durationMilliseconds: 1000
      };
      service.storeReplayStatistics(1, data, 'url-token').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/replay-statistics`);
      expect(req.request.method).toBe('POST');
      expect(req.request.headers.get('Authorization')).toBe('Bearer url-token');
      expect(req.request.context.get(SUPPRESS_GLOBAL_HTTP_ERROR)).toBe(true);
      expect(req.request.context.get(SUPPRESS_AUTH_ERROR_REDIRECT)).toBe(true);
      req.flush({});
    });
  });

  describe('getReplayPayload', () => {
    it('should fetch split replay assets and response and merge them', done => {
      service.getReplayPayload(1, 'person@code@booklet', 'unit 1', 'url-token')
        .subscribe(result => {
          expect(result).toEqual({
            unitDef: [{ data: 'unitDef data', file_id: 'UNIT-1.VOUD' }],
            player: [{ data: 'player data', file_id: 'PLAYER-1.0' }],
            vocs: [{ data: 'vocs data', file_id: 'UNIT-1.VOCS' }],
            response: { responses: [{ id: 'var1', content: '[]' }] },
            serverTimings: {
              responseFindUnitResponseMs: 3,
              responseTotalMs: 4
            }
          });
          done();
        });

      const assetsReq = httpMock.expectOne(req => {
        const expectedUrl = `${mockServerUrl}admin/workspace/1/replay-assets/unit%201`;
        return req.url === expectedUrl && req.params.get('replayPart') === 'assets';
      });
      expect(assetsReq.request.method).toBe('GET');
      expect(assetsReq.request.urlWithParams).toBe(
        `${mockServerUrl}admin/workspace/1/replay-assets/unit%201?replayPart=assets`
      );
      expect(assetsReq.request.headers.get('Authorization')).toBe('Bearer url-token');
      assetsReq.flush({
        unitDef: [{ data: 'unitDef data', file_id: 'UNIT-1.VOUD' }],
        player: [{ data: 'player data', file_id: 'PLAYER-1.0' }],
        vocs: [{ data: 'vocs data', file_id: 'UNIT-1.VOCS' }]
      });

      const responseReq = httpMock.expectOne(req => {
        const expectedUrl = `${mockServerUrl}admin/workspace/1/replay-response/person%40code%40booklet/unit%201`;
        return req.url === expectedUrl && req.params.get('replayPart') === 'response';
      });
      expect(responseReq.request.method).toBe('GET');
      expect(responseReq.request.urlWithParams).toBe(
        `${mockServerUrl}admin/workspace/1/replay-response/person%40code%40booklet/unit%201?replayPart=response`
      );
      expect(responseReq.request.headers.get('Authorization')).toBe('Bearer url-token');
      responseReq.flush({
        response: { responses: [{ id: 'var1', content: '[]' }] },
        serverTimings: {
          findUnitResponseMs: 3,
          totalMs: 4
        }
      });
    });
  });

  describe('getReplayAssets', () => {
    it('should fetch assets with the stored auth token when no URL token is supplied', () => {
      service.getReplayAssets(1, 'unit-1').subscribe();

      const req = httpMock.expectOne(request => {
        const expectedUrl = `${mockServerUrl}admin/workspace/1/replay-assets/unit-1`;
        return request.url === expectedUrl && request.params.get('replayPart') === 'assets';
      });
      expect(req.request.method).toBe('GET');
      expect(req.request.urlWithParams).toBe(
        `${mockServerUrl}admin/workspace/1/replay-assets/unit-1?replayPart=assets`
      );
      expect(req.request.headers.get('Authorization')).toBe('Bearer mock-token');
      req.flush({ unitDef: [], player: [], vocs: [] });
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

  describe('getReplaySourceSummary', () => {
    it('should fetch source summary with time params', () => {
      service.getReplaySourceSummary(1, { lastDays: 30 }).subscribe();

      const req = httpMock.expectOne(r => r.url === `${mockServerUrl}admin/workspace/1/replay-statistics/sources` &&
        r.params.get('lastDays') === '30'
      );
      expect(req.request.method).toBe('GET');
      req.flush({
        internal: 3,
        external: 2,
        total: 5
      });
    });
  });
});
