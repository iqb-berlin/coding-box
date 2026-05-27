import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MAT_DIALOG_DATA, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { WorkspaceProcessesService } from '../../services/workspace-processes.service';
import { ProcessOverviewComponent } from './process-overview.component';
import { ProcessDto } from '../../../../../../../api-dto/workspaces/process-dto';

describe('ProcessOverviewComponent', () => {
  let fixture: ComponentFixture<ProcessOverviewComponent>;
  let component: ProcessOverviewComponent;
  let processesService: {
    getProcesses: jest.Mock;
    deleteProcess: jest.Mock;
  };
  let dialog: {
    open: jest.Mock;
  };
  let snackBar: {
    open: jest.Mock;
  };

  beforeEach(async () => {
    processesService = {
      getProcesses: jest.fn().mockReturnValue(of([])),
      deleteProcess: jest.fn().mockReturnValue(of(true))
    };
    dialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(true) })
    };
    snackBar = {
      open: jest.fn()
    };

    await TestBed.configureTestingModule({
      imports: [
        NoopAnimationsModule,
        TranslateModule.forRoot(),
        ProcessOverviewComponent
      ],
      providers: [
        { provide: WorkspaceProcessesService, useValue: processesService },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: MAT_DIALOG_DATA, useValue: { workspaceId: 7 } }
      ]
    }).overrideComponent(ProcessOverviewComponent, {
      add: {
        providers: [
          { provide: WorkspaceProcessesService, useValue: processesService },
          { provide: MatDialog, useValue: dialog },
          { provide: MatSnackBar, useValue: snackBar }
        ]
      }
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      close: 'Schließen',
      'process-overview': {
        title: 'Zentrale Prozess-Übersicht',
        refresh: 'Aktualisieren',
        'no-data': 'Keine Prozesse in der Warteschlange.',
        'no-filter-data': 'Keine Prozesse für die aktuellen Filter.',
        'confirm-content': 'Möchten Sie den Prozess "{{queue}}" (ID: {{id}}) wirklich {{action}}?',
        filters: {
          status: 'Status',
          'all-status': 'Alle Status',
          type: 'Typ',
          'all-types': 'Alle Typen',
          search: 'Suchen',
          'search-placeholder': 'ID, Name oder Detail',
          clear: 'Filter leeren'
        },
        columns: {
          type: 'Typ',
          status: 'Status',
          progress: 'Fortschritt',
          time: 'Zeit',
          details: 'Details',
          actions: 'Aktionen'
        },
        status: {
          active: 'Läuft',
          waiting: 'Wartet',
          delayed: 'Geplant',
          completed: 'Abgeschlossen',
          failed: 'Fehlgeschlagen',
          paused: 'Pausiert',
          unknown: 'Unbekannt'
        },
        'status-tooltips': {
          active: 'Der Prozess wird gerade bearbeitet.',
          waiting: 'Der Prozess wartet auf einen freien Worker oder auf vorgelagerte Arbeit.',
          delayed: 'Der Prozess ist für einen späteren Start eingeplant.',
          completed: 'Der Prozess wurde erfolgreich abgeschlossen.',
          failed: 'Der Prozess ist mit einem Fehler beendet worden.',
          paused: 'Der Prozess wurde angehalten.',
          unknown: 'Der aktuelle Prozessstatus ist nicht eindeutig bekannt.'
        },
        progress: {
          active: 'Läuft ohne Fortschrittsangabe',
          waiting: 'Wartet auf Start',
          delayed: 'Start geplant',
          completed: 'Abgeschlossen',
          failed: 'Keine Fortschrittsangabe',
          paused: 'Pausiert',
          unknown: 'Keine Fortschrittsangabe'
        },
        time: {
          created: 'Erstellt',
          started: 'Gestartet',
          finished: 'Beendet',
          duration: 'Dauer'
        },
        queues: {
          'test-person-coding': {
            label: 'Auto-Kodierung',
            description: 'Automatisches Kodieren von Testpersonen-Antworten'
          },
          'coding-statistics': {
            label: 'Kodierstatistiken',
            description: 'Berechnung der Kodierstatistiken für den Arbeitsbereich'
          },
          'data-export': {
            label: 'Datenexport',
            description: 'Export von Kodier- oder Testergebnisdaten'
          },
          'variable-analysis': {
            label: 'Variablenanalyse',
            description: 'Analyse von Variablenwerten und Häufigkeiten'
          }
        },
        details: {
          none: 'Keine Details',
          'unknown-key': '{{key}}',
          exportType: 'Exporttyp',
          fileName: 'Datei',
          isCancelled: 'Abgebrochen',
          personCount: 'Personen',
          unitId: 'Unit',
          variableId: 'Variable'
        },
        actions: {
          'not-safe': 'Für diesen Status oder Prozesstyp gibt es keine sichere Aktion.',
          cancel: {
            label: 'Abbrechen',
            tooltip: 'Laufenden Prozess abbrechen',
            'confirm-title': 'Prozess abbrechen',
            infinitive: 'abbrechen',
            success: 'Prozess wurde abgebrochen'
          },
          pause: {
            label: 'Anhalten',
            tooltip: 'Laufenden Prozess anhalten',
            'confirm-title': 'Prozess anhalten',
            infinitive: 'anhalten',
            success: 'Prozess wurde angehalten'
          },
          remove: {
            label: 'Entfernen',
            tooltip: 'Prozess aus der Warteschlange entfernen',
            'confirm-title': 'Prozess entfernen',
            infinitive: 'entfernen',
            success: 'Prozess wurde entfernt'
          }
        },
        messages: {
          'load-error': 'Fehler beim Laden der Prozesse',
          'action-failed': 'Prozess konnte nicht aktualisiert werden',
          'action-error': 'Fehler beim Aktualisieren des Prozesses'
        },
        values: {
          yes: 'Ja',
          no: 'Nein'
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(ProcessOverviewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('confirms and deletes a removable process', () => {
    const process: ProcessDto = {
      id: 'job-1',
      queueName: 'data-export',
      status: 'waiting',
      progress: 0,
      timestamp: 100
    };

    component.deleteProcess(process);

    expect(dialog.open).toHaveBeenCalled();
    expect(processesService.deleteProcess).toHaveBeenCalledWith(7, 'data-export', 'job-1');
    expect(snackBar.open).toHaveBeenCalledWith(
      'Prozess wurde entfernt',
      'Schließen',
      { duration: 3000 }
    );
  });

  it('uses precise action semantics for active and inactive jobs', () => {
    expect(component.canRemoveProcess({
      id: 'job-1',
      queueName: 'coding-statistics',
      status: 'paused',
      progress: 0,
      timestamp: 100
    })).toBe(true);

    expect(component.getProcessAction({
      id: 'job-2',
      queueName: 'test-person-coding',
      status: 'active',
      progress: 20,
      timestamp: 100
    })).toBe('pause');

    expect(component.canRemoveProcess({
      id: 'job-3',
      queueName: 'database-export',
      status: 'active',
      progress: 50,
      timestamp: 100
    })).toBe(true);

    expect(component.canRemoveProcess({
      id: 'job-4',
      queueName: 'coding-statistics',
      status: 'active',
      progress: 0,
      timestamp: 100
    })).toBe(false);
  });

  it('keeps the tooltip on a wrapper around disabled action buttons', () => {
    component.processes.data = [{
      id: 'job-2',
      queueName: 'coding-statistics',
      status: 'active',
      progress: 0,
      timestamp: 100
    }];
    fixture.detectChanges();

    const wrapper = fixture.debugElement.query(By.css('.action-tooltip-wrapper'));
    const button = wrapper.query(By.css('button'));

    expect(wrapper).toBeTruthy();
    expect(button.nativeElement.disabled).toBe(true);
  });

  it('maps queue names and statuses to user-facing labels', () => {
    expect(component.getQueueLabel('data-export')).toBe('Datenexport');
    expect(component.getQueueLabel('unknown-queue')).toBe('unknown-queue');
    expect(component.getStatusLabel('waiting')).toBe('Wartet');
    expect(component.getStatusIcon('failed')).toBe('error');
  });

  it('formats progress, duration and details for real process rows', () => {
    const process: ProcessDto = {
      id: 'job-1',
      queueName: 'data-export',
      status: 'completed',
      progress: 99.7,
      timestamp: 1000,
      processedOn: 2000,
      finishedOn: 65000,
      data: {
        workspaceId: 7,
        exportType: 'test-results',
        isCancelled: false,
        personCount: 2
      }
    };

    expect(component.getProgressPercent(process)).toBe(100);
    expect(component.getProgressLabel(process)).toBe('100 %');
    expect(component.getDurationLabel(process)).toBe('1 min 3 s');
    expect(component.getProcessDetailItems(process)).toEqual([
      { label: 'Exporttyp', value: 'test-results' },
      { label: 'Personen', value: '2' },
      { label: 'Abgebrochen', value: 'Nein' }
    ]);
  });

  it('shows status chip, progress bar, time metadata and process details', () => {
    component.processes.data = [{
      id: 'job-5',
      queueName: 'data-export',
      status: 'failed',
      progress: { processed: 4 },
      failedReason: 'Export error',
      timestamp: 1000,
      processedOn: 2000,
      finishedOn: 5000,
      data: {
        exportType: 'test-results',
        fileName: 'export.csv'
      }
    }];
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.status-chip')).nativeElement.textContent).toContain('Fehlgeschlagen');
    expect(fixture.debugElement.query(By.css('.muted-text')).nativeElement.textContent).toContain('Keine Fortschrittsangabe');
    expect(fixture.debugElement.query(By.css('.time-cell')).nativeElement.textContent).toContain('Gestartet');
    expect(fixture.debugElement.query(By.css('.failed-reason')).nativeElement.textContent).toContain('Export error');
    expect(fixture.debugElement.query(By.css('.detail-list')).nativeElement.textContent).toContain('export.csv');
  });
});
