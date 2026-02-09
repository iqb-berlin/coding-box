import {
  ComponentFixture, TestBed
} from '@angular/core/testing';
import { of } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestResultsComponent } from './test-results.component';
import { FileService } from '../../../shared/services/file/file.service';
import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { UnitsReplayService } from '../../../replay/services/units-replay.service';
import { TestResultsUploadStateService } from '../../services/test-results-upload-state.service';

describe('TestResultsComponent Polling', () => {
  let fixture: ComponentFixture<TestResultsComponent>;
  let uploadStateServiceMock: {
    uploadingBatches$: typeof TestResultsUploadStateService.prototype.uploadingBatches$;
    uploadsFinished$: typeof TestResultsUploadStateService.prototype.uploadsFinished$;
    registerBatch: jest.Mock;
  };

  beforeEach(async () => {
    uploadStateServiceMock = {
      uploadingBatches$: of([]),
      uploadsFinished$: of(),
      registerBatch: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        MatCheckboxModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        TestResultsComponent // Import standalone component
      ],
      providers: [
        { provide: FileService, useValue: { getFilesList: jest.fn().mockReturnValue(of({ data: [] })) } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
        { provide: MatDialog, useValue: { open: jest.fn(), closeAll: jest.fn() } },
        {
          provide: TestResultBackendService,
          useValue: {
            getTestResults: jest.fn().mockReturnValue(of([])),
            getTestResultsOverview: jest.fn().mockReturnValue(of({})),
            getExportTestResultsJobs: jest.fn().mockReturnValue(of([]))
          }
        },
        { provide: ValidationService, useValue: { getValidationStatus: jest.fn().mockReturnValue(of({})) } },
        { provide: UnitNoteService, useValue: { getUnitNotes: jest.fn().mockReturnValue(of([])) } },
        { provide: ResponseService, useValue: { getResponses: jest.fn().mockReturnValue(of([])) } },
        { provide: UnitService, useValue: { getUnits: jest.fn().mockReturnValue(of([])) } },
        { provide: CodingStatisticsService, useValue: { getCodingStatistics: jest.fn().mockReturnValue(of({})) } },
        { provide: VariableAnalysisService, useValue: { getVariableAnalysis: jest.fn().mockReturnValue(of([])) } },
        { provide: AppService, useValue: { selectedWorkspaceId: 1, loggedUser: { sub: 'user' } } },
        {
          provide: TestResultService,
          useValue: {
            getTestResults: jest.fn().mockReturnValue(of([])),
            getWorkspaceOverview: jest.fn().mockReturnValue(of({}))
          }
        },
        {
          provide: ValidationTaskStateService,
          useValue: {
            getValidationStatus: jest.fn().mockReturnValue(of({})),
            getAllTaskIds: jest.fn().mockReturnValue({}),
            observeTaskIds: jest.fn().mockReturnValue(of({})),
            observeValidationResults: jest.fn().mockReturnValue(of({})),
            observeBatchState: jest.fn().mockReturnValue(of({ status: 'idle' }))
          }
        },
        { provide: UnitsReplayService, useValue: { getUnitsFromFileUpload: jest.fn().mockReturnValue(of(null)) } },
        { provide: TestResultsUploadStateService, useValue: uploadStateServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestResultsComponent);
  });

  it('should subscribe to upload state service on init', () => {
    const subscribeSpy = jest.spyOn(uploadStateServiceMock.uploadingBatches$, 'subscribe');
    fixture.detectChanges();
    expect(subscribeSpy).toHaveBeenCalled();
  });
});
