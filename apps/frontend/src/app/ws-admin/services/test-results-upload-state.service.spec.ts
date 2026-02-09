import {
  TestBed, fakeAsync, tick, discardPeriodicTasks
} from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TestResultService, TestResultsOverviewResponse } from '../../shared/services/test-result/test-result.service';
import { FileService } from '../../shared/services/file/file.service';
import { TestResultsUploadStateService, PendingUploadBatch } from './test-results-upload-state.service';

describe('TestResultsUploadStateService', () => {
  let service: TestResultsUploadStateService;
  let fileServiceMock: { getUploadJobStatus: jest.Mock };
  let testResultServiceMock: { invalidateCache: jest.Mock; getWorkspaceOverview: jest.Mock };
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
    fileServiceMock.getUploadJobStatus.mockReturnValue(of({ status: 'completed', progress: 100 }));

    tick(1001); // Trigger competition detection
    tick(1000); // Allow async finishBatch (setTimeout 500ms + async calls)

    expect(currentBatches.length).toBe(0);
    expect(dialogMock.open).toHaveBeenCalled();
    expect(snackBarMock.open).toHaveBeenCalled();

    discardPeriodicTasks();
  }));

  it('should handle error during polling by marking job as finished', fakeAsync(() => {
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
    tick(1000); // Allow finishBatch
    expect(dialogMock.open).toHaveBeenCalled(); // Should finish because completedCount === totalJobs (error counts as done)

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
