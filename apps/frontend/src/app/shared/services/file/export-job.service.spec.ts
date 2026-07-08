import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import {
  ExportJobService,
  REPLAY_AUTH_TOKEN_ERROR_CODE,
  isReplayAuthTokenError
} from './export-job.service';
import { CodingJobBackendService } from '../../../coding/services/coding-job-backend.service';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import {
  DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
  EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
} from '../../../core/services/auth-session.config';

describe('ExportJobService', () => {
  let service: ExportJobService;
  let codingJobBackendServiceMock: jest.Mocked<CodingJobBackendService>;
  let appServiceMock: jest.Mocked<AppService>;
  let workspaceSettingsServiceMock: jest.Mocked<WorkspaceSettingsService>;

  beforeEach(() => {
    codingJobBackendServiceMock = {
      startExportJob: jest.fn(),
      getExportJobStatus: jest.fn(),
      cancelExportJob: jest.fn(),
      downloadExportFile: jest.fn()
    } as unknown as jest.Mocked<CodingJobBackendService>;
    appServiceMock = {
      createOwnToken: jest.fn().mockReturnValue(of('auth-token')),
      getWorkspaceTokenPolicy: jest.fn().mockReturnValue(of({
        scopes: {
          'replay:read': { maxDurationDays: DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      }))
    } as unknown as jest.Mocked<AppService>;
    workspaceSettingsServiceMock = {
      getReplayUrlExportMode: jest.fn().mockReturnValue(of('auth')),
      getReplayUrlExportTokenDurationDays: jest.fn((_: number, maxDurationDays: number) => of(maxDurationDays))
    } as unknown as jest.Mocked<WorkspaceSettingsService>;

    TestBed.configureTestingModule({
      providers: [
        ExportJobService,
        { provide: CodingJobBackendService, useValue: codingJobBackendServiceMock },
        { provide: AppService, useValue: appServiceMock },
        { provide: WorkspaceSettingsService, useValue: workspaceSettingsServiceMock }
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

    it('should keep structured progress details from polling', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({
        status: 'active',
        progress: 55,
        progressPhase: 'writing',
        processedRows: 100,
        totalRows: 200,
        progressMessage: '100/200 rows'
      }));

      service.startJob(1, { exportType: 'results-by-version', userId: 1 }).subscribe();

      tick(2000);

      expect(service.activeJobs[0]).toEqual(expect.objectContaining({
        progress: 55,
        progressPhase: 'writing',
        processedRows: 100,
        totalRows: 200,
        progressMessage: '100/200 rows'
      }));

      service.ngOnDestroy();
    }));

    it('should keep display metadata on the local job', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));

      service.startJob(1, {
        exportType: 'aggregated',
        userId: 1,
        displayLabelKey: 'export-toast.types.manual-review-most-frequent',
        downloadFilePrefix: 'manual-review-most-frequent'
      }).subscribe();

      expect(service.activeJobs[0]).toEqual(expect.objectContaining({
        displayLabelKey: 'export-toast.types.manual-review-most-frequent',
        downloadFilePrefix: 'manual-review-most-frequent'
      }));
      const requestConfig = codingJobBackendServiceMock.startExportJob.mock.calls[0][1];
      expect(requestConfig).not.toEqual(expect.objectContaining({
        displayLabelKey: expect.any(String)
      }));
      expect(requestConfig).not.toEqual(expect.objectContaining({
        downloadFilePrefix: expect.any(String)
      }));
    });

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

      expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
        1,
        DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
        EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
      );
      expect(workspaceSettingsServiceMock.getReplayUrlExportTokenDurationDays).toHaveBeenCalledWith(
        1,
        DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS
      );
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

    it('should use the configured export replay token duration', () => {
      workspaceSettingsServiceMock.getReplayUrlExportTokenDurationDays.mockReturnValueOnce(of(30));
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));

      service.startJob(1, {
        exportType: 'detailed',
        includeReplayUrl: true
      }).subscribe();

      expect(appServiceMock.createOwnToken).toHaveBeenCalledWith(
        1,
        30,
        EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES
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

    it('should use workspace login links without creating auth token in workspaceId mode', () => {
      workspaceSettingsServiceMock.getReplayUrlExportMode.mockReturnValueOnce(of('workspaceId'));
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));

      service.startJob(1, {
        exportType: 'detailed',
        includeReplayUrl: true
      }).subscribe();

      expect(appServiceMock.createOwnToken).not.toHaveBeenCalled();
      expect(codingJobBackendServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          includeReplayUrl: true,
          serverUrl: window.location.origin
        })
      );
      expect(codingJobBackendServiceMock.startExportJob).toHaveBeenCalledWith(
        1,
        expect.not.objectContaining({
          authToken: expect.any(String)
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

  describe('downloadFile', () => {
    it('should use the display file prefix when present', () => {
      const blob = new Blob(['xlsx'], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const anchor = document.createElement('a');
      const clickSpy = jest.spyOn(anchor, 'click').mockImplementation();
      const createElementSpy = jest.spyOn(document, 'createElement').mockReturnValue(anchor);

      Object.defineProperty(window.URL, 'createObjectURL', {
        value: jest.fn().mockReturnValue('blob:url'),
        configurable: true
      });
      Object.defineProperty(window.URL, 'revokeObjectURL', {
        value: jest.fn(),
        configurable: true
      });
      codingJobBackendServiceMock.downloadExportFile.mockReturnValue(of(blob));
      const date = new Date().toISOString().slice(0, 10);

      service.downloadFile(
        1,
        'j1',
        'aggregated',
        'export.xlsx',
        'manual-review-most-frequent'
      );

      expect(anchor.download).toBe(`export-manual-review-most-frequent-${date}.xlsx`);
      expect(clickSpy).toHaveBeenCalled();

      createElementSpy.mockRestore();
    });

    it('should allow cancelling an in-flight file download without cancelling the completed job', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({ jobId: 'j1', message: 'Job started' }));
      const fileDownload$ = new Subject<Blob>();
      codingJobBackendServiceMock.downloadExportFile.mockReturnValue(fileDownload$);

      service.startJob(1, { exportType: 'aggregated', userId: 1 }).subscribe();
      service.downloadFile(1, 'j1', 'aggregated', 'export.xlsx');

      expect(service.activeJobs[0].status).toBe('downloading');
      expect(fileDownload$.observers.length).toBe(1);

      service.cancelJob(service.activeJobs[0]);

      expect(fileDownload$.observers.length).toBe(0);
      expect(codingJobBackendServiceMock.cancelExportJob).not.toHaveBeenCalled();
      expect(service.completedJobs[0].status).toBe('completed');
    });
  });
});
