import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BackendMessageTranslatorService } from '../../services/backend-message-translator.service';
import { CodingBackgroundJobsService } from '../../services/coding-background-jobs.service';
import {
  JobStatus,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import { TestPersonCodingComponent } from './test-person-coding.component';

describe('TestPersonCodingComponent', () => {
  let fixture: ComponentFixture<TestPersonCodingComponent>;
  let component: TestPersonCodingComponent;
  let mockTestPersonCodingService: jest.Mocked<Partial<TestPersonCodingService>>;
  let codingBackgroundJobsService: CodingBackgroundJobsService;

  beforeEach(async () => {
    mockTestPersonCodingService = {
      getAllJobs: jest.fn().mockReturnValue(of([])),
      getWorkspaceGroups: jest.fn().mockReturnValue(of([])),
      getCodingStatistics: jest.fn().mockReturnValue(
        of({
          totalResponses: 0,
          statusCounts: {}
        })
      ),
      getJobStatus: jest.fn(),
      notifyAutoCodingCompleted: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        TestPersonCodingComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: TestPersonCodingService,
          useValue: mockTestPersonCodingService
        },
        {
          provide: AppService,
          useValue: { selectedWorkspaceId: 1 }
        },
        {
          provide: TestResultService,
          useValue: {}
        },
        {
          provide: BackendMessageTranslatorService,
          useValue: { translateMessage: jest.fn(message => message) }
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: MatDialog,
          useValue: { open: jest.fn() }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestPersonCodingComponent);
    component = fixture.componentInstance;
    codingBackgroundJobsService = TestBed.inject(CodingBackgroundJobsService);
  });

  afterEach(() => {
    component.ngOnDestroy();
  });

  it('should remember a terminal job status after polling state is cleared', () => {
    jest.useFakeTimers();
    try {
      const failedStatus: JobStatus = {
        status: 'failed',
        progress: 100,
        error: 'boom'
      };
      (mockTestPersonCodingService.getJobStatus as jest.Mock).mockReturnValueOnce(of(failedStatus));

      component.startJobStatusPolling('freshness-job-1');

      expect(component.jobStatus).toBeNull();
      expect(component.activeJobId).toBeNull();
      expect(component.lastObservedJobId).toBe('freshness-job-1');
      expect(component.getLastObservedJobStatus('freshness-job-1')).toBe('failed');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should keep freshness job polling active after a transient status error', () => {
    jest.useFakeTimers();
    try {
      const setJobRunningSpy = jest.spyOn(
        codingBackgroundJobsService,
        'setJobRunning'
      );
      const completedStatus: JobStatus = {
        status: 'completed',
        progress: 100
      };

      component.initialJobId = 'freshness-job-1';
      codingBackgroundJobsService.setJobRunning(
        1,
        'freshness-coding',
        true,
        'freshness-job-1'
      );
      (mockTestPersonCodingService.getJobStatus as jest.Mock)
        .mockReturnValueOnce(of({ error: 'temporary status error' }))
        .mockReturnValueOnce(of(completedStatus));

      component.startJobStatusPolling('freshness-job-1');

      expect(component.activeJobId).toBe('freshness-job-1');
      expect(codingBackgroundJobsService.isStatusCheckGuardActive(1)).toBe(true);
      expect(jest.getTimerCount()).toBe(1);
      expect(setJobRunningSpy).not.toHaveBeenCalledWith(
        1,
        'freshness-coding',
        false,
        'freshness-job-1'
      );

      jest.advanceTimersByTime(2000);

      expect(setJobRunningSpy).toHaveBeenCalledWith(
        1,
        'freshness-coding',
        false,
        'freshness-job-1'
      );
      expect(component.activeJobId).toBeNull();
      expect(codingBackgroundJobsService.isStatusCheckGuardActive(1)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      expect(
        mockTestPersonCodingService.notifyAutoCodingCompleted
      ).toHaveBeenCalledWith('freshness-job-1');
    } finally {
      component.stopJobStatusPolling();
      codingBackgroundJobsService.setJobRunning(
        1,
        'freshness-coding',
        false,
        'freshness-job-1'
      );
      jest.useRealTimers();
    }
  });
});
