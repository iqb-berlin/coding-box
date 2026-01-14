// eslint-disable-next-line max-classes-per-file
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { environment } from '../../../../environments/environment';
import { TestResultsComponent } from './test-results.component';
import { SERVER_URL } from '../../../injection-tokens';
import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { FileService } from '../../../shared/services/file/file.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { ValidationTaskStateService } from '../../../shared/services/validation/validation-task-state.service';
import { UnitsReplayService } from '../../../replay/services/units-replay.service';

describe('TestResultsComponent', () => {
  let component: TestResultsComponent;
  let fixture: ComponentFixture<TestResultsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        MatCheckboxModule,
        MatTooltipModule,
        MatIconModule,
        MatTableModule,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        provideHttpClient(),
        {
          provide: SERVER_URL,
          useValue: environment.backendUrl
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: MatDialog,
          useValue: { open: jest.fn(), closeAll: jest.fn() }
        },
        {
          provide: TestResultBackendService,
          useValue: {
            getTestResults: jest.fn().mockReturnValue(of([])),
            getTestResultsOverview: jest.fn().mockReturnValue(of({})),
            getExportTestResultsJobs: jest.fn().mockReturnValue(of([]))
          }
        },
        {
          provide: ValidationService,
          useValue: { getValidationStatus: jest.fn().mockReturnValue(of({})) }
        },
        {
          provide: UnitNoteService,
          useValue: { getUnitNotes: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: FileService,
          useValue: { getFilesList: jest.fn().mockReturnValue(of({ data: [] })) }
        },
        {
          provide: ResponseService,
          useValue: { getResponses: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: UnitService,
          useValue: { getUnits: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: CodingStatisticsService,
          useValue: { getCodingStatistics: jest.fn().mockReturnValue(of({})) }
        },
        {
          provide: VariableAnalysisService,
          useValue: { getVariableAnalysis: jest.fn().mockReturnValue(of([])) }
        },
        {
          provide: AppService,
          useValue: { selectedWorkspaceId: 1, loggedUser: { sub: 'user' } }
        },
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
        {
          provide: UnitsReplayService,
          useValue: { getUnitsFromFileUpload: jest.fn().mockReturnValue(of(null)) }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestResultsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
