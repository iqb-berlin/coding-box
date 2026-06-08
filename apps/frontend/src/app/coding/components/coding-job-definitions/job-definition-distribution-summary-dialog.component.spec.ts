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
    expect(component.hasAddedCases()).toBe(false);
    expect(fixture.nativeElement.querySelector('.added-total-cell')).toBeFalsy();
    expect(fixture.nativeElement.textContent).toContain('Ada');
    expect(fixture.nativeElement.textContent).toContain('Unit 1 -> Var 1');
  });

  it('marks newly added refresh tasks separately from the total distribution', () => {
    createComponent({
      definitionId: 42,
      coders: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bea' }
      ],
      snapshot: {
        version: 1,
        source: 'refresh',
        createdAt: '2026-01-02T00:00:00.000Z',
        distributionSeed: 'seed-42',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        selectedVariableBundles: [],
        selectedCoders: [
          { coderId: 1, capacityPercent: 100 },
          { coderId: 2, capacityPercent: 100 }
        ],
        settings: { caseOrderingMode: 'continuous' },
        distributionByCoderId: {
          'Unit 1::Var 1': { 1: 4, 2: 3 }
        },
        doubleCodingInfo: {
          'Unit 1::Var 1': {
            totalCases: 7,
            distinctCases: 5,
            codingTasksTotal: 7,
            doubleCodedCases: 2,
            singleCodedCasesAssigned: 3,
            doubleCodedCasesPerCoderId: { 1: 2, 2: 2 }
          }
        },
        aggregationInfo: {},
        matchingFlags: [],
        pairDistribution: {},
        tasksPerCoder: { 1: 4, 2: 3 },
        coderWeights: { 1: 1, 2: 1 },
        jobs: [],
        refreshPreview: {
          jobDefinitionId: 42,
          existingJobsCount: 2,
          staleJobsCount: 1,
          existingCases: 3,
          plannedCases: 5,
          retainedCases: 3,
          addedCases: 2,
          removedCases: 0,
          addedCodingTasks: 3,
          removedCodingTasks: 0,
          canApply: true,
          itemDeltas: [{
            itemKey: 'Unit 1::Var 1',
            itemLabel: 'Unit 1::Var 1',
            existingCases: 3,
            plannedCases: 5,
            retainedCases: 3,
            addedCases: 2,
            removedCases: 0,
            existingCodingTasks: 4,
            plannedCodingTasks: 7,
            retainedCodingTasks: 4,
            addedCodingTasks: 3,
            removedCodingTasks: 0,
            codingTasksByCoderId: {
              1: {
                coderId: 1,
                existingCodingTasks: 3,
                plannedCodingTasks: 4,
                retainedCodingTasks: 3,
                addedCodingTasks: 1,
                removedCodingTasks: 0
              },
              2: {
                coderId: 2,
                existingCodingTasks: 1,
                plannedCodingTasks: 3,
                retainedCodingTasks: 1,
                addedCodingTasks: 2,
                removedCodingTasks: 0
              }
            }
          }]
        }
      }
    });

    expect(component.rows[0].addedCases).toBe(2);
    expect(component.rows[0].addedCoderTasks).toEqual({ 1: 1, 2: 2 });
    expect(component.getGrandAddedCases()).toBe(2);
    expect(component.hasAddedCases()).toBe(true);
    expect(fixture.nativeElement.querySelector('.added-total-cell')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('+1');
    expect(fixture.nativeElement.textContent).toContain('+2');
  });

  it('does not render the new-cases column for refresh deltas without added cases', () => {
    createComponent({
      definitionId: 42,
      coders: [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bea' }
      ],
      snapshot: {
        version: 1,
        source: 'refresh',
        createdAt: '2026-01-02T00:00:00.000Z',
        distributionSeed: 'seed-42',
        selectedVariables: [{ unitName: 'Unit 1', variableId: 'Var 1' }],
        selectedVariableBundles: [],
        selectedCoders: [
          { coderId: 1, capacityPercent: 100 },
          { coderId: 2, capacityPercent: 100 }
        ],
        settings: { caseOrderingMode: 'continuous' },
        distributionByCoderId: {
          'Unit 1::Var 1': { 1: 0, 2: 1 }
        },
        doubleCodingInfo: {
          'Unit 1::Var 1': {
            totalCases: 1,
            distinctCases: 1,
            codingTasksTotal: 1,
            doubleCodedCases: 0,
            singleCodedCasesAssigned: 1,
            doubleCodedCasesPerCoderId: { 1: 0, 2: 0 }
          }
        },
        aggregationInfo: {},
        matchingFlags: [],
        pairDistribution: {},
        tasksPerCoder: { 1: 0, 2: 1 },
        coderWeights: { 1: 1, 2: 1 },
        jobs: [],
        refreshPreview: {
          jobDefinitionId: 42,
          existingJobsCount: 1,
          staleJobsCount: 1,
          existingCases: 1,
          plannedCases: 1,
          retainedCases: 1,
          addedCases: 0,
          removedCases: 0,
          addedCodingTasks: 1,
          removedCodingTasks: 1,
          canApply: true,
          itemDeltas: [{
            itemKey: 'Unit 1::Var 1',
            itemLabel: 'Unit 1::Var 1',
            existingCases: 1,
            plannedCases: 1,
            retainedCases: 1,
            addedCases: 0,
            removedCases: 0,
            existingCodingTasks: 1,
            plannedCodingTasks: 1,
            retainedCodingTasks: 0,
            addedCodingTasks: 1,
            removedCodingTasks: 1,
            codingTasksByCoderId: {
              1: {
                coderId: 1,
                existingCodingTasks: 1,
                plannedCodingTasks: 0,
                retainedCodingTasks: 0,
                addedCodingTasks: 0,
                removedCodingTasks: 1
              },
              2: {
                coderId: 2,
                existingCodingTasks: 0,
                plannedCodingTasks: 1,
                retainedCodingTasks: 0,
                addedCodingTasks: 1,
                removedCodingTasks: 0
              }
            }
          }]
        }
      }
    });

    expect(component.hasAddedCases()).toBe(false);
    expect(component.rows[0].addedCoderTasks).toEqual({ 2: 1 });
    expect(fixture.nativeElement.querySelector('.added-total-cell')).toBeFalsy();
    expect(fixture.nativeElement.textContent).toContain('+1');
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
