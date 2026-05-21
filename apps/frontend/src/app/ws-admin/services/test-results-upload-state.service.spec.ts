import {
  TestBed, fakeAsync, tick, discardPeriodicTasks, flushMicrotasks
} from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TestResultService, TestResultsOverviewResponse } from '../../shared/services/test-result/test-result.service';
import { FileService } from '../../shared/services/file/file.service';
import { TestResultsUploadStateService, PendingUploadBatch } from './test-results-upload-state.service';
import { TestPersonCodingService } from '../../coding/services/test-person-coding.service';

describe('TestResultsUploadStateService', () => {
  let service: TestResultsUploadStateService;
  let fileServiceMock: { getUploadJobStatus: jest.Mock };
  let testResultServiceMock: { invalidateCache: jest.Mock; getWorkspaceOverview: jest.Mock };
  let testPersonCodingServiceMock: { getAppliedResultsOverview: jest.Mock; getCodingFreshness: jest.Mock };
  let dialogMock: { open: jest.Mock };
  let snackBarMock: { open: jest.Mock };

  beforeEach(() => {
    fileServiceMock = {
      getUploadJobStatus: jest.fn()
    };
    testResultServiceMock = {
      invalidateCache: jest.fn(),
      getWorkspaceOverview: jest.fn().mockReturnValue(of({
        testPersons: 10,
        testGroups: 2,
        uniqueBooklets: 5,
        uniqueUnits: 20,
        uniqueResponses: 100,
        responseStatusCounts: {}
      }))
    };
    testPersonCodingServiceMock = {
      getCodingFreshness: jest.fn().mockReturnValue(of({
        workspaceId: 1,
        currentRevision: 0,
        items: []
      })),
      getAppliedResultsOverview: jest.fn().mockReturnValue(of({
        totalIncompleteResponses: 0,
        appliedResponses: 0,
        remainingResponses: 0,
        completionPercentage: 100,
        rawTotalIncompleteResponses: 0,
        rawAppliedResponses: 0,
        rawCompletionPercentage: 100,
        aggregationActive: false,
        aggregationThreshold: null,
        aggregatedDuplicateCases: 0
      }))
    };
    dialogMock = {
      open: jest.fn()
    };
    snackBarMock = {
      open: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        TestResultsUploadStateService,
        { provide: FileService, useValue: fileServiceMock },
        { provide: TestResultService, useValue: testResultServiceMock },
        { provide: TestPersonCodingService, useValue: testPersonCodingServiceMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });

    // Clear localStorage before each test
    localStorage.clear();
  });

  it('should register a batch and start polling', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const batch: PendingUploadBatch = {
      workspaceId: 1,
      jobIds: ['job1'],
      resultType: 'responses',
      beforeOverview: {
        testPersons: 5,
        testGroups: 1,
        uniqueBooklets: 2,
        uniqueUnits: 10,
        uniqueResponses: 50,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      },
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };

    fileServiceMock.getUploadJobStatus.mockReturnValue(of({ status: 'active', progress: 50 }));

    service.registerBatch(batch);

    tick(1001); // First interval tick

    let currentBatches: PendingUploadBatch[] = [];
    service.uploadingBatches$.subscribe(b => { currentBatches = b; });

    expect(currentBatches.length).toBe(1);
    expect(currentBatches[0].progress).toBe(50);

    // Now complete it
    fileServiceMock.getUploadJobStatus.mockReturnValue(of({
      status: 'completed',
      progress: 100,
      result: {
        expected: {
          testPersons: 5,
          testGroups: 1,
          uniqueBooklets: 3,
          uniqueUnits: 10,
          uniqueResponses: 50
        },
        before: batch.beforeOverview,
        after: {
          testPersons: 10,
          testGroups: 2,
          uniqueBooklets: 5,
          uniqueUnits: 20,
          uniqueResponses: 100
        },
        delta: {
          testPersons: 5,
          testGroups: 1,
          uniqueBooklets: 3,
          uniqueUnits: 10,
          uniqueResponses: 50
        },
        importedResponses: true
      }
    }));

    tick(1001); // Trigger competition detection
    tick(1000); // Allow async finishBatch (setTimeout 500ms + async calls)
    flushMicrotasks();

    expect(currentBatches.length).toBe(0);
    expect(dialogMock.open).toHaveBeenCalled();
    expect(snackBarMock.open).toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  it('should keep polling after a transient polling error', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const batch: PendingUploadBatch = {
      workspaceId: 1,
      jobIds: ['job-error'],
      resultType: 'responses',
      beforeOverview: {
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      },
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };

    const errorResponse = new HttpErrorResponse({
      error: 'Not Found',
      status: 404
    });
    fileServiceMock.getUploadJobStatus.mockReturnValue(throwError(() => errorResponse));

    service.registerBatch(batch);

    tick(1001); // Poll once
    expect(dialogMock.open).not.toHaveBeenCalled();
    expect(snackBarMock.open).not.toHaveBeenCalled();

    fileServiceMock.getUploadJobStatus.mockReturnValue(of({
      status: 'completed',
      progress: 100,
      result: {
        expected: {
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 1
        },
        before: batch.beforeOverview,
        after: {
          testPersons: 10,
          testGroups: 2,
          uniqueBooklets: 5,
          uniqueUnits: 20,
          uniqueResponses: 100
        },
        delta: {
          testPersons: 10,
          testGroups: 2,
          uniqueBooklets: 5,
          uniqueUnits: 20,
          uniqueResponses: 100
        },
        importedResponses: true
      }
    }));
    tick(1001);
    tick(1000);
    flushMicrotasks();
    expect(dialogMock.open).toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  it('should refetch a completed job until its upload result is available', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const batch: PendingUploadBatch = {
      workspaceId: 1,
      jobIds: ['job-result-lag'],
      resultType: 'responses',
      beforeOverview: {
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      },
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };

    const completedResult = {
      expected: {
        testPersons: 1,
        testGroups: 1,
        uniqueBooklets: 1,
        uniqueUnits: 2,
        uniqueResponses: 3
      },
      before: batch.beforeOverview,
      after: {
        testPersons: 1,
        testGroups: 1,
        uniqueBooklets: 1,
        uniqueUnits: 2,
        uniqueResponses: 3
      },
      delta: {
        testPersons: 1,
        testGroups: 1,
        uniqueBooklets: 1,
        uniqueUnits: 2,
        uniqueResponses: 3
      },
      responseStatusCounts: { DISPLAYED: 3 },
      importedResponses: true
    };

    fileServiceMock.getUploadJobStatus
      .mockReturnValueOnce(of({ status: 'completed', progress: 100 }))
      .mockReturnValue(of({
        status: 'completed',
        progress: 100,
        result: completedResult
      }));
    testResultServiceMock.getWorkspaceOverview.mockReturnValue(of({
      ...completedResult.after,
      responseStatusCounts: completedResult.responseStatusCounts,
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    }));
    testPersonCodingServiceMock.getCodingFreshness.mockReturnValueOnce(of({
      workspaceId: 1,
      currentRevision: 2,
      items: [
        {
          version: 'v3',
          state: 'PENDING',
          unitCount: 3,
          affectedResponseCount: 3
        }
      ]
    }));

    service.registerBatch(batch);

    tick(500);
    flushMicrotasks();
    tick(1000);
    flushMicrotasks();

    expect(fileServiceMock.getUploadJobStatus).toHaveBeenCalledTimes(2);
    expect(testPersonCodingServiceMock.getCodingFreshness).toHaveBeenCalledWith(1);
    expect(dialogMock.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        manualAppliedResultsOverview: expect.objectContaining({
          remainingResponses: 0
        }),
        manualAppliedResultsOverviewLoadFailed: false,
        result: expect.objectContaining({
          overviewPending: false,
          expected: expect.objectContaining({
            uniqueResponses: 3
          }),
          responseStatusCounts: completedResult.responseStatusCounts,
          codingFreshness: expect.objectContaining({
            currentRevision: 2,
            items: [
              expect.objectContaining({ version: 'v3' })
            ]
          })
        })
      })
    }));

    discardPeriodicTasks();
  }));

  it('should not show stale zero overview as final result for completed response uploads', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const batch: PendingUploadBatch = {
      workspaceId: 1,
      jobIds: ['job-stale-overview'],
      resultType: 'responses',
      beforeOverview: {
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      },
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };

    fileServiceMock.getUploadJobStatus.mockReturnValue(of({
      status: 'completed',
      progress: 100,
      result: {
        expected: {
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 3
        },
        before: {
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        },
        after: {
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        },
        delta: {
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        },
        importedResponses: true
      }
    }));
    testResultServiceMock.getWorkspaceOverview.mockReturnValue(of({
      ...batch.beforeOverview
    }));

    service.registerBatch(batch);

    tick(1001);
    for (let i = 0; i < 12; i += 1) {
      flushMicrotasks();
      tick(1000);
    }
    flushMicrotasks();

    expect(dialogMock.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        result: expect.objectContaining({
          overviewPending: true,
          expected: expect.objectContaining({
            uniqueResponses: 3
          })
        })
      })
    }));
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Upload abgeschlossen; die Übersicht wird noch aktualisiert.',
      'OK',
      { duration: 5000 }
    );

    discardPeriodicTasks();
  }));

  it('should retry the workspace overview when the first refresh request fails', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const batch: PendingUploadBatch = {
      workspaceId: 1,
      jobIds: ['job-overview-retry'],
      resultType: 'responses',
      beforeOverview: {
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0,
        responseStatusCounts: {},
        sessionBrowserCounts: {},
        sessionOsCounts: {},
        sessionScreenCounts: {}
      },
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };
    const overview = {
      testPersons: 1,
      testGroups: 1,
      uniqueBooklets: 1,
      uniqueUnits: 1,
      uniqueResponses: 3,
      responseStatusCounts: { DISPLAYED: 3 },
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };

    fileServiceMock.getUploadJobStatus.mockReturnValue(of({
      status: 'completed',
      progress: 100,
      result: {
        expected: {
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 3
        },
        before: batch.beforeOverview,
        after: overview,
        delta: {
          testPersons: 1,
          testGroups: 1,
          uniqueBooklets: 1,
          uniqueUnits: 1,
          uniqueResponses: 3
        },
        responseStatusCounts: overview.responseStatusCounts,
        importedResponses: true
      }
    }));
    testResultServiceMock.getWorkspaceOverview
      .mockReturnValueOnce(throwError(() => new Error('temporary offline')))
      .mockReturnValue(of(overview));

    service.registerBatch(batch);

    tick(1001);
    flushMicrotasks();
    tick(1000);
    flushMicrotasks();

    expect(dialogMock.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        result: expect.objectContaining({
          overviewPending: false,
          after: expect.objectContaining({
            uniqueResponses: 3
          })
        })
      })
    }));

    discardPeriodicTasks();
  }));

  it('should show a repeated response upload as finished when the loaded overview is unchanged', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const beforeOverview: TestResultsOverviewResponse = {
      testPersons: 45,
      testGroups: 2,
      uniqueBooklets: 47,
      uniqueUnits: 320,
      uniqueResponses: 10219,
      responseStatusCounts: {
        DISPLAYED: 7414,
        NOT_REACHED: 289,
        VALUE_CHANGED: 2298,
        UNSET: 218
      },
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };
    const batch: PendingUploadBatch = {
      workspaceId: 1,
      jobIds: ['job-repeat-upload'],
      resultType: 'responses',
      beforeOverview,
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };

    fileServiceMock.getUploadJobStatus.mockReturnValue(of({
      status: 'completed',
      progress: 100,
      result: {
        expected: {
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        },
        before: beforeOverview,
        after: beforeOverview,
        delta: {
          testPersons: 0,
          testGroups: 0,
          uniqueBooklets: 0,
          uniqueUnits: 0,
          uniqueResponses: 0
        },
        responseStatusCounts: beforeOverview.responseStatusCounts,
        importedResponses: true
      }
    }));
    testResultServiceMock.getWorkspaceOverview.mockReturnValue(of(beforeOverview));

    service.registerBatch(batch);

    tick(1001);
    tick(1000);
    flushMicrotasks();

    const resultCall = dialogMock.open.mock.calls.find(
      call => call[1]?.data?.result
    );

    expect(resultCall?.[1].data.result).toEqual(expect.objectContaining({
      overviewPending: false,
      delta: expect.objectContaining({
        testPersons: 0,
        testGroups: 0,
        uniqueBooklets: 0,
        uniqueUnits: 0,
        uniqueResponses: 0
      }),
      responseStatusCounts: beforeOverview.responseStatusCounts
    }));
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Upload abgeschlossen: Δ Testpersonen 0, Δ Responses 0',
      'OK',
      { duration: 5000 }
    );

    discardPeriodicTasks();
  }));

  it('should resume from localStorage on startup', () => {
    const batch: PendingUploadBatch = {
      workspaceId: 2,
      jobIds: ['job2'],
      resultType: 'logs',
      beforeOverview: {} as TestResultsOverviewResponse,
      initialIssues: [],
      progress: 10,
      completedCount: 0,
      totalJobs: 1
    };

    localStorage.setItem('pendingUploadJobs_2', JSON.stringify(batch));

    // Inject AFTER setting localStorage
    service = TestBed.inject(TestResultsUploadStateService);

    let currentBatches: PendingUploadBatch[] = [];
    service.uploadingBatches$.subscribe(b => { currentBatches = b; });

    expect(currentBatches.length).toBe(1);
    expect(currentBatches[0].workspaceId).toBe(2);
  });

  it('should handle a very large number of issues without stack overflow', fakeAsync(() => {
    service = TestBed.inject(TestResultsUploadStateService);
    const batch: PendingUploadBatch = {
      workspaceId: 3,
      jobIds: ['job-large'],
      resultType: 'responses',
      beforeOverview: { testPersons: 0, uniqueResponses: 0 } as TestResultsOverviewResponse,
      initialIssues: [],
      progress: 0,
      completedCount: 0,
      totalJobs: 1
    };

    const largeIssues = Array.from({ length: 100000 }, (_, i) => ({
      type: 'warning',
      message: `Issue ${i}`
    }));

    fileServiceMock.getUploadJobStatus.mockReturnValue(of({
      status: 'completed',
      progress: 100,
      result: { issues: largeIssues }
    }));

    service.registerBatch(batch);
    tick(1001); // Poll
    tick(1000); // Finish
    flushMicrotasks();

    expect(dialogMock.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: expect.objectContaining({
        result: expect.objectContaining({
          issues: expect.arrayContaining([{ type: 'warning', message: 'Issue 0' }])
        })
      })
    }));

    // Check length separately to avoid massive error messages if it fails
    const lastCall = dialogMock.open.mock.calls[0];
    expect(lastCall[1].data.result.issues.length).toBe(100000);

    discardPeriodicTasks();
  }));
});
