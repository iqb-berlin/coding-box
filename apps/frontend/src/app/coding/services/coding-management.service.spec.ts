import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { CodingManagementService } from './coding-management.service';
import { BackendService, CodingJobStatus } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';

describe('CodingManagementService', () => {
  let service: CodingManagementService;
  let backendServiceMock: jest.Mocked<BackendService>;
  let appServiceMock: jest.Mocked<AppService>;
  let translateServiceMock: jest.Mocked<TranslateService>;
  let snackBarMock: jest.Mocked<MatSnackBar>;

  const mockCodingStatistics: CodingStatistics = {
    totalResponses: 100,
    statusCounts: {
      coded: 50,
      pending: 50
    }
  };

  beforeEach(() => {
    // Create mocks
    backendServiceMock = {
      createCodingStatisticsJob: jest.fn(),
      getCodingStatistics: jest.fn(),
      getCodingJobStatus: jest.fn(),
      getResponsesByStatus: jest.fn(),
      searchResponses: jest.fn(),
      resetCodingVersion: jest.fn(),
      getCodingListAsCsv: jest.fn(),
      getCodingListAsExcel: jest.fn(),
      getCodingResultsByVersion: jest.fn(),
      getCodingResultsByVersionAsExcel: jest.fn()
    } as unknown as jest.Mocked<BackendService>;

    appServiceMock = {
      selectedWorkspaceId: 1
    } as unknown as jest.Mocked<AppService>;

    translateServiceMock = {
      instant: jest.fn().mockImplementation(key => key)
    } as unknown as jest.Mocked<TranslateService>;

    snackBarMock = {
      open: jest.fn().mockReturnValue({ dismiss: jest.fn() })
    } as unknown as jest.Mocked<MatSnackBar>;

    TestBed.configureTestingModule({
      providers: [
        CodingManagementService,
        { provide: BackendService, useValue: backendServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: TranslateService, useValue: translateServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });

    service = TestBed.inject(CodingManagementService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('fetchCodingStatistics', () => {
    it('should create a job and poll for results when workspaceId is present', fakeAsync(() => {
      // Arrange
      const jobId = 'job-123';
      backendServiceMock.createCodingStatisticsJob.mockReturnValue(of({ jobId, message: 'test' }));

      // First poll: processing
      backendServiceMock.getCodingJobStatus.mockReturnValueOnce(of({
        status: 'processing',
        progress: 50,
        result: undefined
      } as CodingJobStatus));

      // Second poll: completed
      backendServiceMock.getCodingJobStatus.mockReturnValueOnce(of({
        status: 'completed',
        progress: 100,
        result: mockCodingStatistics
      } as CodingJobStatus));

      // Mock reference stats calls (v1 is default fallback)
      backendServiceMock.getCodingStatistics.mockReturnValue(of({ totalResponses: 0, statusCounts: {} }));

      // Act
      service.fetchCodingStatistics('v1');

      // Assert
      expect(backendServiceMock.createCodingStatisticsJob).toHaveBeenCalledWith(1);

      // Advance time for polling (timer(0, 2000))
      tick(0); // initial
      expect(backendServiceMock.getCodingJobStatus).toHaveBeenCalledTimes(1);

      tick(2000); // next poll
      expect(backendServiceMock.getCodingJobStatus).toHaveBeenCalledTimes(2);

      // Check if statistics were emitted
      let currentStats: CodingStatistics | undefined;
      service.codingStatistics$.subscribe(stats => {
        currentStats = stats;
      });
      expect(currentStats).toEqual(mockCodingStatistics);
    }));

    it('should handle missing workspaceId', () => {
      Object.defineProperty(appServiceMock, 'selectedWorkspaceId', { get: () => null });
      service.fetchCodingStatistics('v1');
      expect(backendServiceMock.createCodingStatisticsJob).not.toHaveBeenCalled();
    });

    it('should handle failure to create job', () => {
      backendServiceMock.createCodingStatisticsJob.mockReturnValue(throwError(() => new Error('Failed')));
      // Expect it to call handleNoJobIdStatistics -> getCodingStatistics
      backendServiceMock.getCodingStatistics.mockReturnValue(of(mockCodingStatistics));

      service.fetchCodingStatistics('v1');

      expect(backendServiceMock.getCodingStatistics).toHaveBeenCalledWith(1, 'v1');
    });
  });

  describe('downloadCodingList', () => {
    it('should download CSV', () => {
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      backendServiceMock.getCodingListAsCsv.mockReturnValue(of(mockBlob));

      // Spy on saveBlob (private method, but effectively testing side effect via window)
      // Since saveBlob creates a URL and clicks an anchor, it's hard to test in non-browser env without mocking DOM.
      // But we can verify backend call.

      // Mock window.URL.createObjectURL
      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('csv');

      expect(backendServiceMock.getCodingListAsCsv).toHaveBeenCalledWith(1);
    });

    it('should download Excel', () => {
      const mockBlob = new Blob(['excel data'], { type: 'application/xlsx' });
      backendServiceMock.getCodingListAsExcel.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('excel');

      expect(backendServiceMock.getCodingListAsExcel).toHaveBeenCalledWith(1);
    });
  });
});
