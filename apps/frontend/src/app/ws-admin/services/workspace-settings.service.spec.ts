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

    it('should share an in-flight setting request', () => {
      const received: string[] = [];

      service.getWorkspaceSetting(1, 'k').subscribe(setting => {
        received.push(setting.value);
      });
      service.getWorkspaceSetting(1, 'k').subscribe(setting => {
        received.push(setting.value);
      });

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/k`);
      req.flush({ id: 1, key: 'k', value: 'v' });

      expect(received).toEqual(['v', 'v']);
    });

    it('should keep suppressed and default in-flight setting requests separate', () => {
      service.getWorkspaceSetting(1, 'k', true).subscribe();
      service.getWorkspaceSetting(1, 'k', false).subscribe();

      const requests = httpMock.match(`${mockServerUrl}/workspace/1/settings/k`);
      expect(requests).toHaveLength(2);
      requests[0].flush({ id: 1, key: 'k', value: 'quiet' });
      requests[1].flush({ id: 1, key: 'k', value: 'default' });
    });

    it('should reuse a recently fetched setting without a second request', () => {
      const received: string[] = [];

      service.getWorkspaceSetting(1, 'k').subscribe(setting => {
        received.push(setting.value);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/k`);
      req.flush({ id: 1, key: 'k', value: 'v' });

      service.getWorkspaceSetting(1, 'k').subscribe(setting => {
        received.push(setting.value);
      });
      httpMock.expectNone(`${mockServerUrl}/workspace/1/settings/k`);

      expect(received).toEqual(['v', 'v']);
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

    it('should invalidate cached settings after persisting a setting', () => {
      service.getWorkspaceSetting(1, 'k').subscribe();
      const getReq = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/k`);
      getReq.flush({ id: 1, key: 'k', value: 'old' });

      service.setWorkspaceSetting(1, 'k', 'new').subscribe();
      const postReq = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      postReq.flush({ id: 1, key: 'k', value: 'new' });

      service.getWorkspaceSetting(1, 'k').subscribe();
      const secondGetReq = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/k`);
      secondGetReq.flush({ id: 1, key: 'k', value: 'new' });
    });
  });

  describe('setWorkspaceSettings', () => {
    it('should post settings as one batch', () => {
      service.setWorkspaceSettings(1, [
        { key: 'one', value: '1', description: 'First' },
        { key: 'two', value: '2', description: 'Second' }
      ]).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/batch`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        settings: [
          { key: 'one', value: '1', description: 'First' },
          { key: 'two', value: '2', description: 'Second' }
        ]
      });
      req.flush([]);
    });

    it('should invalidate cached settings after persisting a batch', () => {
      service.getWorkspaceSetting(1, 'one').subscribe();
      const getReq = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/one`);
      getReq.flush({ id: 1, key: 'one', value: 'old' });

      service.setWorkspaceSettings(1, [
        { key: 'one', value: 'new' }
      ]).subscribe();
      const postReq = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/batch`);
      postReq.flush([{ id: 1, key: 'one', value: 'new' }]);

      service.getWorkspaceSetting(1, 'one').subscribe();
      const secondGetReq = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/one`);
      secondGetReq.flush({ id: 1, key: 'one', value: 'new' });
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

    it('should return false on error', () => {
      service.getAutoFetchCodingStatistics(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-fetch-coding-statistics`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getAutoRefreshManualCodingJobs', () => {
    it('should return parsed boolean', () => {
      service.getAutoRefreshManualCodingJobs(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-refresh-manual-coding-jobs`);
      req.flush({ value: '{"enabled":false}' });
    });

    it('should return true on error', () => {
      service.getAutoRefreshManualCodingJobs(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/auto-refresh-manual-coding-jobs`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('getReplayUrlExportMode', () => {
    it('should return parsed replay URL export mode', () => {
      service.getReplayUrlExportMode(1).subscribe(val => {
        expect(val).toBe('workspaceId');
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/replay-url-export-mode`);
      req.flush({ value: '{"mode":"workspaceId"}' });
    });

    it('should return auth mode on error', () => {
      service.getReplayUrlExportMode(1).subscribe(val => {
        expect(val).toBe('auth');
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/replay-url-export-mode`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('setReplayUrlExportMode', () => {
    it('should persist the replay URL export mode', () => {
      service.setReplayUrlExportMode(1, 'workspaceId').subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'replay-url-export-mode',
        value: '{"mode":"workspaceId"}',
        description:
          'Controls whether exported replay URLs use temporary auth tokens or workspace login links'
      });
      req.flush({});
    });
  });

  describe('setAutoRefreshManualCodingJobs', () => {
    it('should persist the setting', () => {
      service.setAutoRefreshManualCodingJobs(1, false).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'auto-refresh-manual-coding-jobs',
        value: '{"enabled":false}',
        description:
          'Controls whether coding status and manual coding views refresh automatically'
      });
      req.flush({});
    });
  });

  describe('getEvaluationMode', () => {
    it('should return parsed boolean', () => {
      service.getEvaluationMode(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/evaluation-mode`);
      req.flush({ value: '{"enabled":true}' });
    });

    it('should return false on error', () => {
      service.getEvaluationMode(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/evaluation-mode`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('setEvaluationMode', () => {
    it('should persist evaluation mode and disable expensive automatic refreshes', () => {
      service.setEvaluationMode(1, true).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/batch`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        settings: [
          {
            key: 'evaluation-mode',
            value: '{"enabled":true}',
            description:
              'Controls whether expensive automatic coding refreshes are disabled for evaluation sessions'
          },
          {
            key: 'auto-fetch-coding-statistics',
            value: '{"enabled":false}',
            description:
              'Controls whether coding statistics are automatically fetched in the coding management component'
          },
          {
            key: 'auto-refresh-manual-coding-jobs',
            value: '{"enabled":false}',
            description:
              'Controls whether coding status and manual coding views refresh automatically'
          }
        ]
      });
      req.flush([]);
    });

    it('should persist evaluation mode off and restore normal automatic refresh defaults', () => {
      service.setEvaluationMode(1, false).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/batch`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        settings: [
          {
            key: 'evaluation-mode',
            value: '{"enabled":false}',
            description:
              'Controls whether expensive automatic coding refreshes are disabled for evaluation sessions'
          },
          {
            key: 'auto-fetch-coding-statistics',
            value: '{"enabled":false}',
            description:
              'Controls whether coding statistics are automatically fetched in the coding management component'
          },
          {
            key: 'auto-refresh-manual-coding-jobs',
            value: '{"enabled":true}',
            description:
              'Controls whether coding status and manual coding views refresh automatically'
          }
        ]
      });
      req.flush([]);
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

  describe('getIncludeDeriveErrorInManualCoding', () => {
    it('should return parsed boolean', () => {
      service.getIncludeDeriveErrorInManualCoding(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/include-derive-error-in-manual-coding`);
      req.flush({ value: '{"enabled":true}' });
    });

    it('should return false on error', () => {
      service.getIncludeDeriveErrorInManualCoding(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/include-derive-error-in-manual-coding`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('setIncludeDeriveErrorInManualCoding', () => {
    it('should persist the setting', () => {
      service.setIncludeDeriveErrorInManualCoding(1, true).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'include-derive-error-in-manual-coding',
        value: '{"enabled":true}',
        description: 'Controls whether DERIVE_ERROR responses can be included in manual coding jobs'
      });
      req.flush({});
    });
  });

  describe('getEnableRegexSearch', () => {
    it('should return parsed boolean', () => {
      service.getEnableRegexSearch(1).subscribe(val => {
        expect(val).toBe(true);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/enable-regex-search`);
      req.flush({ value: '{"enabled":true}' });
    });

    it('should return false on error', () => {
      service.getEnableRegexSearch(1).subscribe(val => {
        expect(val).toBe(false);
      });
      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings/enable-regex-search`);
      req.flush({}, { status: 404, statusText: 'Not Found' });
    });
  });

  describe('setEnableRegexSearch', () => {
    it('should persist the setting', () => {
      service.setEnableRegexSearch(1, true).subscribe();

      const req = httpMock.expectOne(`${mockServerUrl}/workspace/1/settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        key: 'enable-regex-search',
        value: '{"enabled":true}',
        description: 'Controls whether selected workspace search fields interpret input as regular expressions'
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
