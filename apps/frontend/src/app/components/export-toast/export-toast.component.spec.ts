import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExportToastComponent } from './export-toast.component';
import { ExportJob, ExportJobService } from '../../shared/services/file/export-job.service';

describe('ExportToastComponent', () => {
  let fixture: ComponentFixture<ExportToastComponent>;
  let component: ExportToastComponent;
  let jobs$: BehaviorSubject<ExportJob[]>;
  let exportJobService: {
    jobs$: BehaviorSubject<ExportJob[]>;
    downloadFile: jest.Mock;
    removeJob: jest.Mock;
    cancelJob: jest.Mock;
  };

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
      jobId: 'active', workspaceId: 1, exportType: 'by-coder', status: 'active'
    },
    {
      jobId: 'done', workspaceId: 1, exportType: 'detailed', status: 'completed'
    },
    {
      jobId: 'bad', workspaceId: 1, exportType: 'custom', status: 'failed'
    },
    {
      jobId: 'cancelled', workspaceId: 1, exportType: 'coding-times', status: 'cancelled'
    }
  ] as ExportJob[];

  beforeEach(async () => {
    jobs$ = new BehaviorSubject<ExportJob[]>(jobs);
    exportJobService = {
      jobs$,
      downloadFile: jest.fn(),
      removeJob: jest.fn(),
      cancelJob: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [ExportToastComponent, TranslateModule.forRoot()],
      providers: [{ provide: ExportJobService, useValue: exportJobService }]
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
          'too-many-worksheets-message': 'Dieser Export würde {{actual}} Tabellenblätter erzeugen. Erlaubt sind aktuell {{max}}.',
          'generic-title': 'Export fehlgeschlagen'
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
  });

  it('summarizes jobs and delegates user actions', () => {
    component.ngOnInit();

    expect(component.hasJobs).toBe(true);
    expect(component.activeJobCount).toBe(2);
    expect(component.completedJobCount).toBe(1);
    expect(component.failedJobCount).toBe(1);
    expect(component.getStatusIcon('waiting')).toBe('hourglass_empty');
    expect(component.getStatusIcon('active')).toBe('sync');
    expect(component.getStatusIcon('downloading')).toBe('file_download');
    expect(component.getStatusIcon('completed')).toBe('check_circle');
    expect(component.getStatusIcon('failed')).toBe('error');
    expect(component.getStatusIcon('cancelled')).toBe('cancel');
    expect(component.getStatusIcon('unknown' as never)).toBe('help');
    expect(component.getStatusClass('failed')).toBe('status-failed');
    expect(component.getExportTypeLabel('aggregated')).toBe('Aggregierte Ansicht');
    expect(component.getExportTypeLabel(jobs[0])).toBe('Kodierer: häufigster Code');
    expect(component.getExportTypeLabel('detailed')).toBe('Detailliertes Kodierprotokoll');
    expect(component.getExportTypeLabel('results-by-version')).toBe('Finale Ergebnisdaten');
    expect(component.getExportTypeLabel('item-matrix')).toBe('Itemdatensatz');
    expect(component.getExportTypeLabel('by-variable-compact')).toBe('Nach Variable, kompakt');
    expect(component.getExportTypeLabel('custom')).toBe('custom');
    expect(component.getErrorTitle(jobs[3])).toBe('Export fehlgeschlagen');

    component.toggleCollapse();
    expect(component.isCollapsed).toBe(true);
    component.downloadFile(jobs[0]);
    component.removeJob(jobs[0]);
    component.cancelJob(jobs[1]);
    component.clearCompleted();

    expect(exportJobService.downloadFile)
      .toHaveBeenCalledWith(1, 'waiting', 'aggregated', 'export.csv', 'manual-review-most-frequent');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('waiting');
    expect(exportJobService.cancelJob).toHaveBeenCalledWith(jobs[1]);
    expect(exportJobService.removeJob).toHaveBeenCalledWith('done');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('bad');
    expect(exportJobService.removeJob).toHaveBeenCalledWith('cancelled');
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

  it('turns worksheet limit failures into actionable copy', () => {
    const job = {
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
    expect(component.getProgressDescription(writingJob)).toBe('1.000/2.000 Zeilen geschrieben');
    expect(component.getProgressMode(countingJob)).toBe('indeterminate');
    expect(component.getProgressDescription(countingJob)).toBe('Datensätze werden gezählt');
  });

  it('keeps a fallback for legacy worksheet limit messages', () => {
    const job = {
      ...jobs[3],
      error: 'Der Export enthaelt 42 Unit-Variable-Kombinationen und ueberschreitet das konfigurierte Limit von 10 Tabellenblaettern.'
    };

    expect(component.getErrorMessage(job)).toBe(
      'Dieser Export würde 42 Tabellenblätter erzeugen. Erlaubt sind aktuell 10.'
    );
  });
});
