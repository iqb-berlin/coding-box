import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of, throwError } from 'rxjs';
import {
  ExportJobService,
  REPLAY_AUTH_TOKEN_ERROR_CODE,
  isReplayAuthTokenError
} from './export-job.service';
import {
  CodingJobBackendService,
  ExportJobListResponse
} from '../../../coding/services/coding-job-backend.service';
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
      getExportJobs: jest.fn(),
      getExportJobStatus: jest.fn(),
      cancelExportJob: jest.fn(),
      downloadExportFile: jest.fn(),
      getItemMatrixExportDiagnostics: jest.fn(),
      downloadIncompleteItemMatrix: jest.fn(),
      deleteExportJob: jest.fn().mockReturnValue(of({
        success: true,
        message: 'deleted'
      }))
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

  describe('restoreWorkspaceJobs', () => {
    it('restores completed and structured failed jobs', () => {
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(of({
        jobs: [
          {
            jobId: 'completed',
            status: 'completed',
            progress: 100,
            exportType: 'item-matrix',
            createdAt: 10,
            result: {
              fileId: 'completed',
              fileName: 'Itemdatensatz.csv',
              fileSize: 42,
              workspaceId: 5,
              userId: 2,
              exportType: 'item-matrix',
              createdAt: 10,
              expiresAt: 3_600_010
            }
          },
          {
            jobId: 'failed',
            status: 'failed',
            progress: 90,
            exportType: 'item-matrix',
            createdAt: 11,
            error: 'incomplete',
            errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
            errorDetails: {
              total: 2,
              groupCount: 1,
              sampleLimit: 20,
              diagnosticsAvailable: true,
              incompleteDownloadAvailable: true
            }
          }
        ],
        historyPending: false
      }));

      service.restoreWorkspaceJobs(5).subscribe();

      expect(service.completedJobs[0]).toEqual(expect.objectContaining({
        jobId: 'completed',
        workspaceId: 5,
        downloadFilePrefix: 'Itemdatensatz',
        result: { fileName: 'Itemdatensatz.csv', fileSize: 42 }
      }));
      expect(service.failedJobs[0]).toEqual(expect.objectContaining({
        jobId: 'failed',
        errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
        errorDetails: expect.objectContaining({
          diagnosticsAvailable: true,
          incompleteDownloadAvailable: true
        })
      }));
    });

    it('restores active jobs and resumes polling after a client reload', fakeAsync(() => {
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(of({
        jobs: [{
          jobId: 'active',
          status: 'processing',
          progress: 50,
          exportType: 'aggregated',
          createdAt: 10
        }],
        historyPending: false
      }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({
        status: 'completed',
        progress: 100
      }));

      service.restoreWorkspaceJobs(5).subscribe();
      expect(service.activeJobs).toEqual([
        expect.objectContaining({ jobId: 'active', status: 'active' })
      ]);

      tick(2000);

      expect(codingJobBackendServiceMock.getExportJobStatus)
        .toHaveBeenCalledWith(5, 'active');
      expect(service.completedJobs).toEqual([
        expect.objectContaining({ jobId: 'active' })
      ]);
    }));

    it('omits jobs whose artifacts have expired', () => {
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(of({
        jobs: [
          {
            jobId: 'completed',
            status: 'completed',
            progress: 100,
            exportType: 'aggregated',
            createdAt: 10
          },
          {
            jobId: 'failed',
            status: 'failed',
            progress: 90,
            exportType: 'item-matrix',
            createdAt: 11,
            errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
            errorDetails: {
              total: 2,
              groupCount: 0,
              sampleLimit: 20,
              diagnosticsAvailable: false,
              incompleteDownloadAvailable: false
            }
          }
        ],
        historyPending: false
      }));

      service.restoreWorkspaceJobs(5).subscribe();

      expect(service.completedJobs).toEqual([]);
      expect(service.failedJobs).toEqual([]);
    });

    it('keeps the current jobs when restoration fails', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
        jobId: 'local',
        message: 'Job started'
      }));
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(
        throwError(() => new Error('offline'))
      );
      service.startJob(5, { exportType: 'aggregated' }).subscribe();

      service.restoreWorkspaceJobs(5).subscribe();

      expect(service.activeJobs.map(job => job.jobId)).toEqual(['local']);
    });

    it('retries restoration after a transient request failure', fakeAsync(() => {
      codingJobBackendServiceMock.getExportJobs
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({
              status: 503
            })
          )
        )
        .mockReturnValueOnce(
          of({
            jobs: [
              {
                jobId: 'restored',
                status: 'processing',
                progress: 25,
                exportType: 'aggregated',
                createdAt: 10
              }
            ],
            historyPending: false
          })
        );
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(
        of({
          status: 'processing',
          progress: 30
        })
      );

      service.restoreWorkspaceJobs(5).subscribe();

      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(
        1
      );
      tick(2000);
      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(
        2
      );
      expect(service.activeJobs).toEqual([
        expect.objectContaining({ jobId: 'restored', workspaceId: 5 })
      ]);

      service.ngOnDestroy();
    }));

    it('reloads the job list until legacy history is ready', fakeAsync(() => {
      codingJobBackendServiceMock.getExportJobs
        .mockReturnValueOnce(
          of({
            jobs: [
              {
                jobId: 'active',
                status: 'processing',
                progress: 25,
                exportType: 'aggregated',
                createdAt: 20
              }
            ],
            historyPending: true
          })
        )
        .mockReturnValueOnce(
          of({
            jobs: [
              {
                jobId: 'legacy-failure',
                status: 'failed',
                progress: 80,
                exportType: 'aggregated',
                createdAt: 10,
                error: 'legacy failure'
              }
            ],
            historyPending: false
          })
        );
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(
        of({
          status: 'processing',
          progress: 30
        })
      );

      service.restoreWorkspaceJobs(5).subscribe();

      expect(service.activeJobs.map(job => job.jobId)).toEqual(['active']);
      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(
        1
      );

      tick(2000);

      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(
        2
      );
      expect(service.failedJobs.map(job => job.jobId)).toEqual([
        'legacy-failure'
      ]);

      service.ngOnDestroy();
    }));

    it('backs off repeated reloads while legacy history remains pending', fakeAsync(() => {
      codingJobBackendServiceMock.getExportJobs
        .mockReturnValueOnce(of({ jobs: [], historyPending: true }))
        .mockReturnValueOnce(of({ jobs: [], historyPending: true }))
        .mockReturnValueOnce(of({ jobs: [], historyPending: false }));

      service.restoreWorkspaceJobs(5).subscribe();

      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(1);
      tick(2000);
      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(2);

      tick(3999);
      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(2);
      tick(1);
      expect(codingJobBackendServiceMock.getExportJobs).toHaveBeenCalledTimes(3);

      service.ngOnDestroy();
    }));

    it('keeps jobs started while restoration is in flight', fakeAsync(() => {
      const restoration = new Subject<ExportJobListResponse>();
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(restoration);
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
        jobId: 'started-during-restore',
        message: 'Job started'
      }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({
        status: 'processing',
        progress: 25
      }));

      service.restoreWorkspaceJobs(5).subscribe();
      service.startJob(5, { exportType: 'aggregated' }).subscribe();
      restoration.next({ jobs: [], historyPending: false });
      restoration.complete();

      expect(service.activeJobs.map(job => job.jobId))
        .toEqual(['started-during-restore']);

      tick(2000);

      expect(codingJobBackendServiceMock.getExportJobStatus)
        .toHaveBeenCalledWith(5, 'started-during-restore');
    }));

    it('keeps an already running local job when its workspace is restored', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
        jobId: 'running-before-restore',
        message: 'Job started'
      }));
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(of({
        jobs: [],
        historyPending: false
      }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({
        status: 'processing',
        progress: 25
      }));

      service.startJob(5, { exportType: 'aggregated' }).subscribe();
      service.restoreWorkspaceJobs(5).subscribe();

      expect(service.activeJobs.map(job => job.jobId))
        .toEqual(['running-before-restore']);

      tick(2000);

      expect(codingJobBackendServiceMock.getExportJobStatus)
        .toHaveBeenCalledWith(5, 'running-before-restore');
    }));

    it('keeps a local job that completes while restoration is in flight', fakeAsync(() => {
      const restoration = new Subject<ExportJobListResponse>();
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
        jobId: 'completed-during-restore',
        message: 'Job started'
      }));
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(restoration);
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({
        status: 'completed',
        progress: 100,
        result: {
          fileId: 'completed-during-restore',
          fileName: 'export.csv',
          fileSize: 42,
          workspaceId: 5,
          userId: 2,
          exportType: 'aggregated',
          createdAt: 10,
          expiresAt: 3_600_010
        }
      }));

      service.startJob(5, { exportType: 'aggregated' }).subscribe();
      service.restoreWorkspaceJobs(5).subscribe();
      tick(2000);
      restoration.next({ jobs: [], historyPending: false });
      restoration.complete();

      expect(service.completedJobs.map(job => job.jobId))
        .toEqual(['completed-during-restore']);
    }));

    it('ignores an older overlapping restoration response', () => {
      const firstRestore = new Subject<ExportJobListResponse>();
      const secondRestore = new Subject<ExportJobListResponse>();
      codingJobBackendServiceMock.getExportJobs
        .mockReturnValueOnce(firstRestore)
        .mockReturnValueOnce(secondRestore);

      service.restoreWorkspaceJobs(5).subscribe();
      service.restoreWorkspaceJobs(5).subscribe();
      secondRestore.next({
        jobs: [{
          jobId: 'latest',
          status: 'failed',
          progress: 10,
          exportType: 'aggregated',
          createdAt: 20
        }],
        historyPending: false
      });
      firstRestore.next({
        jobs: [{
          jobId: 'stale',
          status: 'failed',
          progress: 10,
          exportType: 'aggregated',
          createdAt: 10
        }],
        historyPending: false
      });

      expect(service.failedJobs.map(job => job.jobId)).toEqual(['latest']);
    });

    it('restores manual export display metadata', () => {
      codingJobBackendServiceMock.getExportJobs.mockReturnValue(of({
        jobs: [{
          jobId: 'manual-review',
          status: 'failed',
          progress: 80,
          exportType: 'aggregated',
          createdAt: 10,
          displayVariant: 'manual-review-new-column-per-coder'
        }],
        historyPending: false
      }));

      service.restoreWorkspaceJobs(5).subscribe();

      expect(service.failedJobs[0]).toEqual(expect.objectContaining({
        displayLabelKey:
          'export-toast.types.manual-review-new-column-per-coder',
        downloadFilePrefix: 'manual-review-new-column-per-coder'
      }));
    });
  });

  it.each([
    ['a rejected deletion', of({ success: false, message: 'not deleted' })],
    ['a failed deletion request', throwError(() => new Error('offline'))]
  ])('keeps a job visible after %s', (_label, deletionResult) => {
    codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
      jobId: 'j1',
      message: 'Job started'
    }));
    codingJobBackendServiceMock.deleteExportJob.mockReturnValue(
      deletionResult
    );
    service.startJob(1, {
      exportType: 'aggregated',
      userId: 1
    }).subscribe();
    let removed = true;

    service.removeJob('j1').subscribe(result => {
      removed = result;
    });

    expect(removed).toBe(false);
    expect(service.activeJobs.map(job => job.jobId)).toContain('j1');
    service.ngOnDestroy();
  });

  it('removes a job only after backend cleanup succeeds', () => {
    codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
      jobId: 'j1',
      message: 'Job started'
    }));
    service.startJob(1, {
      exportType: 'aggregated',
      userId: 1
    }).subscribe();
    let removed = false;

    service.removeJob('j1').subscribe(result => {
      removed = result;
    });

    expect(removed).toBe(true);
    expect(service.activeJobs.map(job => job.jobId)).not.toContain('j1');
    service.ngOnDestroy();
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
        status: 'processing',
        progress: 55,
        progressPhase: 'writing',
        processedRows: 100,
        totalRows: 200,
        progressMessage: '100/200 rows'
      }));

      service.startJob(1, {
        exportType: 'results-by-version',
        userId: 1,
        missingsProfileId: 7
      }).subscribe();

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

    it('keeps polling after a transient status request failure', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        of({
          jobId: 'j1',
          message: 'Job started'
        })
      );
      codingJobBackendServiceMock.getExportJobStatus
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({
              status: 0,
              statusText: 'Offline'
            })
          )
        )
        .mockReturnValueOnce(of({ status: 'completed', progress: 100 }));

      service
        .startJob(1, {
          exportType: 'aggregated',
          userId: 1
        })
        .subscribe();

      tick(2000);
      expect(service.activeJobs).toEqual([
        expect.objectContaining({ jobId: 'j1' })
      ]);

      tick(2000);
      expect(
        codingJobBackendServiceMock.getExportJobStatus
      ).toHaveBeenCalledTimes(2);
      expect(service.completedJobs).toEqual([
        expect.objectContaining({ jobId: 'j1' })
      ]);

      service.ngOnDestroy();
    }));

    it('keeps polling while a lease cleanup claim is being released', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        of({
          jobId: 'j1',
          message: 'Job started'
        })
      );
      codingJobBackendServiceMock.getExportJobStatus
        .mockReturnValueOnce(
          throwError(
            () => new HttpErrorResponse({
              status: 409,
              statusText: 'Lease cleanup in progress'
            })
          )
        )
        .mockReturnValueOnce(of({ status: 'processing', progress: 40 }));

      service
        .startJob(1, {
          exportType: 'aggregated',
          userId: 1
        })
        .subscribe();

      tick(2000);
      expect(service.activeJobs).toEqual([
        expect.objectContaining({ jobId: 'j1' })
      ]);

      tick(2000);
      expect(
        codingJobBackendServiceMock.getExportJobStatus
      ).toHaveBeenCalledTimes(2);
      expect(service.activeJobs).toEqual([
        expect.objectContaining({ jobId: 'j1', progress: 40 })
      ]);
      expect(service.unavailableJobs).toEqual([]);

      service.ngOnDestroy();
    }));

    it('marks the status unavailable after a terminal request failure', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        of({
          jobId: 'j1',
          message: 'Job started'
        })
      );
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status: 403 }))
      );

      service
        .startJob(1, {
          exportType: 'aggregated',
          userId: 1
        })
        .subscribe();

      tick(2000);
      expect(service.unavailableJobs).toEqual([
        expect.objectContaining({
          jobId: 'j1',
          error: 'Failed to get job status'
        })
      ]);
      expect(service.failedJobs).toEqual([]);

      tick(2000);
      expect(
        codingJobBackendServiceMock.getExportJobStatus
      ).toHaveBeenCalledTimes(1);

      service.ngOnDestroy();
    }));

    it('does not classify a status API error as an export failure', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        of({
          jobId: 'j1',
          message: 'Job started'
        })
      );
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(
        of({
          error: 'Export job not found'
        })
      );

      service
        .startJob(1, {
          exportType: 'aggregated',
          userId: 1
        })
        .subscribe();

      tick(2000);
      expect(service.unavailableJobs).toEqual([
        expect.objectContaining({
          jobId: 'j1',
          error: 'Export job not found'
        })
      ]);
      expect(service.failedJobs).toEqual([]);

      tick(2000);
      expect(
        codingJobBackendServiceMock.getExportJobStatus
      ).toHaveBeenCalledTimes(1);

      service.ngOnDestroy();
    }));

    it('backs off persistent transient failures and eventually recovers', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        of({
          jobId: 'j1',
          message: 'Job started'
        })
      );
      let failuresRemaining = 7;
      codingJobBackendServiceMock.getExportJobStatus.mockImplementation(() => {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          return throwError(() => new HttpErrorResponse({ status: 503 }));
        }
        return of({ status: 'completed', progress: 100 });
      });

      service
        .startJob(1, {
          exportType: 'aggregated',
          userId: 1
        })
        .subscribe();

      tick(120000);
      expect(
        codingJobBackendServiceMock.getExportJobStatus
      ).toHaveBeenCalledTimes(7);
      expect(service.activeJobs).toEqual([
        expect.objectContaining({ jobId: 'j1' })
      ]);
      expect(service.failedJobs).toEqual([]);

      tick(2000);
      expect(
        codingJobBackendServiceMock.getExportJobStatus
      ).toHaveBeenCalledTimes(8);
      expect(service.completedJobs).toEqual([
        expect.objectContaining({ jobId: 'j1' })
      ]);

      service.ngOnDestroy();
    }));

    it('should expire item matrix actions without another status poll', fakeAsync(() => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(of({
        jobId: 'j1',
        message: 'Job started'
      }));
      codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(of({
        status: 'failed',
        progress: 90,
        errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
        errorDetails: {
          total: 2,
          groupCount: 1,
          sampleLimit: 20,
          diagnosticsAvailable: true,
          incompleteDownloadAvailable: true,
          expiresAt: Date.now() + 2500
        }
      }));

      service.startJob(1, {
        exportType: 'item-matrix',
        missingsProfileId: 4
      }).subscribe();

      tick(2000);
      expect(service.failedJobs[0].errorDetails).toEqual(expect.objectContaining({
        diagnosticsAvailable: true,
        incompleteDownloadAvailable: true
      }));

      tick(500);
      expect(service.failedJobs[0].errorDetails).toEqual(expect.objectContaining({
        diagnosticsAvailable: false,
        incompleteDownloadAvailable: false
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

      expect(anchor.download).toBe(`export-manual-review-most-frequent-${date}.xlsx`
      );
      expect(clickSpy).toHaveBeenCalled();

      createElementSpy.mockRestore();
    });

    it('should allow cancelling an in-flight file download without cancelling the completed job', () => {
      codingJobBackendServiceMock.startExportJob.mockReturnValue(
        of({ jobId: 'j1', message: 'Job started' })
      );
      const fileDownload$ = new Subject<Blob>();
      codingJobBackendServiceMock.downloadExportFile.mockReturnValue(
        fileDownload$
      );

      service.startJob(1, { exportType: 'aggregated', userId: 1 }).subscribe();
      service.downloadFile(1, 'j1', 'aggregated', 'export.xlsx');

      expect(service.activeJobs[0].status).toBe('downloading');
      expect(fileDownload$.observers.length).toBe(1);

      service.cancelJob(service.activeJobs[0]);

      expect(fileDownload$.observers.length).toBe(0);
      expect(
        codingJobBackendServiceMock.cancelExportJob
      ).not.toHaveBeenCalled();
      expect(service.completedJobs[0].status).toBe('completed');
    });
  });

  it('loads diagnostics and downloads an incomplete matrix without changing its failed status', () => {
    const diagnostics = { total: 2, sampleLimit: 20, groups: [] };
    const blob = new Blob(['zip'], { type: 'application/zip' });
    const job = {
      jobId: 'j1',
      workspaceId: 1,
      exportType: 'item-matrix',
      status: 'failed' as const,
      progress: 90
    };
    codingJobBackendServiceMock.getItemMatrixExportDiagnostics.mockReturnValue(
      of(diagnostics)
    );
    codingJobBackendServiceMock.downloadIncompleteItemMatrix.mockReturnValue(
      of({
        blob,
        fileName: 'Itemdatensatz-UNVOLLSTAENDIG-2026-07-25.zip'
      })
    );
    const anchor = document.createElement('a');
    jest.spyOn(anchor, 'click').mockImplementation();
    const createElementSpy = jest
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor);
    Object.defineProperty(window.URL, 'createObjectURL', {
      value: jest.fn().mockReturnValue('blob:url'),
      configurable: true
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      value: jest.fn(),
      configurable: true
    });

    let receivedTotal = 0;
    service.getItemMatrixDiagnostics(job).subscribe(result => {
      receivedTotal = result.total;
    });
    service.downloadIncompleteItemMatrix(job).subscribe();

    expect(receivedTotal).toBe(2);
    expect(
      codingJobBackendServiceMock.downloadIncompleteItemMatrix
    ).toHaveBeenCalledWith(1, 'j1');
    expect(anchor.download).toBe('Itemdatensatz-UNVOLLSTAENDIG-2026-07-25.zip');
    expect(job.status).toBe('failed');
    createElementSpy.mockRestore();
  });

  it('cancels an in-flight incomplete download when destroyed', () => {
    const download$ = new Subject<{
      blob: Blob;
      fileName?: string;
    }>();
    codingJobBackendServiceMock.downloadIncompleteItemMatrix.mockReturnValue(
      download$
    );
    service
      .downloadIncompleteItemMatrix({
        jobId: 'j1',
        workspaceId: 1,
        exportType: 'item-matrix',
        status: 'failed',
        progress: 90
      })
      .subscribe();

    expect(download$.observers).toHaveLength(1);
    service.ngOnDestroy();
    expect(download$.observers).toHaveLength(0);
  });

  it('marks item matrix artifacts expired after a 404 download', fakeAsync(() => {
    codingJobBackendServiceMock.startExportJob.mockReturnValue(
      of({
        jobId: 'j1',
        message: 'Job started'
      })
    );
    codingJobBackendServiceMock.getExportJobStatus.mockReturnValue(
      of({
        status: 'failed',
        progress: 90,
        errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
        errorDetails: {
          total: 2,
          groupCount: 1,
          sampleLimit: 20,
          diagnosticsAvailable: true,
          incompleteDownloadAvailable: true,
          expiresAt: Date.now() + 3600000
        }
      })
    );
    codingJobBackendServiceMock.downloadIncompleteItemMatrix.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 404 }))
    );
    service
      .startJob(1, {
        exportType: 'item-matrix',
        missingsProfileId: 4
      })
      .subscribe();
    tick(2000);

    service.downloadIncompleteItemMatrix(service.failedJobs[0]).subscribe({
      error: () => undefined
    });

    expect(service.failedJobs[0].errorDetails).toEqual(
      expect.objectContaining({
        diagnosticsAvailable: false,
        incompleteDownloadAvailable: false
      })
    );
    service.ngOnDestroy();
  }));
});
