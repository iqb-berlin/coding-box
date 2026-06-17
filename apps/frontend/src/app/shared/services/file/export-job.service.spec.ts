import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  ExportJobService,
  REPLAY_AUTH_TOKEN_ERROR_CODE,
  isReplayAuthTokenError
} from './export-job.service';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';

describe('ExportJobService', () => {
  let service: ExportJobService;
  let codingJobBackendServiceMock: jest.Mocked<CodingJobBackendService>;
  let appServiceMock: jest.Mocked<AppService>;

  beforeEach(() => {
    codingJobBackendServiceMock = {
      startExportJob: jest.fn(),
      getExportJobStatus: jest.fn(),
      cancelExportJob: jest.fn(),
      downloadExportFile: jest.fn()
    } as unknown as jest.Mocked<CodingJobBackendService>;
    appServiceMock = {
      createOwnToken: jest.fn().mockReturnValue(of('auth-token'))
    } as unknown as jest.Mocked<AppService>;

    TestBed.configureTestingModule({
      providers: [
        ExportJobService,
        { provide: CodingJobBackendService, useValue: codingJobBackendServiceMock },
        { provide: AppService, useValue: appServiceMock }
      ]
    });

    service = TestBed.inject(ExportJobService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('startJob', () => {
    it('should start job and poll', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }));

      let createdJobId = '';
      service.startJob(1, { exportType: 'aggregated', userId: 1 }).subscribe(job => {
        createdJobId = job.jobId;
      });

      expect(createdJobId).toBe('j1');
      expect(service.activeJobs.length).toBe(1);

      tick(2000);

      expect(service.completedJobs.length).toBe(1);
      expect(service.completedJobs[0].jobId).toBe('j1');

      service.ngOnDestroy(); // cleanup
    }));

    it('should surface start errors without adding a job', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        throwError(() => new Error('start failed'))
      );

      service.startJob(1, { exportType: 'aggregated', userId: 1 }).subscribe({
        error: error => {
          expect(error.message).toBe('start failed');
        }
      });

      expect(service.activeJobs.length).toBe(0);
    });

    it('should add auth token and server url when replay urls are requested', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));

      service.startJob(1, {
        exportType: 'detailed',
        includeReplayUrl: true
      }).subscribe();

      expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(1, 60);
      expect(codingJobBackendServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          exportType: 'detailed',
          includeReplayUrl: true,
          authToken: 'auth-token',
          serverUrl: window.location.origin
        })
      );
    });

    it('should not create auth token when replay urls are disabled', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));

      service.startJob(1, {
        exportType: 'detailed',
        includeReplayUrl: false
      }).subscribe();

      expect(appServiceMock.createOwnToken).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        expect.not.objectContaining({
          authToken: expect.any(String)
        })
      );
    });

    it('should keep existing auth token when replay urls are requested', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));

      service.startJob(1, {
        exportType: 'detailed',
        includeReplayUrl: true,
        authToken: 'existing-token'
      }).subscribe();

      expect(appServiceMock.createOwnToken).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          includeReplayUrl: true,
          authToken: 'existing-token'
        })
      );
    });

    it('should surface replay auth token errors without starting an export job', () => {
      appServiceMock.createOwnToken.mockReturnValue(
        throwError(() => new Error('token failed'))
      );

      service.startJob(1, {
        exportType: 'detailed',
        includeReplayUrl: true
      }).subscribe({
        error: error => {
          expect(isReplayAuthTokenError(error)).toBe(true);
          expect(error.code).toBe(REPLAY_AUTH_TOKEN_ERROR_CODE);
        }
      });

      expect(codingJobBackendServiceMock.startExportJob).not.toHaveBeenCalled();
      expect(service.activeJobs.length).toBe(0);
    });
  });
});
