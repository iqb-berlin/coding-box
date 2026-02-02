import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CodingTrainingBackendService } from '../../services/coding-training-backend.service';
import { CodingResultsComparisonComponent } from './coding-results-comparison.component';
import { SERVER_URL } from '../../../injection-tokens';

describe('CodingResultsComparisonComponent', () => {
  let component: CodingResultsComparisonComponent;
  let fixture: ComponentFixture<CodingResultsComparisonComponent>;

  beforeEach(async () => {
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
          useValue: {
            getCoderTrainings: jest.fn().mockReturnValue({ subscribe: jest.fn() }),
            compareTrainingCodingResults: jest.fn(),
            compareWithinTrainingCodingResults: jest.fn(),
            getTrainingCohensKappa: jest.fn()
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

  describe('calculateStatistics', () => {
    it('should calculate statistics correctly for between trainings mode', () => {
      component.comparisonMode = 'between-trainings';
      component.comparisonData = [
        {
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
      component.selectedCodersFromTrainings = new Set(['1_101', '2_102']);
      component.calculateStatistics();

      expect(component.totalComparisons).toBe(3);
      expect(component.matchingComparisons).toBe(1); // First comparison matches (both 'A'), second differs ('B' vs 'C'), third has only one code so considered matching
      expect(component.matchingPercentage).toBe(33); // 1 out of 3 = 33%
    });

    it('should calculate statistics correctly for within training mode', () => {
      component.comparisonMode = 'within-training';
      component.withinTrainingData = [
        {
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
