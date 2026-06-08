import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ExportComponent } from './export.component';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { ResponseService } from '../../../shared/services/response/response.service';

describe('ExportComponent', () => {
  let fixture: ComponentFixture<ExportComponent>;
  let component: ExportComponent;
  let startJob: jest.Mock;
  let snackOpen: jest.Mock;

  beforeEach(async () => {
    startJob = jest.fn().mockReturnValue(of({ jobId: 'job-1' }));
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
            loggedUser: undefined
          }
        },
        {
          provide: ExportJobService,
          useValue: { startJob }
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
            'start-failed': 'Datenexport konnte nicht gestartet werden'
          }
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

  it('starts final result exports without manual coding filters', () => {
    component.resultsVersion = 'v2';
    component.resultsFormat = 'excel';
    component.includeResponseValues = true;

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

  it('starts item matrix exports with matrix options', () => {
    component.selectedFormat = 'item-matrix';
    component.resultsVersion = 'v2';
    component.resultsFormat = 'csv';
    component.matrixValue = 'score';
    component.includeResponseValues = true;
    component.includeGeoGebraResponseValues = true;
    component.includeGeoGebraFiles = true;

    component.onSelectedFormatChange();
    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, expect.objectContaining({
      exportType: 'item-matrix',
      userId: 2,
      version: 'v2',
      format: 'csv',
      matrixValue: 'score'
    }));
    const config = startJob.mock.calls[0][1];
    expect(config).not.toHaveProperty('includeResponseValues');
    expect(config).not.toHaveProperty('includeGeoGebraResponseValues');
    expect(config).not.toHaveProperty('includeGeoGebraFiles');
    expect(component.includeGeoGebraResponseValues).toBe(false);
    expect(component.includeGeoGebraFiles).toBe(false);
  });

  it('includes GeoGebra package option only for Excel result exports', () => {
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
});
