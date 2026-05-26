import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CodingResultsComparisonComponent } from './coding-results-comparison.component';
import { SERVER_URL } from '../../../injection-tokens';
import { CodingStatisticsService } from '../../services/coding-statistics.service';
import { AppService } from '../../../core/services/app.service';
import { CoderTraining } from '../../models/coder-training.model';

describe('CodingResultsComparisonComponent', () => {
  let component: CodingResultsComparisonComponent;
  let fixture: ComponentFixture<CodingResultsComparisonComponent>;
  let codingTrainingBackendService: {
    getCoderTrainings: jest.Mock;
    compareTrainingCodingResults: jest.Mock;
    compareWithinTrainingCodingResults: jest.Mock;
    saveDiscussionResult: jest.Mock;
    getTrainingCohensKappa: jest.Mock;
  };

  beforeEach(async () => {
    codingTrainingBackendService = {
      getCoderTrainings: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
      compareTrainingCodingResults: jest.fn(),
      compareWithinTrainingCodingResults: jest.fn(),
      saveDiscussionResult: jest.fn().mockReturnValue(of({
        success: true,
        code: 7,
        score: 2,
        managerUserId: 2,
        managerName: 'Test User'
      })),
      getTrainingCohensKappa: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        CodingResultsComparisonComponent,
        MatDialogModule,
        HttpClientTestingModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: MatDialogRef,
          useValue: { close: jest.fn() }
        },
        {
          provide: MAT_DIALOG_DATA,
          useValue: { workspaceId: 1 }
        },
        {
          provide: SERVER_URL,
          useValue: 'http://localhost:3000'
        },
        {
          provide: MatSnackBar,
          useValue: { open: jest.fn() }
        },
        {
          provide: CodingTrainingBackendService,
          useValue: codingTrainingBackendService
        },
        {
          provide: CodingStatisticsService,
          useValue: {
            getReplayUrl: jest.fn()
          }
        },
        {
          provide: AppService,
          useValue: {
            authData: { userName: 'Test User' },
            loggedUser: undefined,
            createOwnToken: jest.fn()
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(CodingResultsComparisonComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should format and filter trainings with stable disambiguation data', () => {
    const training = {
      id: 33,
      workspace_id: 1,
      label: 'Duplicate Label',
      created_at: new Date('2026-05-13T11:36:00'),
      updated_at: new Date('2026-05-13T11:36:00'),
      jobsCount: 2
    } as CoderTraining;

    component.availableTrainings = [training];
    component.filteredTrainings = [training];

    expect(component.getTrainingOptionTitle(training)).toBe('Duplicate Label · ID 33');
    expect(component.getTrainingOptionMeta(training)).toContain('2 Kodierer');
    expect(component.getTrainingCoderOptionLabel({
      trainingId: 33,
      trainingLabel: 'Duplicate Label',
      coderName: 'coder1'
    })).toBe('Duplicate Label · ID 33: coder1');

    component.applyTrainingFilter({ target: { value: '33' } } as unknown as Event);

    expect(component.filteredTrainings).toEqual([training]);
  });

  it('should show discussion result as the main header and manager as subordinate info', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 1;
    component.availableCoders = [{ jobId: 1, coderName: 'Coder1' }];
    component.codersFormControl.setValue([1]);
    component.discussionManagerLabel = 'reichlej@gmx.de';
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        testperson: 'Test1',
        coders: [
          {
            jobId: 1,
            coderName: 'Coder1',
            code: 'A',
            score: null
          }
        ]
      }
    ];
    component.dataSource.data = component.withinTrainingData;

    (component as unknown as { updateDisplayedColumns: () => void }).updateDisplayedColumns();
    fixture.detectChanges();

    const discussionHeader: HTMLElement | null = fixture.nativeElement.querySelector('.mat-column-discussion');

    expect(discussionHeader?.textContent).toContain('Diskussionsergebnis');
    expect(discussionHeader?.textContent).toContain('Manager: reichlej@gmx.de');
  });

  it('should initialize discussion values from automatic agreement but not from replay code fallback', () => {
    (component as unknown as {
      initDiscussionValues: (data: Array<{
        responseId: number;
        unitName: string;
        variableId: string;
        replayCode?: number | null;
        replayScore?: number | null;
        discussionCode?: number | null;
        discussionScore?: number | null;
        discussionSource?: 'manual' | 'auto_agreement' | null;
        coders: Array<{ jobId: number; coderName: string; code: string | null; score: number | null }>;
      }>) => void;
    }).initDiscussionValues([
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        replayCode: 5,
        replayScore: 1,
        discussionCode: null,
        discussionScore: null,
        coders: []
      },
      {
        responseId: 2,
        unitName: 'Unit1',
        variableId: 'Var1',
        discussionCode: 7,
        discussionScore: 2,
        discussionSource: 'auto_agreement',
        coders: []
      }
    ]);

    expect(component.discussionCodeByResponseId[1]).toBe('');
    expect(component.discussionScoreByResponseId[1]).toBeNull();
    expect(component.discussionCodeByResponseId[2]).toBe('7');
    expect(component.discussionScoreByResponseId[2]).toBe(2);
  });

  it('should mark automatic agreement in the discussion column', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 1;
    component.availableCoders = [{ jobId: 1, coderName: 'Coder1' }];
    component.codersFormControl.setValue([1]);
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'Unit1',
        variableId: 'Var1',
        testperson: 'Test1',
        discussionCode: 7,
        discussionScore: 2,
        discussionSource: 'auto_agreement',
        coders: [
          {
            jobId: 1,
            coderName: 'Coder1',
            code: '7',
            score: 2
          }
        ]
      }
    ];
    component.dataSource.data = component.withinTrainingData;
    component.discussionCodeByResponseId[1] = '7';
    component.discussionScoreByResponseId[1] = 2;

    (component as unknown as { updateDisplayedColumns: () => void }).updateDisplayedColumns();
    fixture.detectChanges();

    const discussionSource: HTMLElement | null = fixture.nativeElement.querySelector('.discussion-source-auto');

    expect(discussionSource?.textContent).toContain('Auto-Konsens');
  });

  it('should save an active replay selection with its score as manual discussion result', () => {
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'login@code@booklet',
      discussionCode: null,
      discussionScore: null,
      discussionSource: 'auto_agreement' as 'manual' | 'auto_agreement' | null,
      coders: [
        {
          jobId: 1,
          coderName: 'Coder1',
          code: '3',
          score: 1
        }
      ]
    };
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.withinTrainingData = [row];

    (component as unknown as {
      handleReplayCodeSelected: (data: {
        type: 'replayCodeSelected';
        testPerson: string;
        unitId: string;
        variableId: string;
        code: string;
        score: number | null;
        responseId: number;
      }) => void;
    }).handleReplayCodeSelected({
      type: 'replayCodeSelected',
      testPerson: 'login@code@booklet',
      unitId: 'Unit1',
      variableId: 'Var1',
      code: '7',
      score: 2,
      responseId: 1
    });

    expect(codingTrainingBackendService.saveDiscussionResult).toHaveBeenCalledWith(1, 5, 1, 7, 2);
    expect(component.discussionCodeByResponseId[1]).toBe('7');
    expect(component.discussionScoreByResponseId[1]).toBe(2);
    expect(row.discussionCode).toBe(7);
    expect(row.discussionScore).toBe(2);
    expect(row.discussionSource).toBe('manual');
  });

  describe('calculateStatistics', () => {
    it('should calculate statistics correctly for between trainings mode', () => {
      component.comparisonMode = 'between-trainings';
      component.comparisonData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testPerson: 'Test1',
          personLogin: 'Login1',
          personCode: 'Code1',
          personGroup: 'Group1',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'A',
              score: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training 2',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'A',
              score: null
            }
          ]
        },
        {
          responseId: 2,
          unitName: 'Unit2',
          variableId: 'Var2',
          testPerson: 'Test2',
          personLogin: 'Login2',
          personCode: 'Code2',
          personGroup: 'Group2',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'B',
              score: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training 2',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'C',
              score: null
            }
          ]
        },
        {
          responseId: 3,
          unitName: 'Unit3',
          variableId: 'Var3',
          testPerson: 'Test3',
          personLogin: 'Login3',
          personCode: 'Code3',
          personGroup: 'Group3',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'D',
              score: null
            },
            {
              trainingId: 2,
              trainingLabel: 'Training 2',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'E',
              score: null
            }
          ]
        }
      ];

      component.dataSource.data = component.comparisonData;
      component.codersFromTrainingsFormControl.setValue(['1_101', '2_102']);
      component.selectedCodersFromTrainings = new Set(['1_101', '2_102']);
      component.calculateStatistics();

      expect(component.totalComparisons).toBe(3);
      expect(component.matchingComparisons).toBe(1); // First comparison matches; the other rows differ.
      expect(component.matchingPercentage).toBe(33); // 1 out of 3 = 33%
    });

    it('should treat selected but missing coder results as incomplete instead of matching', () => {
      component.comparisonMode = 'between-trainings';
      component.codersFromTrainingsFormControl.setValue(['1_101', '2_102']);
      component.comparisonData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testPerson: 'Test1',
          personLogin: 'Login1',
          personCode: 'Code1',
          personGroup: 'Group1',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'A',
              score: null
            }
          ]
        }
      ];
      component.dataSource.data = component.comparisonData;

      component.calculateStatistics();

      expect(component.getComparisonStatus(component.comparisonData[0])).toBe('incomplete');
      expect(component.areCodesTheSame(component.comparisonData[0])).toBe(false);
      expect(component.totalComparisons).toBe(0);
      expect(component.incompleteComparisons).toBe(1);

      component.tableFilters.match = 'match';
      component.applyTableFilters();

      expect(component.getFilteredRowsCount()).toBe(0);
      expect(component.hasFilterEmptyState()).toBe(true);
    });

    it('should keep a selected training without coder columns visible as incomplete', () => {
      component.comparisonMode = 'between-trainings';
      component.selectedTrainings.select(1, 2);
      component.codersFromTrainingsFormControl.setValue(['1_101', '1_102']);
      component.comparisonData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testPerson: 'Test1',
          personLogin: 'Login1',
          personCode: 'Code1',
          personGroup: 'Group1',
          coders: [
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 101,
              coderName: 'Coder 101',
              code: 'A',
              score: null
            },
            {
              trainingId: 1,
              trainingLabel: 'Training 1',
              coderId: 102,
              coderName: 'Coder 102',
              code: 'A',
              score: null
            }
          ]
        }
      ];
      component.dataSource.data = component.comparisonData;

      component.calculateStatistics();

      expect(component.getComparisonStatus(component.comparisonData[0])).toBe('incomplete');
      expect(component.totalComparisons).toBe(0);
      expect(component.incompleteComparisons).toBe(1);
    });

    it('should calculate statistics correctly for within training mode', () => {
      component.comparisonMode = 'within-training';
      component.withinTrainingData = [
        {
          responseId: 1,
          unitName: 'Unit1',
          variableId: 'Var1',
          testperson: 'Test1',
          coders: [
            {
              jobId: 1,
              coderName: 'Coder1',
              code: 'A',
              score: null
            },
            {
              jobId: 2,
              coderName: 'Coder2',
              code: 'A',
              score: null
            }
          ]
        },
        {
          responseId: 2,
          unitName: 'Unit2',
          variableId: 'Var2',
          testperson: 'Test2',
          coders: [
            {
              jobId: 1,
              coderName: 'Coder1',
              code: 'B',
              score: null
            },
            {
              jobId: 2,
              coderName: 'Coder2',
              code: 'C',
              score: null
            }
          ]
        }
      ];

      component.dataSource.data = component.withinTrainingData;
      component.codersFormControl.setValue([1, 2]);
      component.calculateStatistics();

      expect(component.totalComparisons).toBe(2);
      expect(component.matchingComparisons).toBe(1); // First matches, second differs
      expect(component.matchingPercentage).toBe(50); // 1 out of 2 = 50%
    });

    it('should handle empty data correctly', () => {
      component.comparisonMode = 'between-trainings';
      component.comparisonData = [];

      component.calculateStatistics();

      expect(component.totalComparisons).toBe(0);
      expect(component.matchingComparisons).toBe(0);
      expect(component.matchingPercentage).toBe(0);
    });
  });

  it('should restore automatic agreement immediately when clearing a manual discussion result', () => {
    codingTrainingBackendService.saveDiscussionResult.mockReturnValueOnce(of({
      success: true,
      code: null,
      score: null,
      managerUserId: null,
      managerName: null
    }));
    const row = {
      responseId: 1,
      unitName: 'Unit1',
      variableId: 'Var1',
      testperson: 'Test1',
      discussionCode: 8,
      discussionScore: 2,
      discussionSource: 'manual' as 'manual' | 'auto_agreement' | null,
      coders: [
        {
          jobId: 1,
          coderName: 'Coder1',
          code: '7',
          score: 2
        },
        {
          jobId: 2,
          coderName: 'Coder2',
          code: '7',
          score: 2
        }
      ]
    };
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.discussionCodeByResponseId[1] = '';

    component.onDiscussionCodeBlur(row);

    expect(codingTrainingBackendService.saveDiscussionResult).toHaveBeenCalledWith(1, 5, 1, null, null);
    expect(component.discussionCodeByResponseId[1]).toBe('7');
    expect(component.discussionScoreByResponseId[1]).toBe(2);
    expect(row.discussionCode).toBe(7);
    expect(row.discussionScore).toBe(2);
    expect(row.discussionSource).toBe('auto_agreement');
  });

  it('should clear stale kappa values when changing comparison mode', () => {
    component.kappaStatistics = {
      variables: [],
      workspaceSummary: {
        totalDoubleCodedResponses: 10,
        totalCoderPairs: 1,
        averageKappa: 1,
        variablesIncluded: 1,
        codersIncluded: 2,
        weightingMethod: 'weighted'
      }
    };
    component.originalKappaStatistics = component.kappaStatistics;

    component.onModeChange();

    expect(component.kappaStatistics).toBeNull();
    expect(component.originalKappaStatistics).toBeNull();
    expect(component.variableKappaSummaries).toEqual([]);
  });

  it('should render mean kappa summaries per variable', () => {
    component.comparisonMode = 'within-training';
    component.selectedTrainingForWithin = 5;
    component.showKappaStatistics = true;
    component.codersFormControl.setValue([1, 2, 3]);
    component.withinTrainingData = [
      {
        responseId: 1,
        unitName: 'U1',
        variableId: 'V1',
        testperson: 'Test1',
        coders: [
          {
            jobId: 1,
            coderName: 'C1',
            code: '1',
            score: null
          },
          {
            jobId: 2,
            coderName: 'C2',
            code: '1',
            score: null
          }
        ]
      }
    ];
    component.originalKappaStatistics = {
      variables: [
        {
          unitName: 'U1',
          variableId: 'V1',
          coderPairs: [
            {
              coder1Id: 1,
              coder1Name: 'C1',
              coder2Id: 2,
              coder2Name: 'C2',
              kappa: 0.82,
              agreement: 0.9,
              totalItems: 10,
              validPairs: 10,
              interpretation: 'kappa.good'
            },
            {
              coder1Id: 1,
              coder1Name: 'C1',
              coder2Id: 3,
              coder2Name: 'C3',
              kappa: 0.88,
              agreement: 0.8,
              totalItems: 5,
              validPairs: 5,
              interpretation: 'kappa.good'
            }
          ]
        }
      ],
      workspaceSummary: {
        totalDoubleCodedResponses: 1,
        totalCoderPairs: 2,
        averageKappa: 0.85,
        variablesIncluded: 1,
        codersIncluded: 3,
        weightingMethod: 'unweighted'
      }
    };

    component.filterKappaStatistics();
    fixture.detectChanges();

    const summaryTable: HTMLElement | null = fixture.nativeElement.querySelector('.variable-mean-table');
    const tableText = summaryTable?.textContent?.replace(/\s+/g, ' ');

    expect(component.variableKappaSummaries).toHaveLength(1);
    expect(component.variableKappaSummaries[0]).toMatchObject({
      key: 'U1::V1',
      unitName: 'U1',
      variableId: 'V1',
      meanKappa: 0.85,
      caseCount: 1,
      validPairCount: 15
    });
    expect(component.variableKappaSummaries[0].meanAgreement).toBeCloseTo(0.85, 10);
    expect(tableText).toContain('Mittelwerte je Variable');
    expect(tableText).toContain('Gültige Paarwerte');
    expect(tableText).toContain('U1 - V1');
    expect(tableText).toContain('0.850');
    expect(tableText).toContain('85.0%');
    expect(tableText).toContain('15');
  });

  describe('calculateMeanAgreement', () => {
    it('should calculate weighted mean agreement correctly', () => {
      component.kappaStatistics = {
        variables: [
          {
            unitName: 'U1',
            variableId: 'V1',
            coderPairs: [
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 2,
                coder2Name: 'C2',
                kappa: 0.5,
                agreement: 0.8,
                totalItems: 10,
                validPairs: 10,
                interpretation: 'mod'
              },
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 3,
                coder2Name: 'C3',
                kappa: 0.6,
                agreement: 0.9,
                totalItems: 10,
                validPairs: 5,
                interpretation: 'good'
              }
            ]
          }
        ],
        workspaceSummary: {
          totalDoubleCodedResponses: 0,
          totalCoderPairs: 0,
          averageKappa: 0,
          variablesIncluded: 0,
          codersIncluded: 0,
          weightingMethod: 'weighted'
        }
      };
      component.useWeightedMean = true;
      component.calculateMeanAgreement();

      // Weighted mean: (0.8 * 10 + 0.9 * 5) / (10 + 5) = (8 + 4.5) / 15 = 12.5 / 15 = 0.8333...
      expect(component.kappaStatistics?.workspaceSummary.meanAgreement).toBeCloseTo(0.8333, 4);
    });

    it('should calculate unweighted mean agreement correctly', () => {
      component.kappaStatistics = {
        variables: [
          {
            unitName: 'U1',
            variableId: 'V1',
            coderPairs: [
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 2,
                coder2Name: 'C2',
                kappa: 0.5,
                agreement: 0.8,
                totalItems: 10,
                validPairs: 10,
                interpretation: 'mod'
              },
              {
                coder1Id: 1,
                coder1Name: 'C1',
                coder2Id: 3,
                coder2Name: 'C3',
                kappa: 0.6,
                agreement: 0.9,
                totalItems: 10,
                validPairs: 5,
                interpretation: 'good'
              }
            ]
          }
        ],
        workspaceSummary: {
          totalDoubleCodedResponses: 0,
          totalCoderPairs: 0,
          averageKappa: 0,
          variablesIncluded: 0,
          codersIncluded: 0,
          weightingMethod: 'unweighted'
        }
      };
      component.useWeightedMean = false;
      component.calculateMeanAgreement();

      // Unweighted mean: (0.8 + 0.9) / 2 = 0.85
      expect(component.kappaStatistics?.workspaceSummary.meanAgreement).toBeCloseTo(0.85, 4);
    });
  });
});
