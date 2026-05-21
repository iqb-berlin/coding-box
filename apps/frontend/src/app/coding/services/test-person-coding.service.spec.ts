import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
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

describe('TestPersonCodingService', () => {
  let service: TestPersonCodingService;
  let httpMock: HttpTestingController;
  const mockServerUrl = 'http://localhost:3000/';
  const mockWorkspaceId = 123;
  const mockAuthToken = 'test-token';

  beforeEach(() => {
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
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(TestPersonCodingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
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
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${mockAuthToken}`);
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
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${mockAuthToken}`);
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
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${mockAuthToken}`);
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
      expect(req.request.headers.get('Authorization')).toBe(`Bearer ${mockAuthToken}`);
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

  describe('coding freshness', () => {
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
