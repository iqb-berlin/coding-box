import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { CodingManagementService } from './coding-management.service';
import {
  CodingJobStatus
} from '../../models/coding-interfaces';
import { CodingService } from './coding.service';
import { ResponseService } from '../../shared/services/response/response.service';
import { AppService } from '../../core/services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';

describe('CodingManagementService', () => {
  let service: CodingManagementService;
  let codingServiceMock: jest.Mocked<CodingService>;
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
    codingServiceMock = {
      createCodingStatisticsJob: jest.fn(),
      getCodingStatistics: jest.fn(),
      getCodingJobStatus: jest.fn(),
      getResponsesByStatus: jest.fn(),
      resetCodingVersion: jest.fn(),
      getCodingListAsCsv: jest.fn(),
      getCodingListAsExcel: jest.fn(),
      getCodingResultsByVersion: jest.fn(),
      getCodingResultsByVersionAsExcel: jest.fn()
    } as unknown as jest.Mocked<CodingService>;

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
        { provide: CodingService, useValue: codingServiceMock },
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
      codingServiceMock.createCodingStatisticsJob.mockReturnValue(of({ jobId, message: 'test' }));

      // First poll: processing
      codingServiceMock.getCodingJobStatus.mockReturnValueOnce(of({
        status: 'processing',
        progress: 50,
        result: undefined
      } as CodingJobStatus));

      // Second poll: completed
      codingServiceMock.getCodingJobStatus.mockReturnValueOnce(of({
        status: 'completed',
        progress: 100,
        result: mockCodingStatistics
      } as CodingJobStatus));

      // Mock reference stats calls (v1 is default fallback)
      codingServiceMock.getCodingStatistics.mockReturnValue(of({ totalResponses: 0, statusCounts: {} }));

      // Act
      service.fetchCodingStatistics('v1');

      // Assert
      expect(codingServiceMock.createCodingStatisticsJob).toHaveBeenCalledWith(1);

      // Advance time for polling (timer(0, 2000))
      tick(0); // initial
      expect(codingServiceMock.getCodingJobStatus).toHaveBeenCalledTimes(1);

      tick(2000); // next poll
      expect(codingServiceMock.getCodingJobStatus).toHaveBeenCalledTimes(2);

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
      expect(codingServiceMock.createCodingStatisticsJob).not.toHaveBeenCalled();
    });

    it('should handle failure to create job', () => {
      codingServiceMock.createCodingStatisticsJob.mockReturnValue(throwError(() => new Error('Failed')));
      // Expect it to call handleNoJobIdStatistics -> getCodingStatistics
      codingServiceMock.getCodingStatistics.mockReturnValue(of(mockCodingStatistics));

      service.fetchCodingStatistics('v1');

      expect(codingServiceMock.getCodingStatistics).toHaveBeenCalledWith(1, 'v1');
    });
  });

  describe('downloadCodingList', () => {
    it('should download CSV', () => {
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      codingServiceMock.getCodingListAsCsv.mockReturnValue(of(mockBlob));

      // Spy on saveBlob (private method, but effectively testing side effect via window)
      // Since saveBlob creates a URL and clicks an anchor, it's hard to test in non-browser env without mocking DOM.
      // But we can verify backend call.

      // Mock window.URL.createObjectURL
      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('csv');

      expect(codingServiceMock.getCodingListAsCsv).toHaveBeenCalledWith(1);
    });

    it('should download Excel', () => {
      const mockBlob = new Blob(['excel data'], { type: 'application/xlsx' });
      codingServiceMock.getCodingListAsExcel.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('excel');

      expect(codingServiceMock.getCodingListAsExcel).toHaveBeenCalledWith(1);
    });
  });
});
