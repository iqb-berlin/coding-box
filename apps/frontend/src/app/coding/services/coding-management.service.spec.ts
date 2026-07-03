import {
  TestBed, fakeAsync, tick
} from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  Observable, Subject, of, throwError
} from 'rxjs';
import { CodingManagementService } from './coding-management.service';
import {
  CodingJobStatus
} from '../../models/coding-interfaces';
import { CodingExecutionService } from './coding-execution.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingExportService } from './coding-export.service';
import {
  CodingVersionService,
  RESET_VERSION_JOB_STATUS_POLL_ERROR
} from './coding-version.service';
import { ResponseService } from '../../shared/services/response/response.service';
import { AppService } from '../../core/services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';
import { CodingBackgroundJobsService } from './coding-background-jobs.service';

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
  let codingBackgroundJobsService: CodingBackgroundJobsService;

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
      getCodingJobStatus: jest.fn(),
      getCodingStatisticsJobStatus: jest.fn()
    } as unknown as jest.Mocked<CodingExecutionService>;

    statisticsServiceMock = {
      getCodingStatistics: jest.fn(),
      getResponsesByStatus: jest.fn()
    } as unknown as jest.Mocked<CodingStatisticsService>;

    exportServiceMock = {
      getCodingListAsCsv: jest.fn(),
      getCodingListAsExcel: jest.fn(),
      getCodingResultsByVersion: jest.fn(),
      getCodingResultsByVersionAsExcel: jest.fn(),
      startExportJob: jest.fn(),
      getExportJobStatus: jest.fn(),
      downloadExportFile: jest.fn(),
      cancelExportJob: jest.fn()
    } as unknown as jest.Mocked<CodingExportService>;

    versionServiceMock = {
      resetCodingVersion: jest.fn(),
      getActiveResetVersionJob: jest.fn(),
      getResetVersionJobStatus: jest.fn()
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
    codingBackgroundJobsService = TestBed.inject(CodingBackgroundJobsService);
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
      executionServiceMock.getCodingStatisticsJobStatus.mockReturnValueOnce(of({
        status: 'processing',
        progress: 50,
        result: undefined
      } as CodingJobStatus));

      // Second poll: completed
      executionServiceMock.getCodingStatisticsJobStatus.mockReturnValueOnce(of({
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
      expect(executionServiceMock.getCodingStatisticsJobStatus).toHaveBeenCalledTimes(1);
      expect(executionServiceMock.getCodingJobStatus).not.toHaveBeenCalled();

      tick(2000); // next poll
      expect(executionServiceMock.getCodingStatisticsJobStatus).toHaveBeenCalledTimes(2);

      // Check if statistics were emitted
      let currentStats: CodingStatistics | null | undefined;
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

  describe('resetCodingVersion', () => {
    it('should keep the reset guard active after a transient polling error', fakeAsync(() => {
      const setJobRunningSpy = jest.spyOn(codingBackgroundJobsService, 'setJobRunning');
      versionServiceMock.resetCodingVersion.mockReturnValue(of({
        jobId: 'reset-job-1',
        message: 'started'
      }));
      versionServiceMock.getResetVersionJobStatus
        .mockReturnValueOnce(of({
          status: 'failed',
          progress: 0,
          error: RESET_VERSION_JOB_STATUS_POLL_ERROR
        }))
        .mockReturnValueOnce(of({
          status: 'completed',
          progress: 100,
          result: {
            affectedResponseCount: 3,
            cascadeResetVersions: [],
            message: 'completed'
          }
        }));

      service.resetCodingVersion('v1');

      expect(setJobRunningSpy).toHaveBeenCalledWith(
        1,
        'autocoder-reset',
        true,
        'reset-job-1'
      );
      expect(codingBackgroundJobsService.isStatusCheckGuardActive(1)).toBe(true);

      tick(0);

      expect(setJobRunningSpy).not.toHaveBeenCalledWith(
        1,
        'autocoder-reset',
        false,
        'reset-job-1'
      );
      expect(codingBackgroundJobsService.isStatusCheckGuardActive(1)).toBe(true);

      tick(2000);

      expect(setJobRunningSpy).toHaveBeenLastCalledWith(
        1,
        'autocoder-reset',
        false,
        'reset-job-1'
      );
      expect(codingBackgroundJobsService.isStatusCheckGuardActive(1)).toBe(false);
    }));
  });

  describe('searchResponses', () => {
    it('should forward response value, coding code and score filters', () => {
      responseServiceMock.searchResponses.mockReturnValue(of({ data: [], total: 0 }) as never);

      service.searchResponses({
        value: 'antwort',
        unitName: '',
        codedStatus: '',
        version: 'v2',
        code: '',
        codingCode: '7',
        score: '1',
        group: '',
        bookletName: '',
        variableId: '',
        geogebra: false,
        responseSource: 'all',
        personLogin: ''
      }, 1, 100).subscribe();

      expect(responseServiceMock.searchResponses).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          value: 'antwort',
          codingCode: '7',
          score: '1',
          version: 'v2'
        }),
        1,
        100
      );
    });
  });

  describe('downloadCodingList', () => {
    it('should download CSV', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }) as never);
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      exportServiceMock.downloadExportFile.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('csv');
      await new Promise(r => { setTimeout(r, 50); });

      expect(exportServiceMock.startExportJob).toHaveBeenCalledWith(1, 'coding-list', undefined, 'csv', false, undefined);
      expect(exportServiceMock.getExportJobStatus).toHaveBeenCalledWith(1, 'job-1');
      expect(exportServiceMock.downloadExportFile).toHaveBeenCalledWith(1, 'job-1');
    });

    it('should download Excel', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }) as never);
      const mockBlob = new Blob(['excel data'], { type: 'application/xlsx' });
      exportServiceMock.downloadExportFile.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      service.downloadCodingList('excel');
      await new Promise(r => { setTimeout(r, 50); });

      expect(exportServiceMock.startExportJob).toHaveBeenCalledWith(1, 'coding-list', undefined, 'excel', false, undefined);
      expect(exportServiceMock.getExportJobStatus).toHaveBeenCalledWith(1, 'job-1');
      expect(exportServiceMock.downloadExportFile).toHaveBeenCalledWith(1, 'job-1');
    });
  });

  describe('downloadCodingResults', () => {
    it('should pass response value option to background export job', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }) as never);
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      exportServiceMock.downloadExportFile.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      await service.downloadCodingResults('v1', 'csv', true, false);

      expect(exportServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        'results-by-version',
        'v1',
        'csv',
        true,
        undefined,
        false,
        false,
        false
      );
    });

    it('should pass GeoGebra package option to background export job', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }) as never);
      const mockBlob = new Blob(['zip data'], { type: 'application/zip' });
      exportServiceMock.downloadExportFile.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      await service.downloadCodingResults('v2', 'excel', false, true, true);

      expect(exportServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        'results-by-version',
        'v2',
        'excel',
        false,
        undefined,
        true,
        true,
        false
      );
    });

    it('should pass raw GeoGebra response value option to background export job', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }) as never);
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });
      exportServiceMock.downloadExportFile.mockReturnValue(of(mockBlob));

      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      await service.downloadCodingResults('v2', 'csv', false, true, false, true);

      expect(exportServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        'results-by-version',
        'v2',
        'csv',
        false,
        undefined,
        true,
        false,
        true
      );
    });

    it('should cancel a running coding results download', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'processing', progress: 50 }) as never);
      exportServiceMock.cancelExportJob.mockReturnValue(of({ success: true, message: 'cancelled' }));

      const downloadPromise = service.downloadCodingResults('v2', 'csv', false, true);
      await new Promise(resolve => { setTimeout(resolve, 20); });

      service.cancelCodingResultsDownload();
      await downloadPromise;

      expect(exportServiceMock.cancelExportJob).toHaveBeenCalledWith(1, 'job-1');
      expect(exportServiceMock.downloadExportFile).not.toHaveBeenCalled();
    });

    it('should keep polling active when cancelling a running download fails', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'processing', progress: 50 }) as never);
      exportServiceMock.cancelExportJob.mockReturnValue(throwError(() => new Error('cancel failed')));

      const downloadPromise = service.downloadCodingResults('v2', 'csv', false, true);
      await new Promise(resolve => { setTimeout(resolve, 20); });

      service.cancelCodingResultsDownload();
      await new Promise(resolve => { setTimeout(resolve, 20); });

      let progress: number | null = null;
      const progressSubscription = service.downloadProgress$.subscribe(value => {
        progress = value;
      });
      progressSubscription.unsubscribe();

      expect(exportServiceMock.cancelExportJob).toHaveBeenCalledWith(1, 'job-1');
      expect(progress).toBe(50);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'coding-management.download-dialog.cancel-failed',
        'close',
        { duration: 5000, panelClass: ['error-snackbar'] }
      );
      expect(exportServiceMock.downloadExportFile).not.toHaveBeenCalled();

      exportServiceMock.cancelExportJob.mockReturnValue(of({ success: true, message: 'cancelled' }));
      service.cancelCodingResultsDownload();
      await downloadPromise;
    });

    it('should treat server-side cancelled export jobs as cancelled downloads', async () => {
      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'cancelled', progress: 50 }) as never);

      await service.downloadCodingResults('v2', 'csv', false, true);

      expect(snackBarMock.open).toHaveBeenCalledWith(
        'coding-management.download-dialog.download-cancelled',
        'Schließen',
        { duration: 3000 }
      );
      expect(exportServiceMock.downloadExportFile).not.toHaveBeenCalled();
    });

    it('should not download a completed job while cancellation is still pending', async () => {
      const cancelResponse$ = new Subject<{ success: boolean; message: string }>();
      const mockBlob = new Blob(['csv data'], { type: 'text/csv' });

      exportServiceMock.startExportJob.mockReturnValue(of({ jobId: 'job-1', message: 'started' }));
      exportServiceMock.getExportJobStatus.mockReturnValue(new Observable(subscriber => {
        subscriber.next({ status: 'processing', progress: 50 });
        service.cancelCodingResultsDownload();
        subscriber.next({ status: 'completed', progress: 100 });
        subscriber.complete();
      }) as never);
      exportServiceMock.cancelExportJob.mockReturnValue(cancelResponse$);
      exportServiceMock.downloadExportFile.mockReturnValue(of(mockBlob));
      global.URL.createObjectURL = jest.fn();
      global.URL.revokeObjectURL = jest.fn();

      const downloadPromise = service.downloadCodingResults('v2', 'csv', false, true);
      await new Promise(resolve => { setTimeout(resolve, 20); });

      expect(exportServiceMock.cancelExportJob).toHaveBeenCalledWith(1, 'job-1');
      expect(exportServiceMock.downloadExportFile).not.toHaveBeenCalled();

      cancelResponse$.next({ success: false, message: 'Job already completed' });
      cancelResponse$.complete();
      await downloadPromise;

      expect(exportServiceMock.downloadExportFile).toHaveBeenCalledWith(1, 'job-1');
    });
  });
});
