import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
  JobDefinitionDistributionSummaryDialogComponent,
  JobDefinitionDistributionSummaryDialogData
} from './job-definition-distribution-summary-dialog.component';

describe('JobDefinitionDistributionSummaryDialogComponent', () => {
  let fixture: ComponentFixture<JobDefinitionDistributionSummaryDialogComponent>;
  let component: JobDefinitionDistributionSummaryDialogComponent;

  const createComponent = (data: JobDefinitionDistributionSummaryDialogData): void => {
    TestBed.overrideProvider(MAT_DIALOG_DATA, { useValue: data });
    fixture = TestBed.createComponent(JobDefinitionDistributionSummaryDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        JobDefinitionDistributionSummaryDialogComponent,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: MAT_DIALOG_DATA, useValue: { definitionId: 1, coders: [] } }
      ]
    }).compileComponents();
  });

  it('renders a stored distribution snapshot with coder totals', () => {
    createComponent({
      definitionId: 42,
      coders: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bea' }
      ],
      snapshot: {
        version: 1,
        source: 'initial_creation',
        createdAt: '2026-01-01T00:00:00.000Z',
        distributionSeed: 'seed-42',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        selectedVariableBundles: [],
        selectedCoders: [
          { coderId: 1, capacityPercent: 100 },
          { coderId: 2, capacityPercent: 100 }
        ],
        settings: { caseOrderingMode: 'continuous' },
        distributionByCoderId: {
          'Unit 1::Var 1': { 1: 3, 2: 2 }
        },
        doubleCodingInfo: {
          'Unit 1::Var 1': {
            totalCases: 5,
            distinctCases: 4,
            codingTasksTotal: 5,
            doubleCodedCases: 1,
            singleCodedCasesAssigned: 3,
            doubleCodedCasesPerCoderId: { 1: 1, 2: 1 }
          }
        },
        aggregationInfo: {},
        matchingFlags: [],
        pairDistribution: {},
        tasksPerCoder: { 1: 3, 2: 2 },
        coderWeights: { 1: 1, 2: 1 },
        jobs: []
      }
    });

    expect(component.rows).toHaveLength(1);
    expect(component.getCoderTotal(1)).toBe(3);
    expect(component.getCoderTotal(2)).toBe(2);
    expect(component.getGrandTotal()).toBe(5);
    expect(fixture.nativeElement.textContent).toContain('Ada');
    expect(fixture.nativeElement.textContent).toContain('Unit 1 -> Var 1');
  });

  it('renders a missing-history message when no snapshot exists', () => {
    createComponent({
      definitionId: 43,
      coders: [],
      createdJobsCount: 1
    });

    expect(component.rows).toEqual([]);
    expect(fixture.nativeElement.querySelector('.missing-history')).toBeTruthy();
  });
});
