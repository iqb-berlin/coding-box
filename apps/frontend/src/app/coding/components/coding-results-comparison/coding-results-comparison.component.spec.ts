import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

import { HttpClientTestingModule } from '@angular/common/http/testing';
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
        HttpClientTestingModule
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
          testperson: 'Test1',
          trainings: [
            {
              trainingId: 1, trainingLabel: 'Training 1', code: 'A', score: null
            },
            {
              trainingId: 2, trainingLabel: 'Training 2', code: 'A', score: null
            }
          ]
        },
        {
          unitName: 'Unit2',
          variableId: 'Var2',
          testperson: 'Test2',
          trainings: [
            {
              trainingId: 1, trainingLabel: 'Training 1', code: 'B', score: null
            },
            {
              trainingId: 2, trainingLabel: 'Training 2', code: 'C', score: null
            }
          ]
        },
        {
          unitName: 'Unit3',
          variableId: 'Var3',
          testperson: 'Test3',
          trainings: [
            {
              trainingId: 1, trainingLabel: 'Training 1', code: 'D', score: null
            },
            {
              trainingId: 2, trainingLabel: 'Training 2', code: null, score: null
            }
          ]
        }
      ];

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
              jobId: 1, coderName: 'Coder1', code: 'A', score: null
            },
            {
              jobId: 2, coderName: 'Coder2', code: 'A', score: null
            }
          ]
        },
        {
          unitName: 'Unit2',
          variableId: 'Var2',
          testperson: 'Test2',
          coders: [
            {
              jobId: 1, coderName: 'Coder1', code: 'B', score: null
            },
            {
              jobId: 2, coderName: 'Coder2', code: 'C', score: null
            }
          ]
        }
      ];

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
});
