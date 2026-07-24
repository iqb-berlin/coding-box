import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import Keycloak from 'keycloak-js';
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
  const replayAssets = {
    unitDef: [{ data: 'unchanged unitDef data', file_id: 'UNIT-1.VOUD' }],
    player: [{ data: 'player data', file_id: 'PLAYER-1.0' }],
    vocs: [{ data: 'vocs data', file_id: 'UNIT-1.VOCS' }]
  };
  const keycloakMock: {
    tokenParsed?: { sub?: string };
    idTokenParsed?: { sub?: string };
  } = {
    tokenParsed: { sub: 'internal-user' }
  };

  beforeEach(() => {
    keycloakMock.tokenParsed = { sub: 'internal-user' };
    keycloakMock.idTokenParsed = undefined;
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
        { provide: Keycloak, useValue: keycloakMock },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(ReplayBackendService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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
          codingSessionMs: null,
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
      expect(req.request.headers.get('Authorization')).toBeNull();
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
      const parseSpy = jest.spyOn(JSON, 'parse');
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
          expect(parseSpy).not.toHaveBeenCalled();
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
      }, {
        headers: { 'Cache-Control': 'private, max-age=300' }
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

    it('should reuse assets while fetching each test person response', () => {
      const firstResult = jest.fn();
      const secondResult = jest.fn();
      const assetsWithCodingScheme = {
        ...replayAssets,
        vocs: [{
          data: JSON.stringify({
            id: 'scheme-1',
            label: 'Scheme',
            variableCodings: []
          }),
          file_id: 'UNIT-1.VOCS'
        }]
      };

      service.getReplayPayload(1, 'person-1@code@booklet', 'unit-1', 'url-token', true)
        .subscribe(firstResult);
      const firstAssetsRequest = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/1/replay-assets/unit-1`
      ));
      const firstResponseRequest = httpMock.expectOne(request => (
        request.url.includes('/replay-response/person-1%40code%40booklet/unit-1')
      ));
      firstAssetsRequest.flush(assetsWithCodingScheme, {
        headers: { 'Cache-Control': 'private, max-age=300' }
      });
      firstResponseRequest.flush({
        response: { responses: [{ id: 'chunk', content: 'first response' }] }
      });

      service.getReplayPayload(1, 'person-2@code@booklet', 'unit-1', 'url-token', true)
        .subscribe(secondResult);
      httpMock.expectNone(request => request.url.includes('/replay-assets/'));
      const secondResponseRequest = httpMock.expectOne(request => (
        request.url.includes('/replay-response/person-2%40code%40booklet/unit-1')
      ));
      secondResponseRequest.flush({
        response: { responses: [{ id: 'chunk', content: 'second response' }] }
      });

      expect(firstResult).toHaveBeenCalledWith(expect.objectContaining({
        unitDef: assetsWithCodingScheme.unitDef,
        response: { responses: [{ id: 'chunk', content: 'first response' }] }
      }));
      expect(secondResult).toHaveBeenCalledWith(expect.objectContaining({
        unitDef: assetsWithCodingScheme.unitDef,
        response: { responses: [{ id: 'chunk', content: 'second response' }] }
      }));
      const firstCodingScheme = firstResult.mock.calls[0][0].codingScheme;
      expect(firstCodingScheme).toEqual(expect.objectContaining({ id: 'scheme-1' }));
      expect(secondResult.mock.calls[0][0].codingScheme).toBe(firstCodingScheme);
    });

    it('should cancel only the response request when a combined payload is unsubscribed', () => {
      const subscription = service
        .getReplayPayload(1, 'person-1@code@booklet', 'unit-1', 'url-token')
        .subscribe();
      const assetsRequest = httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'));
      const responseRequest = httpMock.expectOne(
        request => request.url.includes('/replay-response/person-1%40code%40booklet/unit-1')
      );

      subscription.unsubscribe();

      expect(responseRequest.cancelled).toBe(true);
      expect(assetsRequest.cancelled).toBe(false);
      assetsRequest.flush(replayAssets, {
        headers: { 'Cache-Control': 'no-store' }
      });
    });
  });

  describe('getReplayAssets', () => {
    it('should fetch assets without a service-owned auth token when no URL token is supplied', () => {
      service.getReplayAssets(1, 'unit-1').subscribe();

      const req = httpMock.expectOne(request => {
        const expectedUrl = `${mockServerUrl}admin/workspace/1/replay-assets/unit-1`;
        return request.url === expectedUrl && request.params.get('replayPart') === 'assets';
      });
      expect(req.request.method).toBe('GET');
      expect(req.request.urlWithParams).toBe(
        `${mockServerUrl}admin/workspace/1/replay-assets/unit-1?replayPart=assets`
      );
      expect(req.request.headers.get('Authorization')).toBeNull();
      req.flush({ unitDef: [], player: [], vocs: [] });
    });

    it('should share an in-flight asset request and preserve the raw payload', () => {
      const firstResult = jest.fn();
      const secondResult = jest.fn();

      service.getReplayAssets(1, 'unit-1', 'url-token').subscribe(firstResult);
      service.getReplayAssets(1, 'unit-1', 'url-token').subscribe(secondResult);

      const requests = httpMock.match(request => request.url.includes('/replay-assets/unit-1'));
      expect(requests).toHaveLength(1);
      requests[0].flush(replayAssets, {
        headers: { 'Cache-Control': 'private, max-age=300' }
      });

      expect(firstResult).toHaveBeenCalledWith(replayAssets);
      expect(secondResult).toHaveBeenCalledWith(replayAssets);
      expect(firstResult.mock.calls[0][0].unitDef[0].data).toBe('unchanged unitDef data');
    });

    it('should keep cache entries separate by workspace, unit, and auth context', () => {
      service.getReplayAssets(1, 'unit-1', 'token-a').subscribe();
      service.getReplayAssets(1, 'unit-1', 'token-b').subscribe();
      service.getReplayAssets(1, 'unit-2', 'token-a').subscribe();
      service.getReplayAssets(2, 'unit-1', 'token-a').subscribe();

      const requests = httpMock.match(request => request.url.includes('/replay-assets/'));
      expect(requests).toHaveLength(4);
      expect(requests.map(request => [
        request.request.url,
        request.request.headers.get('Authorization')
      ])).toEqual(expect.arrayContaining([
        [`${mockServerUrl}admin/workspace/1/replay-assets/unit-1`, 'Bearer token-a'],
        [`${mockServerUrl}admin/workspace/1/replay-assets/unit-1`, 'Bearer token-b'],
        [`${mockServerUrl}admin/workspace/1/replay-assets/unit-2`, 'Bearer token-a'],
        [`${mockServerUrl}admin/workspace/2/replay-assets/unit-1`, 'Bearer token-a']
      ]));
      requests.forEach(request => request.flush(replayAssets, {
        headers: { 'Cache-Control': 'private, max-age=300' }
      }));
    });

    it('should keep cache entries separate when the signed-in user changes', () => {
      service.getReplayAssets(1, 'unit-1').subscribe();
      const firstRequest = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/replay-assets/unit-1?replayPart=assets`
      );
      firstRequest.flush(replayAssets, {
        headers: { 'Cache-Control': 'private, max-age=300' }
      });

      keycloakMock.tokenParsed = { sub: 'different-internal-user' };
      service.getReplayAssets(1, 'unit-1').subscribe();
      const secondRequest = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/1/replay-assets/unit-1?replayPart=assets`
      );
      secondRequest.flush(replayAssets, {
        headers: { 'Cache-Control': 'private, max-age=300' }
      });
    });

    it('should reload assets after the server max-age expires', () => {
      jest.useFakeTimers();

      service.getReplayAssets(1, 'unit-1').subscribe();
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush(replayAssets, {
          headers: { 'Cache-Control': 'private, max-age=1' }
        });

      jest.advanceTimersByTime(1000);
      service.getReplayAssets(1, 'unit-1').subscribe();
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush(replayAssets, {
          headers: { 'Cache-Control': 'private, max-age=1' }
        });
    });

    it('should not retain assets when browser caching is disabled', () => {
      service.getReplayAssets(1, 'unit-1').subscribe();
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush(replayAssets, {
          headers: { 'Cache-Control': 'no-store' }
        });

      service.getReplayAssets(1, 'unit-1').subscribe();
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush(replayAssets, {
          headers: { 'Cache-Control': 'private, max-age=0' }
        });
    });

    it('should evict failed asset requests', () => {
      service.getReplayAssets(1, 'unit-1').subscribe({ error: () => undefined });
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush('failed', { status: 500, statusText: 'Server Error' });

      service.getReplayAssets(1, 'unit-1').subscribe();
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush(replayAssets, {
          headers: { 'Cache-Control': 'private, max-age=300' }
        });
    });

    it('should abort and evict an asset request that exceeds the in-flight timeout', () => {
      jest.useFakeTimers();
      const errorHandler = jest.fn();

      service.getReplayAssets(1, 'unit-1').subscribe({ error: errorHandler });
      const timedOutRequest = httpMock.expectOne(
        request => request.url.includes('/replay-assets/unit-1')
      );

      jest.advanceTimersByTime(120_001);

      expect(timedOutRequest.cancelled).toBe(true);
      expect(errorHandler).toHaveBeenCalledTimes(1);

      service.getReplayAssets(1, 'unit-1').subscribe();
      httpMock.expectOne(request => request.url.includes('/replay-assets/unit-1'))
        .flush(replayAssets, {
          headers: { 'Cache-Control': 'no-store' }
        });
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
