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

  function createKappaResponseWithCoderPairs(): CohensKappaStatisticsResponse {
    return {
      ...kappaResponse,
      variables: [
        {
          ...kappaResponse.variables[0],
          coderPairs: [
            {
              coder1Id: 1,
              coder1Name: 'Coder 1',
              coder2Id: 2,
              coder2Name: 'Coder 2',
              kappa: 1,
              agreement: 1,
              totalItems: 2,
              validPairs: 2,
              interpretation: 'kappa.almost_perfect'
            },
            {
              coder1Id: 1,
              coder1Name: 'Coder 1',
              coder2Id: 3,
              coder2Name: 'Coder 3',
              kappa: 0.5,
              agreement: 0.75,
              totalItems: 2,
              validPairs: 2,
              interpretation: 'kappa.moderate'
            }
          ]
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

  async function createComponent(
    dialogData: CohensKappaStatisticsDialogData,
    response: CohensKappaStatisticsResponse = kappaResponse
  ): Promise<void> {
    testPersonCodingService = {
      getCohensKappaStatistics: jest.fn().mockReturnValue(of(response)),
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
      { coderTrainingIds: [7] },
      'code'
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
      { coderTrainingIds: [9] },
      'code'
    );
  });

  it('reloads kappa statistics with selected coders and keeps coders selectable', async () => {
    await createComponent(
      {
        excludeTrainings: false,
        availableCoderTrainings: [trainings[0]]
      },
      createKappaResponseWithCoderPairs()
    );

    expect(component.availableCoders).toEqual([
      { id: 1, name: 'Coder 1' },
      { id: 2, name: 'Coder 2' },
      { id: 3, name: 'Coder 3' }
    ]);
    expect(component.selectedCoderIds).toEqual([1, 2, 3]);

    component.selectedCoderIds = [1, 2];
    component.onCoderSelectionChange();

    expect(testPersonCodingService.getCohensKappaStatistics).toHaveBeenLastCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      { coderTrainingIds: [7], coderIds: [1, 2] },
      'code'
    );
    expect(component.availableCoders).toHaveLength(3);
    expect(component.selectedCoderIds).toEqual([1, 2]);
  });

  it('keeps coder controls visible after clearing the coder selection', async () => {
    await createComponent(
      {
        excludeTrainings: false,
        availableCoderTrainings: [trainings[0]]
      },
      createKappaResponseWithCoderPairs()
    );

    component.clearCoderSelection();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(component.workspaceKappaSummary).toBeNull();
    expect(component.canLoadKappaStatistics).toBe(false);
    expect(element.querySelector('.workspace-kappa-card')).not.toBeNull();
    expect(element.querySelector('.coder-selection')).not.toBeNull();
  });

  it('reloads kappa statistics on score level', async () => {
    await createComponent({
      excludeTrainings: false,
      availableCoderTrainings: [trainings[0]]
    });

    component.useCodeLevel = false;
    component.toggleCalculationLevel();

    expect(testPersonCodingService.getCohensKappaStatistics).toHaveBeenLastCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      { coderTrainingIds: [7] },
      'score'
    );
  });

  it('resets selected coder filters when changing the calculation level', async () => {
    await createComponent(
      {
        excludeTrainings: false,
        availableCoderTrainings: [trainings[0]]
      },
      createKappaResponseWithCoderPairs()
    );
    component.selectedCoderIds = [1, 2];

    component.useCodeLevel = false;
    component.toggleCalculationLevel();

    expect(testPersonCodingService.getCohensKappaStatistics).toHaveBeenLastCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      { coderTrainingIds: [7] },
      'score'
    );
  });

  it('resets selected coder filters when changing the training exclusion scope', async () => {
    await createComponent(
      {
        excludeTrainings: true
      },
      createKappaResponseWithCoderPairs()
    );
    component.selectedCoderIds = [1, 2];

    component.excludeTrainings = false;
    component.toggleExcludeTrainings();

    expect(testPersonCodingService.getCohensKappaStatistics).toHaveBeenLastCalledWith(
      1,
      true,
      false,
      undefined,
      undefined,
      {},
      'code'
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
      { coderTrainingIds: [7] },
      'code'
    );
  });
});
