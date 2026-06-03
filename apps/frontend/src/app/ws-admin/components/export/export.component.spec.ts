import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ExportComponent } from './export.component';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { CodingFacadeService } from '../../../services/facades/coding-facade.service';
import { CoderService } from '../../../coding/services/coder.service';
import { ResponseService } from '../../../shared/services/response/response.service';

describe('ExportComponent', () => {
  let fixture: ComponentFixture<ExportComponent>;
  let component: ExportComponent;
  let startJob: jest.Mock;
  let estimateJob: jest.Mock;
  let snackOpen: jest.Mock;

  beforeEach(async () => {
    startJob = jest.fn().mockReturnValue(of({ jobId: 'job-1' }));
    estimateJob = jest.fn().mockReturnValue(of({
      exportType: 'by-variable',
      unitVariableCount: 10,
      worksheetLimit: 1000,
      exceedsWorksheetLimit: false
    }));
    snackOpen = jest.fn();

    await TestBed.configureTestingModule({
      imports: [
        ExportComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: AppService,
          useValue: {
            selectedWorkspaceId: 5,
            userId: 2,
            loggedUser: undefined,
            createOwnToken: jest.fn().mockReturnValue(of('token'))
          }
        },
        {
          provide: ExportJobService,
          useValue: { startJob, estimateJob }
        },
        {
          provide: CodingFacadeService,
          useValue: {
            getJobDefinitions: jest.fn().mockReturnValue(of([])),
            getCoderTrainings: jest.fn().mockReturnValue(of([]))
          }
        },
        {
          provide: CoderService,
          useValue: {
            getCoders: jest.fn().mockReturnValue(of([
              { id: 30, name: 'coder1' },
              { id: 31, name: 'coder2' }
            ]))
          }
        },
        {
          provide: ResponseService,
          useValue: {
            hasGeogebraResponses: jest.fn().mockReturnValue(of(false))
          }
        },
        {
          provide: MatSnackBar,
          useValue: { open: snackOpen }
        },
        {
          provide: MatDialog,
          useValue: { open: jest.fn() }
        }
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      close: 'Schließen',
      'ws-admin': {
        export: {
          'job-started': 'Datenexport gestartet',
          errors: {
            'start-failed': 'Datenexport konnte nicht gestartet werden',
            'too-many-worksheets-short': 'Der Export ist zu groß für einzelne Tabellenblätter.'
          }
        },
        'export-options': {
          'all-coders': 'Alle Kodierer',
          'selected-coders': '{{count}} Kodierer'
        }
      }
    });
    translateService.use('de');

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('defaults to final result exports', () => {
    expect(component.selectedFormat).toBe('results-by-version');
  });

  it('groups final result data separately from audit exports', () => {
    expect(component.exportFormatGroups[0].formats.map(format => format.value)).toEqual([
      'results-by-version',
      'aggregated'
    ]);
    expect(component.exportFormatGroups[1].formats.map(format => format.value)).toEqual([
      'by-coder',
      'by-variable',
      'by-variable-compact',
      'detailed',
      'coding-times'
    ]);
  });

  it('starts final result exports without job, training, coder, or manual-variable filters', () => {
    component.selectedFormat = 'results-by-version';
    component.resultsVersion = 'v2';
    component.resultsFormat = 'excel';
    component.includeResponseValues = true;
    component.selectedCombinedJobIds = ['job_10', 'training_20'];
    component.selectedCoderIds = [30];
    component.excludeAutoCoded = true;

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'results-by-version',
      userId: 2,
      version: 'v2',
      format: 'excel',
      includeResponseValues: true,
      includeReplayUrl: false
    }));
    const config = startJob.mock.calls[0][1];
    expect(config).not.toHaveProperty('jobDefinitionIds');
    expect(config).not.toHaveProperty('coderTrainingIds');
    expect(config).not.toHaveProperty('coderIds');
    expect(config).not.toHaveProperty('excludeAutoCoded');
    expect(snackOpen).toHaveBeenCalledWith('Datenexport gestartet', 'Schließen', { duration: 3000 });
  });

  it('includes GeoGebra package option only for Excel result exports', () => {
    component.selectedFormat = 'results-by-version';
    component.resultsVersion = 'v2';
    component.resultsFormat = 'excel';
    component.includeResponseValues = true;
    component.hasGeoGebraResponses = true;
    component.includeGeoGebraFiles = true;

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'results-by-version',
      format: 'excel',
      includeResponseValues: true,
      includeGeoGebraResponseValues: false,
      includeGeoGebraFiles: true
    }));

    startJob.mockClear();
    component.resultsFormat = 'csv';
    component.onResultsFormatChange();
    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'results-by-version',
      format: 'csv',
      includeGeoGebraResponseValues: false,
      includeGeoGebraFiles: false
    }));
  });

  it('includes raw GeoGebra response value option for result exports', () => {
    component.selectedFormat = 'results-by-version';
    component.resultsFormat = 'csv';
    component.includeResponseValues = true;
    component.hasGeoGebraResponses = true;
    component.includeGeoGebraResponseValues = true;

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'results-by-version',
      format: 'csv',
      includeResponseValues: true,
      includeGeoGebraResponseValues: true,
      includeGeoGebraFiles: false
    }));
  });

  it('keeps audit export filters for detailed coding protocol exports', () => {
    component.selectedFormat = 'detailed';
    component.selectedCombinedJobIds = ['job_10', 'training_20'];
    component.selectedCoderIds = [30];
    component.excludeAutoCoded = true;

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'detailed',
      jobDefinitionIds: [10],
      coderTrainingIds: [20],
      coderIds: [30],
      excludeAutoCoded: true
    }));
  });

  it('blocks oversized legacy by-variable exports and suggests the compact export', () => {
    estimateJob.mockReturnValueOnce(of({
      exportType: 'by-variable',
      unitVariableCount: 2578,
      worksheetLimit: 1000,
      exceedsWorksheetLimit: true
    }));
    component.selectedFormat = 'by-variable';

    component.onExport();

    expect(estimateJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'by-variable'
    }));
    expect(startJob).not.toHaveBeenCalled();
    expect(component.largeByVariableEstimate?.unitVariableCount).toBe(2578);
    expect(snackOpen).toHaveBeenCalledWith(
      'Der Export ist zu groß für einzelne Tabellenblätter.',
      'Schließen',
      { duration: 7000 }
    );

    component.selectCompactVariableExport();
    expect(component.selectedFormat).toBe('by-variable-compact');
    expect(component.largeByVariableEstimate).toBeNull();
  });

  it('shows an error when the export job cannot be started', () => {
    startJob.mockReturnValueOnce(throwError(() => new Error('start failed')));

    component.onExport();

    expect(snackOpen).toHaveBeenCalledWith(
      'Datenexport konnte nicht gestartet werden',
      'Schließen',
      { duration: 5000 }
    );
    expect(component.isStartingExport).toBe(false);
  });

  it('labels an empty coder filter as all coders', () => {
    component.selectedCoderIds = [];
    expect(component.getCoderSelectionLabel()).toBe('Alle Kodierer');

    component.selectedCoderIds = [30];
    expect(component.getCoderSelectionLabel()).toBe('coder1');

    component.selectedCoderIds = [30, 31];
    expect(component.getCoderSelectionLabel()).toBe('2 Kodierer');
  });
});
