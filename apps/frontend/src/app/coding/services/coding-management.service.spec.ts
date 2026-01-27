import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { CodingManagementService } from './coding-management.service';
import {
  CodingJobStatus
} from '../../models/coding-interfaces';
import { CodingExecutionService } from './coding-execution.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingExportService } from './coding-export.service';
import { CodingVersionService } from './coding-version.service';
import { ResponseService } from '../../shared/services/response/response.service';
import { AppService } from '../../core/services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';

describe('CodingManagementService', () => {
  let service: CodingManagementService;
  let executionServiceMock: jest.Mocked<CodingExecutionService>;
  let statisticsServiceMock: jest.Mocked<CodingStatisticsService>;
  let exportServiceMock: jest.Mocked<CodingExportService>;
  let versionServiceMock: jest.Mocked<CodingVersionService>;
  let responseServiceMock: jest.Mocked<ResponseService>;
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
    executionServiceMock = {
      createCodingStatisticsJob: jest.fn(),
      getCodingJobStatus: jest.fn()
    } as unknown as jest.Mocked<CodingExecutionService>;

    statisticsServiceMock = {
      getCodingStatistics: jest.fn(),
      getResponsesByStatus: jest.fn()
    } as unknown as jest.Mocked<CodingStatisticsService>;

    exportServiceMock = {
      getCodingListAsCsv: jest.fn(),
      getCodingListAsExcel: jest.fn(),
      getCodingResultsByVersion: jest.fn(),
      getCodingResultsByVersionAsExcel: jest.fn()
    } as unknown as jest.Mocked<CodingExportService>;

    versionServiceMock = {
      resetCodingVersion: jest.fn()
    } as unknown as jest.Mocked<CodingVersionService>;

    responseServiceMock = {
      searchResponses: jest.fn()
    } as unknown as jest.Mocked<ResponseService>;

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
        { provide: CodingExecutionService, useValue: executionServiceMock },
        { provide: CodingStatisticsService, useValue: statisticsServiceMock },
        { provide: CodingExportService, useValue: exportServiceMock },
        { provide: CodingVersionService, useValue: versionServiceMock },
        { provide: ResponseService, useValue: responseServiceMock },
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
      executionServiceMock.createCodingStatisticsJob.mockReturnValue(of({ jobId, message: 'test' }));

      // First poll: processing
      executionServiceMock.getCodingJobStatus.mockReturnValueOnce(of({
        status: 'processing',
        progress: 50,
        result: undefined
      } as CodingJobStatus));

      // Second poll: completed
      executionServiceMock.getCodingJobStatus.mockReturnValueOnce(of({
        status: 'completed',
        progress: 100,
        result: mockCodingStatistics
      } as CodingJobStatus));

      // Mock reference stats calls (v1 is default fallback)
      statisticsServiceMock.getCodingStatistics.mockReturnValue(of({ totalResponses: 0, statusCounts: {} }));

      // Act
      service.fetchCodingStatistics('v1');

      // Assert
      expect(executionServiceMock.createCodingStatisticsJob).toHaveBeenCalledWith(1, 'v1');

      // Advance time for polling (timer(0, 2000))
      tick(0); // initial
      expect(executionServiceMock.getCodingJobStatus).toHaveBeenCalledTimes(1);

      tick(2000); // next poll
      expect(executionServiceMock.getCodingJobStatus).toHaveBeenCalledTimes(2);

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
      expect(executionServiceMock.createCodingStatisticsJob).not.toHaveBeenCalled();
    });

    it('should handle failure to create job', () => {
      executionServiceMock.createCodingStatisticsJob.mockReturnValue(throwError(() => new Error('Failed')));
      // Expect it to call handleNoJobIdStatistics -> getCodingStatistics
      statisticsServiceMock.getCodingStatistics.mockReturnValue(of(mockCodingStatistics));

      service.fetchCodingStatistics('v1');

      expect(statisticsServiceMock.getCodingStatistics).toHaveBeenCalledWith(1, 'v1');
    });
  });

  describe('downloadCodingList', () => {
    it('should download CSV', () => {
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      exportServiceMock.getCodingListAsCsv.mockReturnValue(of(mockBlob));

      // Spy on saveBlob (private method, but effectively testing side effect via window)
      // Since saveBlob creates a URL and clicks an anchor, it's hard to test in non-browser env without mocking DOM.
      // But we can verify backend call.

      // Mock window.URL.createObjectURL
      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('csv');

      expect(exportServiceMock.getCodingListAsCsv).toHaveBeenCalledWith(1);
    });

    it('should download Excel', () => {
      const mockBlob = new Blob(['excel data'], { type: 'application/xlsx' });
      exportServiceMock.getCodingListAsExcel.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('excel');

      expect(exportServiceMock.getCodingListAsExcel).toHaveBeenCalledWith(1);
    });
  });
});
