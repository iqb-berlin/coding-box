import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { ReplayBackendService } from './replay-backend.service';
import { SERVER_URL } from '../../injection-tokens';

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

  describe('getReplayPayload', () => {
    it('should fetch split replay assets and response and merge them', done => {
      service.getReplayPayload(1, 'person@code@booklet', 'unit 1', 'url-token')
        .subscribe(result => {
          expect(result).toEqual({
            unitDef: [{ data: 'unitDef data', file_id: 'UNIT-1.VOUD' }],
            player: [{ data: 'player data', file_id: 'PLAYER-1.0' }],
            vocs: [{ data: 'vocs data', file_id: 'UNIT-1.VOCS' }],
            response: { responses: [{ id: 'var1', content: '[]' }] }
          });
          done();
        });

      const assetsReq = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/replay-assets/unit%201`);
      expect(assetsReq.request.method).toBe('GET');
      expect(assetsReq.request.headers.get('Authorization')).toBe('Bearer url-token');
      assetsReq.flush({
        unitDef: [{ data: 'unitDef data', file_id: 'UNIT-1.VOUD' }],
        player: [{ data: 'player data', file_id: 'PLAYER-1.0' }],
        vocs: [{ data: 'vocs data', file_id: 'UNIT-1.VOCS' }]
      });

      const responseReq = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/replay-response/person%40code%40booklet/unit%201`);
      expect(responseReq.request.method).toBe('GET');
      expect(responseReq.request.headers.get('Authorization')).toBe('Bearer url-token');
      responseReq.flush({
        response: { responses: [{ id: 'var1', content: '[]' }] }
      });
    });
  });

  describe('getReplayAssets', () => {
    it('should fetch assets with the stored auth token when no URL token is supplied', () => {
      service.getReplayAssets(1, 'unit-1').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/1/replay-assets/unit-1`);
      expect(req.request.method).toBe('GET');
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
});
