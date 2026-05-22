import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { WorkspaceSettingsService } from './workspace-settings.service';
import { SERVER_URL } from '../../injection-tokens';

describe('WorkspaceSettingsService', () => {
  let service: WorkspaceSettingsService;
  let httpMock: HttpTestingController;

  const mockServerUrl = 'http://localhost/api';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        WorkspaceSettingsService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(WorkspaceSettingsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getWorkspaceSetting', () => {
    it('should fetch setting', () => {
      service.getWorkspaceSetting(1, 'k').subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/k`);
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('setWorkspaceSetting', () => {
    it('should post setting', () => {
      service.setWorkspaceSetting(1, 'k', 'v').subscribe();
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ key: 'k', value: 'v', description: undefined });
      req.flush({});
    });
  });

  describe('getAutoFetchCodingStatistics', () => {
    it('should return parsed boolean', () => {
      service.getAutoFetchCodingStatistics(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-fetch-coding-statistics`);
      req.flush({ value: '{"enabled":true}' });
    });

    it('should return true on error', () => {
      service.getAutoFetchCodingStatistics(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-fetch-coding-statistics`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getShowTestResultsLogAnomalies', () => {
    it('should return parsed boolean', () => {
      service.getShowTestResultsLogAnomalies(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/show-test-results-log-anomalies`);
      req.flush({ value: '{"enabled":true}' });
    });

    it('should return false on invalid JSON', () => {
      service.getShowTestResultsLogAnomalies(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/show-test-results-log-anomalies`);
      req.flush({ value: 'not-json' });
    });

    it('should return false on error', () => {
      service.getShowTestResultsLogAnomalies(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/show-test-results-log-anomalies`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('setShowTestResultsLogAnomalies', () => {
    it('should persist the setting', () => {
      service.setShowTestResultsLogAnomalies(1, true).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'show-test-results-log-anomalies',
        value: '{"enabled":true}',
        description: 'Controls whether log anomaly information is shown on the test results page'
      });
      req.flush({});
    });
  });

  describe('getAggregationThreshold', () => {
    it('should return a persisted threshold', () => {
      service.getAggregationThreshold(1).subscribe(val => {
        expect(val).toBe(12);
      });

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/duplicate-aggregation-threshold`);
      expect(req.request.method).toBe('GET');
      req.flush({ value: '12' });
    });

    it('should clamp invalid persisted thresholds to the supported range', () => {
      service.getAggregationThreshold(1).subscribe(val => {
        expect(val).toBe(100);
      });

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/duplicate-aggregation-threshold`);
      req.flush({ value: '250' });
    });

    it('should preserve disabled persisted thresholds', () => {
      service.getAggregationThreshold(1).subscribe(val => {
        expect(val).toBeNull();
      });

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/duplicate-aggregation-threshold`);
      req.flush({ value: 'disabled' });
    });
  });

  describe('setAggregationThreshold', () => {
    it('should persist a normalized threshold', () => {
      service.setAggregationThreshold(1, 1).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'duplicate-aggregation-threshold',
        value: '2',
        description: 'Minimum number of identical responses required for aggregation'
      });
      req.flush({});
    });

    it('should persist disabled thresholds explicitly', () => {
      service.setAggregationThreshold(1, null).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'duplicate-aggregation-threshold',
        value: 'disabled',
        description: 'Minimum number of identical responses required for aggregation'
      });
      req.flush({});
    });
  });
});
