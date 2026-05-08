import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestResultsUploadResultDialogComponent, TestResultsUploadResultDialogData } from './test-results-upload-result-dialog.component';

describe('TestResultsUploadResultDialogComponent', () => {
  let fixture: ComponentFixture<TestResultsUploadResultDialogComponent>;
  let component: TestResultsUploadResultDialogComponent;
  let dialogRef: { close: jest.Mock };

  const data: TestResultsUploadResultDialogData = {
    resultType: 'responses',
    result: {
      expected: {
        testPersons: 1,
        testGroups: 1,
        uniqueBooklets: 1,
        uniqueUnits: 1,
        uniqueResponses: 3
      },
      before: {
        testPersons: 1,
        testGroups: 1,
        uniqueBooklets: 1,
        uniqueUnits: 1,
        uniqueResponses: 1
      },
      after: {
        testPersons: 2,
        testGroups: 1,
        uniqueBooklets: 2,
        uniqueUnits: 2,
        uniqueResponses: 4
      },
      delta: {
        testPersons: 1,
        testGroups: 0,
        uniqueBooklets: 1,
        uniqueUnits: 1,
        uniqueResponses: 3
      },
      responseStatusCounts: { COMPLETE: 2, OPEN: 1 },
      issues: [
        {
          level: 'warning', category: 'unit_not_found', message: 'Unit missing', fileName: 'a.csv', rowIndex: 2
        },
        {
          level: 'error', category: 'other', message: 'Other problem', fileName: 'b.csv'
        }
      ],
      logMetrics: {
        bookletDetails: [{ name: 'B2', hasLog: false }, { name: 'B1', hasLog: true }],
        unitDetails: [
          { bookletName: 'B1', unitKey: 'U2', hasLog: false },
          { bookletName: 'B1', unitKey: 'U1', hasLog: true }
        ]
      }
    } as never
  };

  beforeEach(async () => {
    dialogRef = { close: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [TestResultsUploadResultDialogComponent, NoopAnimationsModule],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(TestResultsUploadResultDialogComponent);
    component = fixture.componentInstance;
  });

  it('filters and formats upload result details', () => {
    expect(component.result).toBe(data.result);
    expect(component.issues).toHaveLength(2);
    expect(component.statusCounts).toEqual([
      { status: 'COMPLETE', count: 2 },
      { status: 'OPEN', count: 1 }
    ]);
    expect(component.getCategoryLabel('unit_not_found')).toBe('Unit nicht gefunden');
    expect(component.getCategoryLabel('custom')).toBe('custom');

    component.selectedCategory = 'unit_not_found';
    expect(component.filteredIssues).toHaveLength(1);
    component.filterText = 'missing';
    expect(component.filteredIssues).toHaveLength(1);
    component.filterText = 'nomatch';
    expect(component.filteredIssues).toHaveLength(0);

    component.detailFilterText = 'b1';
    expect(component.filteredBookletDetails).toEqual([{ name: 'B1', hasLog: true }]);
    expect(component.filteredUnitDetails.map(u => u.unitKey)).toEqual(['U1', 'U2']);
    expect(component.trackByIssue(0, data.result.issues![0])).toContain('Unit missing');
    expect(component.trackByBookletDetail(0, component.bookletDetails[0])).toBe('B2-false');
    expect(component.trackByUnitDetail(0, component.unitDetails[0])).toBe('B1-U2-false');
    component.onCategoryChange();
    component.close();
    expect(dialogRef.close).toHaveBeenCalled();
  });
});
