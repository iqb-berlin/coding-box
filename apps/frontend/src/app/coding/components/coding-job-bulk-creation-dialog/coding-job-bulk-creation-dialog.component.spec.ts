import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
  BulkCreationData,
  CodingJobBulkCreationDialogComponent
} from './coding-job-bulk-creation-dialog.component';
import { DistributedCodingService } from '../../services/distributed-coding.service';
import { AppService } from '../../../core/services/app.service';

describe('CodingJobBulkCreationDialogComponent', () => {
  let fixture: ComponentFixture<CodingJobBulkCreationDialogComponent>;
  let component: CodingJobBulkCreationDialogComponent;
  let mockDialogRef: Partial<MatDialogRef<CodingJobBulkCreationDialogComponent>>;
  let mockDistributedCodingService: Partial<DistributedCodingService>;

  const selectedVariable = { unitName: 'Unit 1', variableId: 'Var 1', responseCount: 4 };
  const selectedCoders = [
    { id: 1, name: 'Ada' },
    { id: 2, name: 'Bea' }
  ];

  const createComponent = (data: BulkCreationData): void => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(CodingJobBulkCreationDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    mockDialogRef = {
      close: jest.fn()
    };
    mockDistributedCodingService = {
      calculateDistribution: jest.fn().mockReturnValue(of({
        distribution: {},
        distributionByCoderId: {},
        doubleCodingInfo: {},
        aggregationInfo: {},
        matchingFlags: [],
        warnings: []
      }))
    } as Partial<DistributedCodingService>;

    await TestBed.configureTestingModule({
      imports: [
        CodingJobBulkCreationDialogComponent,
        TranslateModule.forRoot(),
        NoopAnimationsModule
      ],
      providers: [
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        { provide: DistributedCodingService, useValue: mockDistributedCodingService },
        { provide: AppService, useValue: { selectedWorkspaceId: 1 } },
        { provide: MatSnackBar, useValue: { open: jest.fn() } }
      ]
    }).compileComponents();
  });

  it('shows only preview jobs that will receive at least one case', () => {
    createComponent({
      selectedVariables: [selectedVariable],
      selectedVariableBundles: [],
      selectedCoders,
      distribution: {
        'Unit 1::Var 1': { Ada: 4, Bea: 0 }
      },
      distributionByCoderId: {
        'Unit 1::Var 1': { 1: 4, 2: 0 }
      },
      doubleCodingInfo: {
        'Unit 1::Var 1': {
          totalCases: 4,
          distinctCases: 4,
          codingTasksTotal: 4,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 4,
          doubleCodedCasesPerCoder: { Ada: 0, Bea: 0 }
        }
      }
    });

    expect(component.jobPreviews).toHaveLength(1);
    expect(component.jobPreviews[0]).toMatchObject({
      name: 'Job Unit 1 - Var 1 (Ada)',
      caseCount: 4,
      coderName: 'Ada'
    });
  });

  it('uses warnings supplied with a precomputed backend preview', () => {
    createComponent({
      selectedVariables: [selectedVariable],
      selectedVariableBundles: [],
      selectedCoders,
      distribution: {
        'Unit 1::Var 1': { Ada: 4, Bea: 0 }
      },
      distributionByCoderId: {
        'Unit 1::Var 1': { 1: 4, 2: 0 }
      },
      doubleCodingInfo: {
        'Unit 1::Var 1': {
          totalCases: 4,
          distinctCases: 4,
          codingTasksTotal: 4,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 4,
          doubleCodedCasesPerCoder: { Ada: 0, Bea: 0 }
        }
      },
      warnings: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        message: 'Already assigned',
        casesInJobs: 1,
        availableCases: 4
      }]
    });

    expect(component.warnings).toEqual([expect.objectContaining({
      unitName: 'Unit 1',
      variableId: 'Var 1'
    })]);
    expect(component.showWarningsPanel).toBe(true);
    expect(mockDistributedCodingService.calculateDistribution).not.toHaveBeenCalled();
  });

  it('preserves warnings returned by backend distribution calculation', async () => {
    (mockDistributedCodingService.calculateDistribution as jest.Mock).mockReturnValue(of({
      distribution: {
        'Unit 1::Var 1': { Ada: 4, Bea: 0 }
      },
      distributionByCoderId: {
        'Unit 1::Var 1': { 1: 4, 2: 0 }
      },
      doubleCodingInfo: {
        'Unit 1::Var 1': {
          totalCases: 4,
          distinctCases: 4,
          codingTasksTotal: 4,
          doubleCodedCases: 0,
          singleCodedCasesAssigned: 4,
          doubleCodedCasesPerCoder: { Ada: 0, Bea: 0 }
        }
      },
      aggregationInfo: {},
      matchingFlags: [],
      warnings: [{
        unitName: 'Unit 1',
        variableId: 'Var 1',
        message: 'Already assigned',
        casesInJobs: 1,
        availableCases: 4
      }]
    }));

    createComponent({
      selectedVariables: [selectedVariable],
      selectedVariableBundles: [],
      selectedCoders
    });
    await fixture.whenStable();

    expect(component.warnings).toEqual([expect.objectContaining({
      unitName: 'Unit 1',
      variableId: 'Var 1'
    })]);
    expect(component.showWarningsPanel).toBe(true);
    expect(component.jobPreviews).toHaveLength(1);
  });

  it('uses backend-created job names and counts in the results view', () => {
    createComponent({
      selectedVariables: [selectedVariable],
      selectedVariableBundles: [],
      selectedCoders,
      creationResults: {
        doubleCodingInfo: {
          'Unit 1::Var 1': {
            totalCases: 3,
            distinctCases: 3,
            codingTasksTotal: 3,
            doubleCodedCases: 0,
            singleCodedCasesAssigned: 3,
            doubleCodedCasesPerCoder: { Ada: 0, Bea: 0 }
          }
        },
        distributionByCoderId: {
          'Unit 1::Var 1': { 1: 3, 2: 0 }
        },
        jobs: [
          {
            itemKey: 'Unit 1::Var 1',
            coderId: 1,
            coderName: 'Ada',
            variable: { unitName: 'Unit 1', variableId: 'Var 1' },
            jobId: 10,
            jobName: 'Job Unit 1 - Var 1 (Ada)',
            caseCount: 3
          },
          {
            itemKey: 'Unit 1::Var 1',
            coderId: 2,
            coderName: 'Bea',
            variable: { unitName: 'Unit 1', variableId: 'Var 1' },
            jobId: 11,
            jobName: 'Job Unit 1 - Var 1 (Bea)',
            caseCount: 0
          }
        ]
      }
    });

    expect(component.jobPreviews).toEqual([
      expect.objectContaining({
        name: 'Job Unit 1 - Var 1 (Ada)',
        caseCount: 3,
        coderName: 'Ada',
        jobId: 10
      })
    ]);
  });
});
