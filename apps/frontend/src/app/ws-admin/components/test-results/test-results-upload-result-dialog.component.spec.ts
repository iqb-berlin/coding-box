import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  TestResultsUploadResultDialogComponent,
  TestResultsUploadResultDialogData
} from './test-results-upload-result-dialog.component';

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
      importSummary: {
        totalRows: 4,
        responseRows: 4,
        issueCounts: {
          unit_not_found: 1,
          other: 1
        }
      },
      codingFreshness: {
        workspaceId: 1,
        currentRevision: 2,
        items: [
          {
            version: 'v1',
            state: 'PENDING',
            unitCount: 1,
            affectedResponseCount: 3
          },
          {
            version: 'v3',
            state: 'PENDING',
            unitCount: 1,
            affectedResponseCount: 3
          }
        ]
      },
      logMetrics: {
        bookletsWithLogs: 1,
        totalBooklets: 2,
        unitsWithLogs: 1,
        totalUnits: 2,
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
    expect(component.getCategoryLabel('csv_columns')).toBe('CSV-Spalten fehlen');
    expect(component.getCategoryLabel('no_logs_saved')).toBe('Keine Logs gespeichert');
    expect(component.getCategoryLabel('custom')).toBe('custom');
    expect(component.emptyIssuesMessage).toBe('Keine technischen Importprobleme gefunden.');
    expect(component.issueSummaryEntries).toEqual([
      { category: 'other', label: 'Sonstiges', count: 1 },
      { category: 'unit_not_found', label: 'Unit nicht gefunden', count: 1 }
    ]);
    expect(component.codingFreshnessDialogTitle).toBe('Auto-Coding aktualisieren');
    expect(component.codingFreshnessSummaryText).toBe(
      'Je betroffenem Auto-Coding-Lauf sind 3 Antwortwerte in 1 Aufgabenbearbeitung zu bearbeiten. ' +
      'Auto-Coding 1 und Auto-Coding 2 müssen ausgeführt werden.'
    );
    expect(component.getCodingFreshnessChipLabel(data.result.codingFreshness!.items[0])).toBe(
      'Auto-Coding 1: 1 Aufgabenbearbeitung kodieren'
    );
    expect(component.filteredIssues).toBe(component.filteredIssues);
    expect(component.issueExportButtonLabel).toBe('Probleme exportieren (2)');
    expect(component.buildIssueExportCsv()).toContain(
      '"Nr.";"Importart";"Typ";"Kategorie";"Kategorie (Text)";"Meldung";"Datei";"Zeile"\n' +
      '"1";"Antworten";"warning";"unit_not_found";"Unit nicht gefunden";"Unit missing";"a.csv";"2"'
    );

    component.selectedCategory = 'unit_not_found';
    expect(component.filteredIssues).toHaveLength(1);
    expect(component.issueExportButtonLabel).toBe('Gefilterte exportieren (1)');
    expect(component.emptyIssuesMessage).toBe('Keine passenden technischen Importprobleme gefunden.');
    expect(component.buildIssueExportCsv()).not.toContain('"Other problem"');
    component.filterText = 'missing';
    expect(component.filteredIssues).toHaveLength(1);
    component.filterText = 'nomatch';
    expect(component.filteredIssues).toHaveLength(0);

    expect(component.hasAnyLogDetails).toBe(true);
    expect(component.detailTabLabel).toBe('Details (2)');
    expect(component.emptyDetailMessage).toBe('Keine Booklets gefunden.');
    component.detailStatusFilter = 'withLogs';
    expect(component.filteredBookletDetails).toEqual([{ name: 'B1', hasLog: true }]);
    component.detailStatusFilter = 'withoutLogs';
    expect(component.filteredBookletDetails).toEqual([{ name: 'B2', hasLog: false }]);
    component.detailStatusFilter = 'all';

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

  it('ignores zero-count coding freshness rows', () => {
    component.data = {
      resultType: 'responses',
      result: {
        ...data.result,
        codingFreshness: {
          workspaceId: 1,
          currentRevision: 2,
          items: [
            {
              version: 'v1',
              state: 'PENDING',
              unitCount: 0,
              affectedResponseCount: 0
            }
          ]
        }
      } as never
    };

    expect(component.codingFreshnessWarnings).toEqual([]);
    expect(component.hasCodingFreshnessWarning).toBe(false);
    expect(component.codingFreshnessDialogTitle).toBe('Kodierstand aktuell');
  });
});
