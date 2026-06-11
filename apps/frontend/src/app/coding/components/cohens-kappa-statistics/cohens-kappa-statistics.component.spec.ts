import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DATA,
  MatDialogRef
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of, Subject } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { CoderTraining } from '../../models/coder-training.model';
import {
  CohensKappaStatisticsResponse,
  TestPersonCodingService
} from '../../services/test-person-coding.service';
import {
  CohensKappaStatisticsComponent,
  CohensKappaStatisticsDialogData
} from './cohens-kappa-statistics.component';

describe('CohensKappaStatisticsComponent', () => {
  let fixture: ComponentFixture<CohensKappaStatisticsComponent>;
  let component: CohensKappaStatisticsComponent;
  let testPersonCodingService: {
    getCohensKappaStatistics: jest.Mock;
    exportCohensKappaSummaryAsCsv: jest.Mock;
    exportCohensKappaStatisticsAsXlsx: jest.Mock;
    exportCohensKappaStatisticsAsCsv: jest.Mock;
  };

  const kappaResponse: CohensKappaStatisticsResponse = {
    variables: [
      {
        unitName: 'UNIT',
        variableId: 'VAR',
        caseCount: 3,
        doubleCodedCount: 2,
        doubleCodedRate: 0.67,
        validPairCount: 2,
        coderPairCount: 1,
        meanKappa: 0.5,
        meanAgreement: 0.75,
        coderPairs: []
      }
    ],
    workspaceSummary: {
      totalCodedResponses: 3,
      totalDoubleCodedResponses: 2,
      totalCoderPairs: 1,
      averageKappa: 0.5,
      meanAgreement: 0.75,
      variablesIncluded: 1,
      codersIncluded: 2,
      weightingMethod: 'weighted'
    }
  };

  const trainings = [
    createTraining(7, 'Schulung A'),
    createTraining(9, 'Schulung B')
  ];

  function createKappaResponse(variableId: string): CohensKappaStatisticsResponse {
    return {
      ...kappaResponse,
      variables: [
        {
          ...kappaResponse.variables[0],
          variableId
        }
      ]
    };
  }

  function createTraining(id: number, label: string): CoderTraining {
    return {
      id,
      label,
      workspace_id: 1,
      created_at: new Date('2026-06-01T08:00:00Z'),
      updated_at: new Date('2026-06-01T08:00:00Z'),
      jobsCount: 2
    };
  }

  async function createComponent(dialogData: CohensKappaStatisticsDialogData): Promise<void> {
    testPersonCodingService = {
      getCohensKappaStatistics: jest.fn().mockReturnValue(of(kappaResponse)),
      exportCohensKappaSummaryAsCsv: jest.fn().mockReturnValue(of(new Blob(['summary']))),
      exportCohensKappaStatisticsAsXlsx: jest.fn().mockReturnValue(of(new Blob(['xlsx']))),
      exportCohensKappaStatisticsAsCsv: jest.fn().mockReturnValue(of(new Blob(['details'])))
    };

    await TestBed.configureTestingModule({
      imports: [
        CohensKappaStatisticsComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        provideNoopAnimations(),
        {
          provide: MatDialogRef,
          useValue: { close: jest.fn() }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: dialogData
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: AppService,
          useValue: { selectedWorkspaceId: 1 }
        },
        {
          provide: TestPersonCodingService,
          useValue: testPersonCodingService
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CohensKappaStatisticsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('auto-selects a single coder training and loads kappa statistics for it', async () => {
    await createComponent({
      excludeTrainings: false,
      availableCoderTrainings: [trainings[0]]
    });

    expect(component.selectedCoderTrainingId).toBe(7);
    expect(testPersonCodingService.getCohensKappaStatistics).toHaveBeenCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      { coderTrainingIds: [7] }
    );
  });

  it('waits for a selection when multiple coder trainings are available', async () => {
    await createComponent({
      excludeTrainings: false,
      availableCoderTrainings: trainings
    });

    expect(component.selectedCoderTrainingId).toBeNull();
    expect(testPersonCodingService.getCohensKappaStatistics).not.toHaveBeenCalled();
    expect(component.canLoadKappaStatistics).toBe(false);
  });

  it('reloads kappa statistics with the selected coder training', async () => {
    await createComponent({
      excludeTrainings: false,
      availableCoderTrainings: trainings
    });

    component.selectedCoderTrainingId = 9;
    component.onCoderTrainingSelectionChange();

    expect(testPersonCodingService.getCohensKappaStatistics).toHaveBeenCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      { coderTrainingIds: [9] }
    );
  });

  it('ignores stale kappa statistics responses after changing the coder training', async () => {
    const firstTrainingResponse$ = new Subject<CohensKappaStatisticsResponse>();
    const secondTrainingResponse$ = new Subject<CohensKappaStatisticsResponse>();

    await createComponent({
      excludeTrainings: false,
      availableCoderTrainings: trainings
    });
    testPersonCodingService.getCohensKappaStatistics
      .mockReturnValueOnce(firstTrainingResponse$.asObservable())
      .mockReturnValueOnce(secondTrainingResponse$.asObservable());

    component.selectedCoderTrainingId = 7;
    component.onCoderTrainingSelectionChange();
    component.selectedCoderTrainingId = 9;
    component.onCoderTrainingSelectionChange();

    secondTrainingResponse$.next(createKappaResponse('CURRENT'));
    firstTrainingResponse$.next(createKappaResponse('STALE'));

    expect(component.kappaStatistics[0].variableId).toBe('CURRENT');
  });

  it('exports with the selected coder training scope', async () => {
    Object.defineProperty(window.URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn().mockReturnValue('blob:url')
    });
    Object.defineProperty(window.URL, 'revokeObjectURL', {
      configurable: true,
      value: jest.fn()
    });
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation();

    await createComponent({
      excludeTrainings: false,
      availableCoderTrainings: [trainings[0]]
    });

    component.exportKappaSummaryCsv();

    expect(testPersonCodingService.exportCohensKappaSummaryAsCsv).toHaveBeenCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      { coderTrainingIds: [7] }
    );
  });
});
