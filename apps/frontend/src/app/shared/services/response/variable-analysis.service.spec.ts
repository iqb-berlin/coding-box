import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import {
  provideHttpClient,
  withInterceptorsFromDi
} from '@angular/common/http';
import { VariableAnalysisService } from './variable-analysis.service';
import { SERVER_URL } from '../../../injection-tokens';
import { CodingBackgroundJobsService } from '../../../coding/services/coding-background-jobs.service';
import { TestPersonCodingService } from '../../../coding/services/test-person-coding.service';

describe('VariableAnalysisService', () => {
  let service: VariableAnalysisService;
  let httpMock: HttpTestingController;
  let codingBackgroundJobsService: CodingBackgroundJobsService;
  let testPersonCodingService: TestPersonCodingService;

  const mockServerUrl = 'http://localhost/api/';
  const mockWorkspaceId = 1;

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: jest.fn().mockReturnValue('mock-token')
      },
      writable: true
    });

    TestBed.configureTestingModule({
      providers: [
        VariableAnalysisService,
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: SERVER_URL, useValue: mockServerUrl }
      ]
    });

    service = TestBed.inject(VariableAnalysisService);
    httpMock = TestBed.inject(HttpTestingController);
    codingBackgroundJobsService = TestBed.inject(CodingBackgroundJobsService);
    testPersonCodingService = TestBed.inject(TestPersonCodingService);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should keep the response-analysis guard until active variable analysis jobs finish', () => {
    jest.useFakeTimers();
    const setJobRunningSpy = jest.spyOn(codingBackgroundJobsService, 'setJobRunning');
    const invalidateCacheSpy = jest.spyOn(testPersonCodingService, 'invalidateCodingStatusCache');
    const url = `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs`;

    try {
      service.trackVariableAnalysisGuardUntilComplete(mockWorkspaceId);

      expect(setJobRunningSpy).toHaveBeenCalledWith(
        mockWorkspaceId,
        'response-analysis',
        true,
        'variable-analysis-dialog'
      );

      jest.advanceTimersByTime(5000);
      httpMock.expectOne(url).flush(
        { message: 'temporary error' },
        { status: 500, statusText: 'Server Error' }
      );
      expect(setJobRunningSpy).not.toHaveBeenCalledWith(
        mockWorkspaceId,
        'response-analysis',
        false,
        'variable-analysis-dialog'
      );

      jest.advanceTimersByTime(5000);
      httpMock.expectOne(url).flush([
        {
          id: 1,
          workspace_id: mockWorkspaceId,
          type: 'variable-analysis',
          status: 'processing',
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);

      jest.advanceTimersByTime(5000);
      httpMock.expectOne(url).flush([
        {
          id: 1,
          workspace_id: mockWorkspaceId,
          type: 'variable-analysis',
          status: 'completed',
          created_at: new Date(),
          updated_at: new Date()
        }
      ]);

      expect(invalidateCacheSpy).toHaveBeenCalledWith(mockWorkspaceId);
      expect(setJobRunningSpy).toHaveBeenLastCalledWith(
        mockWorkspaceId,
        'response-analysis',
        false,
        'variable-analysis-dialog'
      );
    } finally {
      jest.useRealTimers();
    }
  });

  describe('createAnalysisJob', () => {
    it('should create job with optional params', () => {
      service.createAnalysisJob(mockWorkspaceId, 10, 'var1').subscribe();

      const req = httpMock.expectOne(
        r => r.url ===
            `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs` &&
          r.params.get('unitId') === '10' &&
          r.params.get('variableId') === 'var1'
      );
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('cancelJob', () => {
    it('should cancel job', () => {
      service.cancelJob(mockWorkspaceId, 5).subscribe();

      const req = httpMock.expectOne(
        `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs/5/cancel`
      );
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('getAnalysisResultsPage', () => {
    it('should load paginated results with query params', () => {
      service
        .getAnalysisResultsPage(mockWorkspaceId, 5, {
          page: 2,
          pageSize: 100,
          search: 'VAR',
          onlyEmpty: true,
          includeSchemaCodes: true,
          sortBy: 'count',
          sortDirection: 'desc'
        })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url ===
            `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs/5/results/page` &&
          r.params.get('page') === '2' &&
          r.params.get('pageSize') === '100' &&
          r.params.get('search') === 'VAR' &&
          r.params.get('onlyEmpty') === 'true' &&
          r.params.get('includeSchemaCodes') === 'true' &&
          r.params.get('sortBy') === 'count' &&
          r.params.get('sortDirection') === 'desc'
      );
      expect(req.request.method).toBe('GET');
      req.flush({});
    });
  });

  describe('exports', () => {
    it('should export results as CSV with filters', () => {
      service
        .exportAnalysisResultsAsCsv(mockWorkspaceId, 5, {
          search: 'VAR',
          onlyEmpty: true,
          includeSchemaCodes: true
        })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url ===
            `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs/5/results/export/csv` &&
          r.params.get('search') === 'VAR' &&
          r.params.get('onlyEmpty') === 'true' &&
          r.params.get('includeSchemaCodes') === 'true'
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['csv'], { type: 'text/csv' }));
    });

    it('should export results as XLSX with filters', () => {
      service
        .exportAnalysisResultsAsXlsx(mockWorkspaceId, 5, {
          search: 'VAR'
        })
        .subscribe();

      const req = httpMock.expectOne(
        r => r.url ===
            `${mockServerUrl}admin/workspace/${mockWorkspaceId}/variable-analysis/jobs/5/results/export/xlsx` &&
          r.params.get('search') === 'VAR' &&
          !r.params.has('onlyEmpty')
      );
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['xlsx'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }));
    });
  });
});
