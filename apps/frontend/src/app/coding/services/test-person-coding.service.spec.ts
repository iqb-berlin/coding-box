import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import Keycloak from 'keycloak-js';
import {
  TestPersonCodingService,
  CodingStatistics,
  PaginatedCodingList,
  JobStatus,
  JobInfo,
  AppliedResultsOverview
} from './test-person-coding.service';
import { SERVER_URL } from '../../injection-tokens';
import { ResponseMatchingFlag } from '../../ws-admin/services/workspace-settings.service';
import { CodingBackgroundJobsService } from './coding-background-jobs.service';

describe('TestPersonCodingService', () => {
  let service: TestPersonCodingService;
  let httpMock: HttpTestingController;
  let codingBackgroundJobsService: CodingBackgroundJobsService;
  let keycloak: { authenticated: boolean; token?: string; updateToken: jest.Mock };
  let fetchMock: jest.Mock;
  let originalFetch: typeof globalThis.fetch | undefined;
  const mockServerUrl = 'http://localhost:3000/';
  const mockWorkspaceId = 123;
  const mockAuthToken = 'test-token';

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    keycloak = {
      authenticated: true,
      token: 'keycloak-token',
      updateToken: jest.fn().mockResolvedValue(true)
    };

    // Mock localStorage using Object.defineProperty
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue(mockAuthToken)
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        TestPersonCodingService,
        { provide: Keycloak, useValue: keycloak },
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(TestPersonCodingService);
    codingBackgroundJobsService = TestBed.inject(CodingBackgroundJobsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: unknown }).fetch;
    }
    try {
      httpMock.verify();
    } catch (error) {
      // Error in httpMock.verify() handled
    }
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('codeTestPersons', () => {
    it('should send a GET request to code test persons', () => {
      const mockTestPersonIds = '1,2,3';
      const mockResponse: CodingStatistics = {
        totalResponses: 3,
        statusCounts: { coded: 3 }
      };

      service.codeTestPersons(mockWorkspaceId, mockTestPersonIds).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding` && request.params.get('testPersons') === mockTestPersonIds && request.params.get('autoCoderRun') === '1');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBeNull();
      req.flush(mockResponse);
    });

    it('should handle errors and return empty statistics with an error message', () => {
      const mockTestPersonIds = '1,2,3';

      service.codeTestPersons(mockWorkspaceId, mockTestPersonIds).subscribe(response => {
        expect(response.totalResponses).toBe(0);
        expect(response.statusCounts).toEqual({});
        expect(response.message).toContain('Http failure response');
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding` && request.params.get('testPersons') === mockTestPersonIds && request.params.get('autoCoderRun') === '1');
      req.error(new ProgressEvent('error'));
    });

    it('should surface backend error messages when coding is blocked', () => {
      const mockTestPersonIds = '1,2,3';

      service.codeTestPersons(mockWorkspaceId, mockTestPersonIds, 2).subscribe(response => {
        expect(response).toEqual({
          totalResponses: 0,
          statusCounts: {},
          message: 'Der 2. Autocoder-Lauf kann nicht gestartet werden.'
        });
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding` && request.params.get('testPersons') === mockTestPersonIds && request.params.get('autoCoderRun') === '2');
      req.flush(
        { message: 'Der 2. Autocoder-Lauf kann nicht gestartet werden.' },
        { status: 400, statusText: 'Bad Request' }
      );
    });
  });

  describe('importExternalCodingWithProgress', () => {
    it('should attach a valid Keycloak token to streaming fetch imports', async () => {
      fetchMock = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });
      globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
      const onError = jest.fn();

      await service.importExternalCodingWithProgress(
        mockWorkspaceId,
        { file: 'content', fileName: 'coding.csv' },
        jest.fn(),
        jest.fn(),
        onError
      );

      expect(keycloak.updateToken).toHaveBeenCalledWith(30);
      expect(fetchMock).toHaveBeenCalledWith(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/external-coding-import/stream`,
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer keycloak-token'
          }
        })
      );
      expect(onError).toHaveBeenCalledWith('HTTP 401: Unauthorized');
    });
  });

  describe('getManualTestPersons', () => {
    it('should send a GET request to get manual test persons', () => {
      const mockResponse = [{ id: 1, name: 'Test Person 1' }];

      service.getManualTestPersons(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should include testPersons parameter when provided', () => {
      const mockTestPersonIds = '1,2,3';
      const mockResponse = [{ id: 1, name: 'Test Person 1' }];

      service.getManualTestPersons(mockWorkspaceId, mockTestPersonIds).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual?testPersons=${mockTestPersonIds}`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should include codedStatus parameter when provided', () => {
      const mockResponse = [{ id: 1, name: 'Test Person 1' }];

      service.getManualTestPersons(mockWorkspaceId, undefined, 'DERIVE_ERROR').subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual` &&
        request.params.get('codedStatus') === 'DERIVE_ERROR'
      ));
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty array', () => {
      service.getManualTestPersons(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/manual`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getCodingList', () => {
    it('should send a GET request to get coding list with correct parameters', () => {
      const mockServerUrlParam = 'http://test-server.com';
      const mockPage = 2;
      const mockLimit = 10;
      const mockResponse: PaginatedCodingList = {
        data: [{
          unit_key: 'key1',
          unit_alias: 'alias1',
          login_name: 'user1',
          login_code: 'code1',
          booklet_id: 'book1',
          variable_id: 'var1',
          variable_page: 'page1',
          variable_anchor: 'anchor1',
          url: 'url1'
        }],
        total: 1,
        page: mockPage,
        limit: mockLimit
      };

      service.getCodingList(mockWorkspaceId, mockAuthToken, mockServerUrlParam, mockPage, mockLimit).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list` &&
        request.params.get('authToken') === mockAuthToken &&
        request.params.get('serverUrl') === mockServerUrlParam &&
        request.params.get('page') === mockPage.toString() &&
        request.params.get('limit') === mockLimit.toString()
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty paginated list', () => {
      service.getCodingList(mockWorkspaceId, mockAuthToken).subscribe(response => {
        expect(response).toEqual({
          data: [],
          total: 0,
          page: 1,
          limit: 20
        });
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list`
      );
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getCodingStatistics', () => {
    it('should send a GET request to get coding statistics', () => {
      const mockResponse: CodingStatistics = {
        totalResponses: 10,
        statusCounts: { coded: 7, pending: 3 }
      };

      service.getCodingStatistics(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/statistics`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty statistics', () => {
      service.getCodingStatistics(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual({ totalResponses: 0, statusCounts: {} });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/statistics`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getAppliedResultsOverview', () => {
    it('should send a GET request to get applied results overview', () => {
      const mockResponse: AppliedResultsOverview = {
        totalIncompleteResponses: 2,
        appliedResponses: 1,
        remainingResponses: 1,
        completionPercentage: 50,
        rawTotalIncompleteResponses: 2,
        rawAppliedResponses: 1,
        rawCompletionPercentage: 50,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };

      service.getAppliedResultsOverview(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/applied-results-overview`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should return null when applied results overview cannot be loaded', () => {
      service.getAppliedResultsOverview(mockWorkspaceId).subscribe(response => {
        expect(response).toBeNull();
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/applied-results-overview`);
      req.error(new ProgressEvent('error'));
    });

    it('should reuse cached applied results overview until coding status is invalidated', () => {
      const mockResponse: AppliedResultsOverview = {
        totalIncompleteResponses: 2,
        appliedResponses: 1,
        remainingResponses: 1,
        completionPercentage: 50,
        rawTotalIncompleteResponses: 2,
        rawAppliedResponses: 1,
        rawCompletionPercentage: 50,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/applied-results-overview`;
      let cachedResponse: AppliedResultsOverview | null | undefined;

      service.getAppliedResultsOverview(mockWorkspaceId).subscribe();
      httpMock.expectOne(url).flush(mockResponse);

      service.getAppliedResultsOverview(mockWorkspaceId).subscribe(response => {
        cachedResponse = response;
      });
      httpMock.expectNone(url);
      expect(cachedResponse).toEqual(mockResponse);

      service.invalidateCodingStatusCache(mockWorkspaceId);
      service.getAppliedResultsOverview(mockWorkspaceId).subscribe();
      httpMock.expectOne(url).flush(mockResponse);
    });

    it('should not cache failed applied results overview fallbacks', () => {
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/applied-results-overview`;
      const mockResponse: AppliedResultsOverview = {
        totalIncompleteResponses: 2,
        appliedResponses: 1,
        remainingResponses: 1,
        completionPercentage: 50,
        rawTotalIncompleteResponses: 2,
        rawAppliedResponses: 1,
        rawCompletionPercentage: 50,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      };
      let firstResponse: AppliedResultsOverview | null | undefined;
      let secondResponse: AppliedResultsOverview | null | undefined;

      service.getAppliedResultsOverview(mockWorkspaceId).subscribe(response => {
        firstResponse = response;
      });
      httpMock.expectOne(url).error(new ProgressEvent('error'));
      expect(firstResponse).toBeNull();

      service.getAppliedResultsOverview(mockWorkspaceId).subscribe(response => {
        secondResponse = response;
      });
      httpMock.expectOne(url).flush(mockResponse);
      expect(secondResponse).toEqual(mockResponse);
    });

    it('should return null without requesting applied results overview while the status guard is active', () => {
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/applied-results-overview`;
      let response: AppliedResultsOverview | null | undefined;

      codingBackgroundJobsService.setJobRunning(
        mockWorkspaceId,
        'response-analysis',
        true,
        'analysis-1'
      );

      service.getAppliedResultsOverview(mockWorkspaceId).subscribe(result => {
        response = result;
      });

      httpMock.expectNone(url);
      expect(response).toBeNull();

      codingBackgroundJobsService.setJobRunning(
        mockWorkspaceId,
        'response-analysis',
        false,
        'analysis-1'
      );
    });
  });

  describe('getResponseAnalysis', () => {
    it('should request response analysis with threshold and pagination params', () => {
      const mockResponse = {
        emptyResponses: { total: 0, totalUncoded: 0, items: [] },
        duplicateValues: { total: 0, totalResponses: 0, groups: [] },
        matchingFlags: [],
        analysisTimestamp: '2026-05-14T00:00:00.000Z'
      };

      service.getResponseAnalysis(mockWorkspaceId, 7, 2, 25, 3, 50).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/response-analysis` &&
        request.params.get('threshold') === '7' &&
        request.params.get('emptyPage') === '2' &&
        request.params.get('emptyLimit') === '25' &&
        request.params.get('duplicatePage') === '3' &&
        request.params.get('duplicateLimit') === '50'
      );
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should propagate response analysis errors to the component', done => {
      service.getResponseAnalysis(mockWorkspaceId).subscribe({
        next: () => done.fail('expected response analysis request to fail'),
        error: error => {
          expect(error.status).toBe(500);
          done();
        }
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/response-analysis`);
      req.flush(
        { message: 'analysis failed' },
        { status: 500, statusText: 'Server Error' }
      );
    });

    it('should keep the response-analysis guard after transient polling errors', () => {
      jest.useFakeTimers();
      const setJobRunningSpy = jest.spyOn(codingBackgroundJobsService, 'setJobRunning');
      const invalidateCacheSpy = jest.spyOn(service, 'invalidateCodingStatusCache');
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/response-analysis`;

      try {
        service.trackResponseAnalysisGuardUntilComplete(mockWorkspaceId, 2);

        expect(setJobRunningSpy).toHaveBeenCalledWith(
          mockWorkspaceId,
          'response-analysis',
          true,
          'manual-response-analysis'
        );

        jest.advanceTimersByTime(5000);
        httpMock.expectOne(request => (
          request.url === url &&
          request.params.get('threshold') === '2'
        )).flush(
          { message: 'temporary error' },
          { status: 500, statusText: 'Server Error' }
        );
        expect(setJobRunningSpy).not.toHaveBeenCalledWith(
          mockWorkspaceId,
          'response-analysis',
          false,
          'manual-response-analysis'
        );

        jest.advanceTimersByTime(5000);
        httpMock.expectOne(request => (
          request.url === url &&
          request.params.get('threshold') === '2'
        )).flush({
          emptyResponses: { total: 0, totalUncoded: 0, items: [] },
          duplicateValues: { total: 0, totalResponses: 0, groups: [] },
          matchingFlags: [],
          analysisTimestamp: '2026-05-14T00:00:00.000Z',
          isCalculating: false
        });

        expect(invalidateCacheSpy).toHaveBeenCalledWith(mockWorkspaceId);
        expect(setJobRunningSpy).toHaveBeenLastCalledWith(
          mockWorkspaceId,
          'response-analysis',
          false,
          'manual-response-analysis'
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('getCodingProgressOverview', () => {
    it('should request coding progress overview', () => {
      const mockResponse = {
        totalCasesToCode: 12,
        completedCases: 7,
        completionPercentage: 58.33,
        rawTotalCasesToCode: 14,
        rawCompletedCases: 8,
        rawCompletionPercentage: 57.14,
        aggregationActive: true,
        aggregationThreshold: 2,
        aggregatedDuplicateCases: 2
      };

      service.getCodingProgressOverview(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/progress-overview`
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBeNull();
      req.flush(mockResponse);
    });

    it('should return null when coding progress overview is unavailable', () => {
      service.getCodingProgressOverview(mockWorkspaceId).subscribe(response => {
        expect(response).toBeNull();
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/progress-overview`
      );
      req.error(new ProgressEvent('error'));
    });
  });

  describe('aggregation settings', () => {
    it('should fetch aggregation settings through the authenticated coding endpoint', () => {
      const mockResponse = {
        success: true,
        threshold: 5,
        flags: [ResponseMatchingFlag.IGNORE_CASE],
        aggregationActive: true,
        revertedResponses: 0,
        message: 'ok'
      };

      service.getAggregationSettings(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/aggregation-settings`);
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBeNull();
      req.flush(mockResponse);
    });

    it('should persist threshold and matching flags through the central endpoint', () => {
      const mockResponse = {
        success: true,
        threshold: 9,
        flags: [ResponseMatchingFlag.NO_AGGREGATION],
        aggregationActive: false,
        revertedResponses: 2,
        message: 'saved'
      };

      service
        .saveAggregationSettings(mockWorkspaceId, 9, [ResponseMatchingFlag.NO_AGGREGATION])
        .subscribe(response => {
          expect(response).toEqual(mockResponse);
        });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/aggregation-settings`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        threshold: 9,
        flags: [ResponseMatchingFlag.NO_AGGREGATION]
      });
      expect(req.request.headers.get('Authorization')).toBeNull();
      req.flush(mockResponse);
    });
  });

  describe('getJobStatus', () => {
    it('should send a GET request to get job status', () => {
      const mockJobId = 'job-123';
      const mockResponse: JobStatus = {
        status: 'processing',
        progress: 50
      };

      service.getJobStatus(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return error object', () => {
      const mockJobId = 'job-123';

      service.getJobStatus(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual({ error: `Failed to get status for job ${mockJobId}` });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}`);
      req.error(new ProgressEvent('error'));
    });

    it('should not request job status when job id is missing', () => {
      service.getJobStatus(mockWorkspaceId, '').subscribe(response => {
        expect(response).toEqual({ error: 'Fehlende Job-ID für Statusabfrage' });
      });

      httpMock.expectNone(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/`);
    });
  });

  describe('cancelJob', () => {
    it('should send a GET request to cancel job', () => {
      const mockJobId = 'job-123';
      const mockResponse = { success: true, message: 'Job cancelled successfully' };

      service.cancelJob(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}/cancel`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return failure object', () => {
      const mockJobId = 'job-123';

      service.cancelJob(mockWorkspaceId, mockJobId).subscribe(response => {
        expect(response).toEqual({ success: false, message: `Failed to cancel job ${mockJobId}` });
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${mockJobId}/cancel`);
      req.error(new ProgressEvent('error'));
    });

    it('should not request cancellation when job id is missing', () => {
      service.cancelJob(mockWorkspaceId, ' ').subscribe(response => {
        expect(response).toEqual({ success: false, message: 'Fehlende Job-ID für Abbruch' });
      });

      httpMock.expectNone(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/ /cancel`);
    });
  });

  describe('getAllJobs', () => {
    it('should send a GET request to get all jobs', () => {
      const mockResponse: JobInfo[] = [
        {
          jobId: 'job-123',
          status: 'completed',
          progress: 100,
          result: { totalResponses: 5, statusCounts: { coded: 5 } }
        }
      ];

      service.getAllJobs(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/jobs`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty array', () => {
      service.getAllJobs(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/jobs`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getWorkspaceGroups', () => {
    it('should send a GET request to get workspace group coding stats', () => {
      const mockResponse = [
        { groupName: 'Group1', testPersonCount: 10, responsesToCode: 100 },
        { groupName: 'Group2', testPersonCount: 5, responsesToCode: 50 }
      ];

      service.getWorkspaceGroups(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/groups/stats`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle errors and return empty array', () => {
      service.getWorkspaceGroups(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual([]);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/groups/stats`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getDoubleCodedVariablesForReview', () => {
    it('should request double-coded review data with agreement and scope filters', () => {
      const mockResponse = {
        data: [{
          responseId: 10,
          unitName: 'UNIT_1',
          variableId: 'VAR_1',
          personLogin: 'person-1',
          personCode: 'P001',
          bookletName: 'BOOKLET_1',
          givenAnswer: 'answer',
          isResolved: false,
          appliedCode: null,
          appliedScore: null,
          appliedComment: null,
          coderResults: [{
            coderId: 1,
            coderName: 'Coder 1',
            jobId: 100,
            jobName: 'Job A',
            code: 1,
            score: 1,
            notes: null,
            supervisorComment: null,
            codedAt: '2026-05-18T00:00:00.000Z'
          }]
        }],
        total: 1,
        page: 2,
        limit: 25
      };

      service.getDoubleCodedVariablesForReview(
        mockWorkspaceId,
        2,
        25,
        true,
        false,
        'VAR_1',
        9,
        'done',
        'unresolved',
        'differ',
        [11, 12],
        [21]
      ).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(request => request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/double-coded-review`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('limit')).toBe('25');
      expect(req.request.params.get('onlyConflicts')).toBe('true');
      expect(req.request.params.get('excludeTrainings')).toBe('false');
      expect(req.request.params.get('search')).toBe('VAR_1');
      expect(req.request.params.get('coderId')).toBe('9');
      expect(req.request.params.get('statusFilter')).toBe('done');
      expect(req.request.params.get('resolvedFilter')).toBe('unresolved');
      expect(req.request.params.get('agreementFilter')).toBe('differ');
      expect(req.request.params.get('jobDefinitionIds')).toBe('11,12');
      expect(req.request.params.get('coderTrainingIds')).toBe('21');
      req.flush(mockResponse);
    });

    it('should propagate double-coded review errors to the component', done => {
      service.getDoubleCodedVariablesForReview(mockWorkspaceId).subscribe({
        next: () => done.fail('expected double-coded review request to fail'),
        error: error => {
          expect(error.status).toBe(500);
          done();
        }
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/double-coded-review?page=1&limit=50&onlyConflicts=false&excludeTrainings=false`);
      req.flush(
        { message: 'review query failed' },
        { status: 500, statusText: 'Server Error' }
      );
    });
  });

  describe('applyDoubleCodedResolutions', () => {
    it('should post explicit replay code decisions for double-coded review resolutions', () => {
      const mockResponse = {
        success: true,
        appliedCount: 1,
        failedCount: 0,
        skippedCount: 0,
        message: 'ok'
      };
      const body = {
        decisions: [{
          responseId: 10,
          code: 3,
          score: 2,
          resolutionComment: 'Replay checked'
        }]
      };

      service.applyDoubleCodedResolutions(mockWorkspaceId, body).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/double-coded-review/apply-resolutions`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(body);
      req.flush(mockResponse);
    });
  });

  describe('getCohensKappaStatistics', () => {
    it('should request detailed kappa statistics with filters and return variable mean kappa', () => {
      const mockResponse = {
        variables: [
          {
            unitName: 'UNIT',
            variableId: 'VAR',
            meanKappa: 0.667,
            meanAgreement: 0.8,
            caseCount: 12,
            doubleCodedCount: 10,
            doubleCodedRate: 0.833,
            validPairCount: 8,
            coderPairCount: 1,
            coderPairs: [
              {
                coder1Id: 1,
                coder1Name: 'Coder 1',
                coder2Id: 2,
                coder2Name: 'Coder 2',
                kappa: 0.667,
                agreement: 0.8,
                totalItems: 10,
                validPairs: 8,
                interpretation: 'kappa.substantial'
              }
            ]
          }
        ],
        workspaceSummary: {
          totalCodedResponses: 12,
          totalDoubleCodedResponses: 10,
          totalCoderPairs: 1,
          averageKappa: 0.667,
          meanAgreement: 0.8,
          variablesIncluded: 1,
          codersIncluded: 2,
          weightingMethod: 'weighted' as const
        }
      };

      service
        .getCohensKappaStatistics(mockWorkspaceId, true, false, 'UNIT', 'VAR', {
          jobDefinitionIds: [11, 12],
          coderTrainingIds: [21],
          coderIds: [31, 32]
        }, 'score')
        .subscribe(response => {
          expect(response).toEqual(mockResponse);
          expect(response.variables[0].meanKappa).toBe(0.667);
        });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/cohens-kappa` &&
        request.params.get('weightedMean') === 'true' &&
        request.params.get('excludeTrainings') === 'false' &&
        request.params.get('level') === 'score' &&
        request.params.get('unitName') === 'UNIT' &&
        request.params.get('variableId') === 'VAR' &&
        request.params.get('jobDefinitionIds') === '11,12' &&
        request.params.get('coderTrainingIds') === '21' &&
        request.params.get('coderIds') === '31,32'
      ));
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('exportCohensKappaStatisticsAsCsv', () => {
    it('should request kappa summary export as CSV with current options', () => {
      const mockBlob = new Blob(['subunit;nCases'], { type: 'text/csv' });

      service
        .exportCohensKappaSummaryAsCsv(mockWorkspaceId, false, false, 'UNIT', 'VAR', {
          jobDefinitionIds: [11],
          coderTrainingIds: [21],
          coderIds: [31]
        })
        .subscribe(response => {
          expect(response).toEqual(mockBlob);
        });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/cohens-kappa/export/summary/csv` &&
        request.params.get('weightedMean') === 'false' &&
        request.params.get('excludeTrainings') === 'false' &&
        request.params.get('level') === 'code' &&
        request.params.get('unitName') === 'UNIT' &&
        request.params.get('variableId') === 'VAR' &&
        request.params.get('jobDefinitionIds') === '11' &&
        request.params.get('coderTrainingIds') === '21' &&
        request.params.get('coderIds') === '31'
      ));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should request kappa statistics export as XLSX with current options', () => {
      const mockBlob = new Blob(['xlsx'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      service
        .exportCohensKappaStatisticsAsXlsx(mockWorkspaceId, true, true, undefined, undefined, {
          jobDefinitionIds: [11, 12],
          coderIds: [31]
        }, 'score')
        .subscribe(response => {
          expect(response).toEqual(mockBlob);
        });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/cohens-kappa/export/xlsx` &&
        request.params.get('weightedMean') === 'true' &&
        request.params.get('excludeTrainings') === 'true' &&
        request.params.get('level') === 'score' &&
        request.params.get('jobDefinitionIds') === '11,12' &&
        request.params.get('coderIds') === '31'
      ));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should request kappa detail export as CSV with current options', () => {
      const mockBlob = new Blob(['Variable;Kappa-Wert'], { type: 'text/csv' });

      service
        .exportCohensKappaStatisticsAsCsv(mockWorkspaceId, false, false, 'UNIT', 'VAR', {
          coderTrainingIds: [21, 22]
        })
        .subscribe(response => {
          expect(response).toEqual(mockBlob);
        });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/cohens-kappa/export/csv` &&
        request.params.get('weightedMean') === 'false' &&
        request.params.get('excludeTrainings') === 'false' &&
        request.params.get('level') === 'code' &&
        request.params.get('unitName') === 'UNIT' &&
        request.params.get('variableId') === 'VAR' &&
        request.params.get('coderTrainingIds') === '21,22'
      ));
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should propagate errors when kappa detail export fails', () => {
      let receivedError: unknown;

      service.exportCohensKappaStatisticsAsCsv(mockWorkspaceId).subscribe({
        next: () => {
          throw new Error('Expected kappa CSV export to fail');
        },
        error: error => {
          receivedError = error;
        }
      });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/cohens-kappa/export/csv` &&
        request.params.get('weightedMean') === 'true' &&
        request.params.get('excludeTrainings') === 'true' &&
        request.params.get('level') === 'code'
      ));
      req.error(new ProgressEvent('error'));

      expect(receivedError).toBeTruthy();
    });
  });

  describe('coding freshness', () => {
    it('should reuse cached coding freshness until coding status is invalidated', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
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
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness`;
      let cachedResponse: unknown;

      service.getCodingFreshness(mockWorkspaceId).subscribe();
      httpMock.expectOne(url).flush(mockResponse);

      service.getCodingFreshness(mockWorkspaceId).subscribe(response => {
        cachedResponse = response;
      });
      httpMock.expectNone(url);
      expect(cachedResponse).toEqual(mockResponse);

      service.invalidateCodingStatusCache(mockWorkspaceId);
      service.getCodingFreshness(mockWorkspaceId).subscribe();
      httpMock.expectOne(url).flush(mockResponse);
    });

    it('should keep newer in-flight coding freshness requests registered when stale requests finish', () => {
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness`;
      const staleResponse = {
        workspaceId: mockWorkspaceId,
        currentRevision: 1,
        items: []
      };
      const currentResponse = {
        workspaceId: mockWorkspaceId,
        currentRevision: 2,
        items: [
          {
            version: 'v1' as const,
            state: 'PENDING' as const,
            unitCount: 1,
            affectedResponseCount: 1
          }
        ]
      };
      let currentSubscriberResponse: unknown;
      let sharedSubscriberResponse: unknown;

      service.getCodingFreshness(mockWorkspaceId).subscribe();
      const staleRequest = httpMock.expectOne(url);

      service.invalidateCodingStatusCache(mockWorkspaceId);
      service.getCodingFreshness(mockWorkspaceId).subscribe(response => {
        currentSubscriberResponse = response;
      });
      const currentRequest = httpMock.expectOne(url);

      staleRequest.flush(staleResponse);

      service.getCodingFreshness(mockWorkspaceId).subscribe(response => {
        sharedSubscriberResponse = response;
      });
      httpMock.expectNone(url);

      currentRequest.flush(currentResponse);

      expect(currentSubscriberResponse).toEqual(currentResponse);
      expect(sharedSubscriberResponse).toEqual(currentResponse);
    });

    it('should not cache failed coding freshness fallbacks', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
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
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness`;
      let firstResponse: unknown;
      let secondResponse: unknown;

      service.getCodingFreshness(mockWorkspaceId).subscribe(response => {
        firstResponse = response;
      });
      httpMock.expectOne(url).error(new ProgressEvent('error'));
      expect(firstResponse).toEqual({
        workspaceId: mockWorkspaceId,
        currentRevision: 0,
        items: []
      });

      service.getCodingFreshness(mockWorkspaceId).subscribe(response => {
        secondResponse = response;
      });
      httpMock.expectOne(url).flush(mockResponse);
      expect(secondResponse).toEqual(mockResponse);
    });

    it('should return a fallback without requesting coding freshness while the status guard is active', () => {
      let response: unknown;
      const complete = jest.fn();
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness`;

      codingBackgroundJobsService.setJobRunning(
        mockWorkspaceId,
        'response-analysis',
        true,
        'analysis-1'
      );

      service.getCodingFreshness(mockWorkspaceId).subscribe({
        next: result => {
          response = result;
        },
        complete
      });

      httpMock.expectNone(url);
      expect(response).toEqual({
        workspaceId: mockWorkspaceId,
        currentRevision: 0,
        items: []
      });
      expect(complete).toHaveBeenCalled();

      codingBackgroundJobsService.setJobRunning(
        mockWorkspaceId,
        'response-analysis',
        false,
        'analysis-1'
      );
    });

    it('should request autocoding readiness with run and force-refresh params', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
        autoCoderRun: 1,
        readiness: 'BLOCKED',
        blockers: ['NO_CODEABLE_RESPONSES'],
        rawResponsesTotal: 10,
        rawResponsesWithRelevantStatus: 10,
        resultUnitsTotal: 2,
        resultUnitKeysTotal: 2,
        matchedUnitFiles: 2,
        missingUnitFiles: [],
        matchedCodingSchemes: 1,
        missingCodingSchemes: [],
        invalidCodingSchemes: [],
        validVariablePairs: 0,
        validResponses: 0,
        codeableResponses: 0,
        invalidVariableSamples: []
      };

      service.getAutocodingReadiness(mockWorkspaceId, 1, true)
        .subscribe(response => {
          expect(response).toEqual(mockResponse);
        });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1' &&
        request.params.get('forceRefresh') === 'true'
      ));
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should reuse cached autocoding readiness unless force-refresh is requested', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
        autoCoderRun: 1,
        readiness: 'READY',
        blockers: [],
        rawResponsesTotal: 10,
        rawResponsesWithRelevantStatus: 10,
        resultUnitsTotal: 2,
        resultUnitKeysTotal: 2,
        matchedUnitFiles: 2,
        missingUnitFiles: [],
        matchedCodingSchemes: 1,
        missingCodingSchemes: [],
        invalidCodingSchemes: [],
        validVariablePairs: 1,
        validResponses: 10,
        codeableResponses: 10,
        invalidVariableSamples: []
      };
      let cachedResponse: unknown;

      service.getAutocodingReadiness(mockWorkspaceId, 1).subscribe();
      httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1' &&
        !request.params.has('forceRefresh')
      )).flush(mockResponse);

      service.getAutocodingReadiness(mockWorkspaceId, 1).subscribe(response => {
        cachedResponse = response;
      });
      httpMock.expectNone(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1' &&
        !request.params.has('forceRefresh')
      ));
      expect(cachedResponse).toEqual(mockResponse);

      service.getAutocodingReadiness(mockWorkspaceId, 1, true).subscribe();
      httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1' &&
        request.params.get('forceRefresh') === 'true'
      )).flush(mockResponse);
    });

    it('should keep force-refreshed autocoding readiness cached when stale requests finish later', () => {
      const staleResponse = {
        workspaceId: mockWorkspaceId,
        autoCoderRun: 1,
        readiness: 'BLOCKED',
        blockers: ['NO_CODEABLE_RESPONSES'],
        rawResponsesTotal: 10,
        rawResponsesWithRelevantStatus: 10,
        resultUnitsTotal: 2,
        resultUnitKeysTotal: 2,
        matchedUnitFiles: 2,
        missingUnitFiles: [],
        matchedCodingSchemes: 1,
        missingCodingSchemes: [],
        invalidCodingSchemes: [],
        validVariablePairs: 0,
        validResponses: 0,
        codeableResponses: 0,
        invalidVariableSamples: []
      };
      const forceResponse = {
        workspaceId: mockWorkspaceId,
        autoCoderRun: 1,
        readiness: 'READY',
        blockers: [],
        rawResponsesTotal: 10,
        rawResponsesWithRelevantStatus: 10,
        resultUnitsTotal: 2,
        resultUnitKeysTotal: 2,
        matchedUnitFiles: 2,
        missingUnitFiles: [],
        matchedCodingSchemes: 1,
        missingCodingSchemes: [],
        invalidCodingSchemes: [],
        validVariablePairs: 1,
        validResponses: 10,
        codeableResponses: 10,
        invalidVariableSamples: []
      };
      let staleSubscriberResponse: unknown;
      let forceSubscriberResponse: unknown;
      let cachedResponse: unknown;

      service.getAutocodingReadiness(mockWorkspaceId, 1).subscribe(response => {
        staleSubscriberResponse = response;
      });
      const staleRequest = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1' &&
        !request.params.has('forceRefresh')
      ));

      service.getAutocodingReadiness(mockWorkspaceId, 1, true).subscribe(response => {
        forceSubscriberResponse = response;
      });
      const forceRequest = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1' &&
        request.params.get('forceRefresh') === 'true'
      ));

      forceRequest.flush(forceResponse);
      staleRequest.flush(staleResponse);

      service.getAutocodingReadiness(mockWorkspaceId, 1).subscribe(response => {
        cachedResponse = response;
      });
      httpMock.expectNone(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/readiness` &&
        request.params.get('autoCoderRun') === '1'
      ));

      expect(staleSubscriberResponse).toEqual(staleResponse);
      expect(forceSubscriberResponse).toEqual(forceResponse);
      expect(cachedResponse).toEqual(forceResponse);
    });

    it('should request the freshness scope with version and states', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
        currentRevision: 1,
        versions: ['v1'],
        states: ['PENDING', 'STALE'],
        unitCount: 2,
        personCount: 1,
        groupCount: 1,
        affectedResponseCount: 4,
        unitIds: [10, 11],
        personIds: [100],
        groupNames: ['Group1'],
        groups: []
      };

      service.getCodingFreshnessScope(mockWorkspaceId, 'v1', ['PENDING', 'STALE'])
        .subscribe(response => {
          expect(response).toEqual(mockResponse);
        });

      const req = httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/scope` &&
        request.params.get('version') === 'v1' &&
        request.params.get('state') === 'PENDING,STALE'
      ));
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should reuse cached freshness scope until coding status is invalidated', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
        currentRevision: 1,
        versions: ['v1'],
        states: ['PENDING', 'STALE'],
        unitCount: 2,
        personCount: 1,
        groupCount: 1,
        affectedResponseCount: 4,
        unitIds: [10, 11],
        personIds: [100],
        groupNames: ['Group1'],
        groups: []
      };
      let cachedResponse: unknown;

      service.getCodingFreshnessScope(mockWorkspaceId, 'v1', ['PENDING', 'STALE'])
        .subscribe();
      httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/scope` &&
        request.params.get('version') === 'v1' &&
        request.params.get('state') === 'PENDING,STALE'
      )).flush(mockResponse);

      service.getCodingFreshnessScope(mockWorkspaceId, 'v1', ['PENDING', 'STALE'])
        .subscribe(response => {
          cachedResponse = response;
        });
      httpMock.expectNone(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/scope` &&
        request.params.get('version') === 'v1' &&
        request.params.get('state') === 'PENDING,STALE'
      ));
      expect(cachedResponse).toEqual(mockResponse);

      service.invalidateCodingStatusCache(mockWorkspaceId);
      service.getCodingFreshnessScope(mockWorkspaceId, 'v1', ['PENDING', 'STALE'])
        .subscribe();
      httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/scope` &&
        request.params.get('version') === 'v1' &&
        request.params.get('state') === 'PENDING,STALE'
      )).flush(mockResponse);
    });

    it('should not cache failed freshness scope fallbacks', () => {
      const mockResponse = {
        workspaceId: mockWorkspaceId,
        currentRevision: 1,
        versions: ['v1'],
        states: ['PENDING', 'STALE'],
        unitCount: 2,
        personCount: 1,
        groupCount: 1,
        affectedResponseCount: 4,
        unitIds: [10, 11],
        personIds: [100],
        groupNames: ['Group1'],
        groups: []
      };
      let firstResponse: unknown;
      let secondResponse: unknown;

      service.getCodingFreshnessScope(mockWorkspaceId, 'v1', ['PENDING', 'STALE'])
        .subscribe(response => {
          firstResponse = response;
        });
      httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/scope` &&
        request.params.get('version') === 'v1' &&
        request.params.get('state') === 'PENDING,STALE'
      )).error(new ProgressEvent('error'));
      expect(firstResponse).toEqual({
        workspaceId: mockWorkspaceId,
        currentRevision: 0,
        versions: ['v1'],
        states: ['PENDING', 'STALE'],
        unitCount: 0,
        personCount: 0,
        groupCount: 0,
        affectedResponseCount: 0,
        unitIds: [],
        personIds: [],
        groupNames: [],
        groups: []
      });

      service.getCodingFreshnessScope(mockWorkspaceId, 'v1', ['PENDING', 'STALE'])
        .subscribe(response => {
          secondResponse = response;
        });
      httpMock.expectOne(request => (
        request.url === `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/scope` &&
        request.params.get('version') === 'v1' &&
        request.params.get('state') === 'PENDING,STALE'
      )).flush(mockResponse);
      expect(secondResponse).toEqual(mockResponse);
    });

    it('should start a coding freshness job', () => {
      const mockResponse = {
        totalResponses: 0,
        statusCounts: {},
        jobId: 'job-123',
        message: 'started',
        unitCount: 2,
        personCount: 1,
        groupNames: ['Group1']
      };

      service.startFreshnessCoding(mockWorkspaceId, {
        version: 'v1',
        states: ['PENDING', 'STALE']
      }).subscribe(response => {
        expect(response).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/freshness/code`
      );
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        version: 'v1',
        states: ['PENDING', 'STALE']
      });
      req.flush(mockResponse);
    });

    it('should keep the freshness-coding guard until the job reaches a terminal status', () => {
      jest.useFakeTimers();
      const setJobRunningSpy = jest.spyOn(codingBackgroundJobsService, 'setJobRunning');
      const invalidateCacheSpy = jest.spyOn(service, 'invalidateCodingStatusCache');
      const jobId = 'freshness-job-1';
      const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/job/${jobId}`;

      try {
        service.trackFreshnessCodingGuardUntilComplete(mockWorkspaceId, jobId);

        expect(setJobRunningSpy).toHaveBeenCalledWith(
          mockWorkspaceId,
          'freshness-coding',
          true,
          jobId
        );

        jest.advanceTimersByTime(5000);
        httpMock.expectOne(url).flush(
          { message: 'temporary error' },
          { status: 500, statusText: 'Server Error' }
        );
        expect(setJobRunningSpy).not.toHaveBeenCalledWith(
          mockWorkspaceId,
          'freshness-coding',
          false,
          jobId
        );

        jest.advanceTimersByTime(5000);
        httpMock.expectOne(url).flush({
          status: 'processing',
          progress: 50
        });

        jest.advanceTimersByTime(5000);
        httpMock.expectOne(url).flush({
          status: 'completed',
          progress: 100
        });

        expect(invalidateCacheSpy).toHaveBeenCalledWith(mockWorkspaceId);
        expect(setJobRunningSpy).toHaveBeenLastCalledWith(
          mockWorkspaceId,
          'freshness-coding',
          false,
          jobId
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('exportCodingListAsCsv', () => {
    it('should send a GET request to export coding list as CSV', () => {
      const mockBlob = new Blob(['test,data'], { type: 'text/csv' });

      service.exportCodingListAsCsv(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockBlob);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/csv`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should handle errors and return empty blob', () => {
      service.exportCodingListAsCsv(mockWorkspaceId).subscribe(response => {
        expect(response).toBeInstanceOf(Blob);
        expect(response.type).toBe('text/csv');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/csv`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('exportCodingListAsExcel', () => {
    it('should send a GET request to export coding list as Excel', () => {
      const mockBlob = new Blob(['test data'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      service.exportCodingListAsExcel(mockWorkspaceId).subscribe(response => {
        expect(response).toEqual(mockBlob);
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/excel`);
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(mockBlob);
    });

    it('should handle errors and return empty blob', () => {
      service.exportCodingListAsExcel(mockWorkspaceId).subscribe(response => {
        expect(response).toBeInstanceOf(Blob);
        expect(response.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      });

      const req = httpMock.expectOne(`${mockServerUrl}admin/workspace/${mockWorkspaceId}/coding/coding-list/excel`);
      req.error(new ProgressEvent('error'));
    });
  });
});
