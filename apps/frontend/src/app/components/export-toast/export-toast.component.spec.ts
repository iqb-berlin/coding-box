import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  BehaviorSubject, Subject, of, throwError
} from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ExportToastComponent } from './export-toast.component';
import {
  ExportJob,
  ExportJobService
} from '../../shared/services/file/export-job.service';
import { AppService } from '../../core/services/app.service';

describe('ExportToastComponent', () => {
  let fixture: ComponentFixture<ExportToastComponent>;
  let component: ExportToastComponent;
  let jobs$: BehaviorSubject<ExportJob[]>;
  let exportJobService: {
    jobs$: BehaviorSubject<ExportJob[]>;
    downloadFile: jest.Mock;
    removeJob: jest.Mock;
    cancelJob: jest.Mock;
    getItemMatrixDiagnostics: jest.Mock;
    downloadIncompleteItemMatrix: jest.Mock;
    restoreWorkspaceJobs: jest.Mock;
  };
  let selectedWorkspaceId$: Subject<number>;
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };

  const jobs = [
    {
      jobId: 'waiting',
      workspaceId: 1,
      exportType: 'aggregated',
      displayLabelKey: 'export-toast.types.manual-review-most-frequent',
      downloadFilePrefix: 'manual-review-most-frequent',
      status: 'waiting',
      result: { fileName: 'export.csv', fileSize: 100 }
    },
    {
      jobId: 'active',
      workspaceId: 1,
      exportType: 'by-coder',
      status: 'active'
    },
    {
      jobId: 'done',
      workspaceId: 1,
      exportType: 'detailed',
      status: 'completed'
    },
    {
      jobId: 'bad',
      workspaceId: 1,
      exportType: 'custom',
      status: 'failed'
    },
    {
      jobId: 'cancelled',
      workspaceId: 1,
      exportType: 'coding-times',
      status: 'cancelled'
    },
    {
      jobId: 'unavailable',
      workspaceId: 1,
      exportType: 'psychometrics',
      status: 'unavailable',
      error: 'Failed to get job status'
    }
  ] as ExportJob[];

  beforeEach(async () => {
    jobs$ = new BehaviorSubject<ExportJob[]>(jobs);
    selectedWorkspaceId$ = new Subject<number>();
    exportJobService = {
      jobs$,
      downloadFile: jest.fn(),
      removeJob: jest.fn().mockReturnValue(of(true)),
      cancelJob: jest.fn(),
      getItemMatrixDiagnostics: jest.fn(),
      downloadIncompleteItemMatrix: jest.fn().mockReturnValue(of(undefined)),
      restoreWorkspaceJobs: jest.fn().mockReturnValue(of([]))
    };
    dialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(true) })
    };
    snackBar = { open: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [ExportToastComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ExportJobService, useValue: exportJobService },
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 5,
            selectedWorkspaceId$: selectedWorkspaceId$
          }
        },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar }
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      'export-toast': {
        types: {
          aggregated: 'Aggregierte Ansicht',
          'by-coder': 'Nach Kodierer',
          'by-variable': 'Nach Variable',
          'by-variable-compact': 'Nach Variable, kompakt',
          detailed: 'Detailliertes Kodierprotokoll',
          'coding-times': 'Kodierzeiten-Bericht',
          'manual-review-most-frequent': 'Kodierer: häufigster Code',
          'results-by-version': 'Finale Ergebnisdaten',
          'item-matrix': 'Itemdatensatz'
        },
        errors: {
          'too-many-worksheets-title': 'Export zu groß',
          'too-many-worksheets-message':
            'Dieser Export würde {{actual}} Tabellenblätter erzeugen. Erlaubt sind aktuell {{max}}.',
          'item-matrix-incomplete-title':
            'Itemdatensatz nicht vollständig exportierbar',
          'item-matrix-incomplete-message':
            '{{total}} Zellen konnten nicht sicher aufgelöst werden.',
          'item-matrix-incomplete-expired':
            '{{total}} Zellen konnten nicht sicher aufgelöst werden; abgelaufen.',
          'item-matrix-incomplete-download-failed': 'Download fehlgeschlagen',
          'status-unavailable-title': 'Exportstatus nicht verfügbar',
          'status-unavailable-message':
            'Der aktuelle Zustand des Exports konnte nicht ermittelt werden.',
          'remove-failed': 'Löschen fehlgeschlagen',
          'generic-title': 'Export fehlgeschlagen'
        },
        'item-matrix-actions': {
          'show-diagnostics': 'Diagnose anzeigen',
          'download-incomplete': 'Unvollständigen Export herunterladen'
        },
        'incomplete-confirm': {
          title: 'Bestätigen',
          content: '{{total}} Fehler',
          confirm: 'Herunterladen',
          cancel: 'Abbrechen'
        },
        progress: {
          waiting: 'Wartet auf den Export-Worker',
          active: 'Export wird verarbeitet',
          preparing: 'Export wird vorbereitet',
          counting: 'Datensätze werden gezählt',
          writing: 'Datensätze werden geschrieben',
          'writing-rows': '{{processed}}/{{total}} Zeilen geschrieben',
          finalizing: 'Datei wird finalisiert',
          downloading: 'Datei wird heruntergeladen'
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(ExportToastComponent);
    component = fixture.componentInstance;
    Object.assign(component, { dialog });
  });

  it('summarizes jobs and delegates user actions', () => {
    component.ngOnInit();

    expect(component.hasJobs).toBe(true);
    expect(component.activeJobCount).toBe(2);
    expect(component.completedJobCount).toBe(1);
    expect(component.failedJobCount).toBe(1);
    expect(component.unavailableJobCount).toBe(1);
    expect(component.getStatusIcon('waiting')).toBe('hourglass_empty');
    expect(component.getStatusIcon('active')).toBe('sync');
    expect(component.getStatusIcon('downloading')).toBe('file_download');
    expect(component.getStatusIcon('completed')).toBe('check_circle');
    expect(component.getStatusIcon('failed')).toBe('error');
    expect(component.getStatusIcon('cancelled')).toBe('cancel');
    expect(component.getStatusIcon('unavailable')).toBe('cloud_off');
    expect(component.getStatusIcon('unknown' as never)).toBe('help');
    expect(component.getStatusClass('failed')).toBe('status-failed');
    expect(component.getExportTypeLabel('aggregated')).toBe(
      'Aggregierte Ansicht'
    );
    expect(component.getExportTypeLabel(jobs[0])).toBe(
      'Kodierer: häufigster Code'
    );
    expect(component.getExportTypeLabel('detailed')).toBe(
      'Detailliertes Kodierprotokoll'
    );
    expect(component.getExportTypeLabel('results-by-version')).toBe(
      'Finale Ergebnisdaten'
    );
    expect(component.getExportTypeLabel('item-matrix')).toBe('Itemdatensatz');
    expect(component.getExportTypeLabel('by-variable-compact')).toBe(
      'Nach Variable, kompakt'
    );
    expect(component.getExportTypeLabel('custom')).toBe('custom');
    expect(component.getErrorTitle(jobs[3])).toBe('Export fehlgeschlagen');
    expect(component.getErrorTitle(jobs[5])).toBe(
      'Exportstatus nicht verfügbar'
    );
    expect(component.getErrorMessage(jobs[5])).toBe(
      'Der aktuelle Zustand des Exports konnte nicht ermittelt werden.'
    );
    expect(component.hasTechnicalDetails(jobs[5])).toBe(true);

    component.toggleCollapse();
    expect(component.isCollapsed).toBe(true);
    component.downloadFile(jobs[0]);
    component.removeJob(jobs[0]);
    component.cancelJob(jobs[1]);
    component.clearCompleted();

    expect(exportJobService.downloadFile).toHaveBeenCalledWith(
      1,
      'waiting',
      'aggregated',
      'export.csv',
      'manual-review-most-frequent'
    );
    expect(exportJobService.removeJob).toHaveBeenCalledWith('waiting');
    expect(exportJobService.cancelJob).toHaveBeenCalledWith(jobs[1]);
    expect(exportJobService.removeJob).toHaveBeenCalledWith('done');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('bad');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('cancelled');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('unavailable');
  });

  it('updates from the jobs stream and tears down subscriptions', () => {
    component.ngOnInit();
    jobs$.next([]);

    expect(component.jobs).toEqual([]);
    expect(component.hasJobs).toBe(false);

    component.ngOnDestroy();
    jobs$.next(jobs);
    expect(component.jobs).toEqual([]);
  });

  it('restores export jobs globally for the selected workspace', () => {
    component.ngOnInit();

    expect(exportJobService.restoreWorkspaceJobs).toHaveBeenCalledWith(5);

    selectedWorkspaceId$.next(7);

    expect(exportJobService.restoreWorkspaceJobs).toHaveBeenCalledWith(7);

    component.ngOnDestroy();
    selectedWorkspaceId$.next(8);

    expect(exportJobService.restoreWorkspaceJobs).not.toHaveBeenCalledWith(8);
  });

  it('keeps a job visible and reports a failed removal', () => {
    exportJobService.removeJob.mockReturnValue(of(false));

    component.removeJob(jobs[2]);

    expect(snackBar.open).toHaveBeenCalledWith(
      'Löschen fehlgeschlagen',
      expect.anything(),
      { duration: 5000 }
    );
  });

  it('turns worksheet limit failures into actionable copy', () => {
    const job: ExportJob = {
      ...jobs[3],
      error: 'Technical worksheet limit details',
      errorCode: 'EXPORT_TOO_MANY_WORKSHEETS',
      errorDetails: {
        actual: 2578,
        max: 1000
      }
    };

    expect(component.getErrorTitle(job)).toBe('Export zu groß');
    expect(component.getErrorMessage(job)).toBe(
      'Dieser Export würde 2578 Tabellenblätter erzeugen. Erlaubt sind aktuell 1000.'
    );
    expect(component.hasTechnicalDetails(job)).toBe(true);
  });

  it('offers diagnostics and a confirmed incomplete download for matrix failures', () => {
    const diagnostics = { total: 1933, sampleLimit: 20, groups: [] };
    const job: ExportJob = {
      ...jobs[3],
      exportType: 'item-matrix',
      error: 'Itemdatensatz enthält 1933 nicht exportierbare Zellen.',
      errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
      errorDetails: {
        total: 1933,
        groupCount: 1,
        sampleLimit: 20,
        diagnosticsAvailable: true,
        incompleteDownloadAvailable: true
      }
    };
    exportJobService.getItemMatrixDiagnostics.mockReturnValue(of(diagnostics));

    expect(component.getErrorTitle(job)).toBe(
      'Itemdatensatz nicht vollständig exportierbar'
    );
    expect(component.getErrorMessage(job)).toBe(
      '1933 Zellen konnten nicht sicher aufgelöst werden.'
    );
    expect(component.hasTechnicalDetails(job)).toBe(false);
    expect(component.canShowItemMatrixDiagnostics(job)).toBe(true);
    expect(component.canDownloadIncompleteItemMatrix(job)).toBe(true);

    component.openItemMatrixDiagnostics(job);
    component.confirmIncompleteItemMatrixDownload(job);

    expect(dialog.open).toHaveBeenCalledTimes(2);
    expect(exportJobService.downloadIncompleteItemMatrix).toHaveBeenCalledWith(
      job
    );
  });

  it('keeps the explanation but disables actions after artifacts expire', () => {
    const job: ExportJob = {
      ...jobs[3],
      exportType: 'item-matrix',
      error: 'Itemdatensatz enthält 1933 nicht exportierbare Zellen.',
      errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
      errorDetails: {
        total: 1933,
        groupCount: 12,
        sampleLimit: 20,
        diagnosticsAvailable: false,
        incompleteDownloadAvailable: false
      }
    };

    expect(component.getErrorMessage(job)).toBe(
      '1933 Zellen konnten nicht sicher aufgelöst werden; abgelaufen.'
    );
    expect(component.canShowItemMatrixDiagnostics(job)).toBe(false);
    expect(component.canDownloadIncompleteItemMatrix(job)).toBe(false);

    jobs$.next([job]);
    fixture.detectChanges();

    const diagnosticsButton = fixture.nativeElement.querySelector(
      '[data-cy="item-matrix-show-diagnostics"]'
    ) as HTMLButtonElement;
    const downloadButton = fixture.nativeElement.querySelector(
      '[data-cy="item-matrix-download-incomplete"]'
    ) as HTMLButtonElement;
    expect(diagnosticsButton).not.toBeNull();
    expect(diagnosticsButton.disabled).toBe(true);
    expect(downloadButton).not.toBeNull();
    expect(downloadButton.disabled).toBe(true);
  });

  it('shows a message when the incomplete download fails', () => {
    const job: ExportJob = {
      ...jobs[3],
      exportType: 'item-matrix',
      errorCode: 'ITEM_MATRIX_UNRESOLVED_CELLS',
      errorDetails: {
        total: 2,
        groupCount: 1,
        sampleLimit: 20,
        diagnosticsAvailable: true,
        incompleteDownloadAvailable: true
      }
    };
    exportJobService.downloadIncompleteItemMatrix.mockReturnValue(
      throwError(() => new Error('expired'))
    );

    component.confirmIncompleteItemMatrixDownload(job);

    expect(snackBar.open).toHaveBeenCalledWith(
      'Download fehlgeschlagen',
      expect.anything(),
      { duration: 5000 }
    );
  });

  it('formats structured progress details', () => {
    const writingJob = {
      ...jobs[1],
      progress: 55,
      progressPhase: 'writing',
      processedRows: 1000,
      totalRows: 2000
    } as ExportJob;
    const countingJob = {
      ...jobs[1],
      progress: 20,
      progressPhase: 'counting'
    } as ExportJob;

    expect(component.getProgressMode(writingJob)).toBe('determinate');
    expect(component.getProgressDescription(writingJob)).toBe(
      '1.000/2.000 Zeilen geschrieben'
    );
    expect(component.getProgressMode(countingJob)).toBe('indeterminate');
    expect(component.getProgressDescription(countingJob)).toBe(
      'Datensätze werden gezählt'
    );
  });

  it('keeps a fallback for legacy worksheet limit messages', () => {
    const job = {
      ...jobs[3],
      error:
        'Der Export enthaelt 42 Unit-Variable-Kombinationen und ueberschreitet das konfigurierte Limit von 10 Tabellenblaettern.'
    };

    expect(component.getErrorMessage(job)).toBe(
      'Dieser Export würde 42 Tabellenblätter erzeugen. Erlaubt sind aktuell 10.'
    );
  });
});
