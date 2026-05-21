import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
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
    manualAppliedResultsOverview: {
      totalIncompleteResponses: 10,
      appliedResponses: 7,
      remainingResponses: 3,
      completionPercentage: 70
    },
    manualAppliedResultsOverviewLoadFailed: false,
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
      imports: [
        TestResultsUploadResultDialogComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data }
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      'coding-management': {
        readiness: {
          'title-manual-coding-open': 'Manuelle Kodierung abschließen',
          'second-autocoding-waits-summary': 'Auto-Coding 2 ist der nächste Schritt, sobald die manuelle Kodierung abgeschlossen ist. Schließen Sie zuerst die offenen manuellen Kodierfälle ab und übernehmen Sie die Ergebnisse.{{remaining}}',
          'second-autocoding-waits-remaining': ' Es sind noch {{count}} manuelle Kodierergebnisse offen.',
          'manual-results-overview-load-failed': 'Der Stand der manuellen Kodierung konnte nicht geprüft werden. Auto-Coding 2 bleibt gesperrt, bis die Prüfung erfolgreich aktualisiert wurde.',
          'second-autocoding-waits-help': 'Der Start von Auto-Coding 2 bleibt bis dahin gesperrt. {{taskResultHelp}}',
          'second-autocoding-waits-chip': '{{version}}: {{count}} wartet'
        }
      }
    });
    translateService.use('de');

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
      'Auto-Coding 1 muss für 1 Aufgabenbearbeitung ausgeführt werden. ' +
      'Das betrifft 3 Antwortwerte.'
    );
    expect(component.codingFreshnessWarnings).toEqual([
      expect.objectContaining({ version: 'v1' })
    ]);
    expect(component.codingFreshnessDisplayWarnings).toEqual(component.codingFreshnessWarnings);
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
      manualAppliedResultsOverview: data.manualAppliedResultsOverview,
      manualAppliedResultsOverviewLoadFailed: data.manualAppliedResultsOverviewLoadFailed,
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

  it('shows second auto-coding as waiting when manual coding is still open', () => {
    component.data = {
      resultType: 'responses',
      manualAppliedResultsOverview: {
        totalIncompleteResponses: 671,
        appliedResponses: 210,
        remainingResponses: 461,
        completionPercentage: 31
      },
      manualAppliedResultsOverviewLoadFailed: false,
      result: {
        ...data.result,
        codingFreshness: {
          workspaceId: 1,
          currentRevision: 2,
          items: [
            {
              version: 'v3',
              state: 'PENDING',
              unitCount: 671,
              affectedResponseCount: 5098
            }
          ]
        }
      } as never
    };

    expect(component.hasCodingFreshnessWarning).toBe(true);
    expect(component.codingFreshnessWarnings).toEqual([]);
    expect(component.codingFreshnessDisplayWarnings).toHaveLength(1);
    expect(component.codingFreshnessDialogTitle).toBe('Manuelle Kodierung abschließen');
    expect(component.codingFreshnessSummaryText).toContain('Auto-Coding 2 ist der nächste Schritt');
    expect(component.codingFreshnessSummaryText).toContain('461 manuelle Kodierergebnisse offen');
    expect(component.getCodingFreshnessChipLabel(component.codingFreshnessDisplayWarnings[0])).toBe(
      'Auto-Coding 2: 671 Aufgabenbearbeitungen wartet'
    );
  });

  it('shows second auto-coding as actionable once manual coding is complete', () => {
    component.data = {
      resultType: 'responses',
      manualAppliedResultsOverview: {
        totalIncompleteResponses: 671,
        appliedResponses: 671,
        remainingResponses: 0,
        completionPercentage: 100
      },
      manualAppliedResultsOverviewLoadFailed: false,
      result: {
        ...data.result,
        codingFreshness: {
          workspaceId: 1,
          currentRevision: 2,
          items: [
            {
              version: 'v3',
              state: 'PENDING',
              unitCount: 671,
              affectedResponseCount: 5098
            }
          ]
        }
      } as never
    };

    expect(component.codingFreshnessWarnings).toHaveLength(1);
    expect(component.codingFreshnessDialogTitle).toBe('Auto-Coding aktualisieren');
    expect(component.codingFreshnessSummaryText).toBe(
      'Auto-Coding 2 muss für 671 Aufgabenbearbeitungen ausgeführt werden. ' +
      'Das betrifft 5098 Antwortwerte.'
    );
  });
});
