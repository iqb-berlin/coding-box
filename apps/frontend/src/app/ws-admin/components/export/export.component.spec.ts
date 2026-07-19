import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of, Subject, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ExportComponent } from './export.component';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { MissingsProfileService } from '../../../coding/services/missings-profile.service';

describe('ExportComponent', () => {
  let fixture: ComponentFixture<ExportComponent>;
  let component: ExportComponent;
  let startJob: jest.Mock;
  let snackOpen: jest.Mock;
  let getMissingsProfiles: jest.Mock;
  let getPsychometricDomainCandidates: jest.Mock;

  beforeEach(async () => {
    startJob = jest.fn().mockReturnValue(of({ jobId: 'job-1' }));
    snackOpen = jest.fn();
    getMissingsProfiles = jest
      .fn()
      .mockReturnValue(of([{ id: 4, label: 'IQB-Standard' }]));
    getPsychometricDomainCandidates = jest.fn().mockReturnValue(
      of({
        candidates: [
          {
            scope: 'ITEM',
            profileId: 'profile',
            entryId: 'domain',
            label: 'Kompetenzbereich',
            coverage: 2,
            itemCount: 2,
            singleValued: true,
            selectable: true
          }
        ],
        mappingIssueCount: 0
      })
    );

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
          useValue: {
            startJob,
            getPsychometricDomainCandidates
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
          provide: MissingsProfileService,
          useValue: {
            getMissingsProfilesOrThrow: getMissingsProfiles
          }
        }
      ]
    }).compileComponents();

    const translateService = TestBed.inject(TranslateService);
    translateService.setTranslation('de', {
      close: 'Schließen',
      'ws-admin': {
        'export-options': {
          'psychometric-mapping-issues': 'Zuordnungsprobleme: {{count}}'
        },
        export: {
          'job-started': 'Datenexport gestartet',
          errors: {
            'start-failed': 'Datenexport konnte nicht gestartet werden',
            'psychometric-options-failed':
              'Missing-Profile konnten nicht geladen werden',
            'psychometric-domain-options-failed':
              'VOMD-Domänen konnten nicht geladen werden'
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

    expect(startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'results-by-version',
        userId: 2,
        version: 'v2',
        format: 'excel',
        includeResponseValues: true,
        includeReplayUrl: false
      })
    );
    const config = startJob.mock.calls[0][1];
    expect(config).not.toHaveProperty('jobDefinitionIds');
    expect(config).not.toHaveProperty('coderTrainingIds');
    expect(config).not.toHaveProperty('coderIds');
    expect(config).not.toHaveProperty('excludeAutoCoded');
    expect(snackOpen).toHaveBeenCalledWith(
      'Datenexport gestartet',
      'Schließen',
      { duration: 3000 }
    );
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

    expect(startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'item-matrix',
        userId: 2,
        version: 'v2',
        format: 'csv',
        matrixValue: 'score'
      })
    );
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

    expect(startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'results-by-version',
        format: 'excel',
        includeResponseValues: true,
        includeGeoGebraResponseValues: false,
        includeGeoGebraFiles: true
      })
    );

    startJob.mockClear();
    component.resultsFormat = 'csv';
    component.onResultsFormatChange();
    component.onExport();

    expect(startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'results-by-version',
        format: 'csv',
        includeGeoGebraResponseValues: false,
        includeGeoGebraFiles: false
      })
    );
  });

  it('includes raw GeoGebra response value option for result exports', () => {
    component.resultsFormat = 'csv';
    component.includeResponseValues = true;
    component.hasGeoGebraResponses = true;
    component.includeGeoGebraResponseValues = true;

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'results-by-version',
        format: 'csv',
        includeResponseValues: true,
        includeGeoGebraResponseValues: true,
        includeGeoGebraFiles: false
      })
    );
  });

  it('starts psychometric exports with domain and missing-profile options', () => {
    component.selectedFormat = 'psychometrics';
    component.resultsVersion = 'v2';
    component.resultsFormat = 'excel';
    component.partWholeCorrection = true;
    component.maxCategoryCount = 12;
    component.selectedMissingsProfileId = 4;
    const candidate = component.psychometricDomainCandidates[0];
    component.selectedPsychometricDomain =
      component.getPsychometricDomainKey(candidate);

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(5, {
      exportType: 'psychometrics',
      userId: 2,
      version: 'v2',
      format: 'excel',
      partWholeCorrection: true,
      missingsProfileId: 4,
      domain: {
        mode: 'vomd-field',
        scope: 'ITEM',
        profileId: 'profile',
        entryId: 'domain'
      },
      maxCategoryCount: 12
    });
  });

  it('shows VOMD mapping issues separately from item coverage', () => {
    component.selectedFormat = 'psychometrics';
    component.psychometricDomainCandidates = [];
    component.psychometricMappingIssueCount = 3;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Zuordnungsprobleme: 3'
    );
    expect(component.psychometricMappingIssueCount).toBe(3);
  });

  it('disables psychometric exports when VOMD mappings are invalid', () => {
    component.selectedFormat = 'psychometrics';
    component.selectedPsychometricDomain = 'workspace';
    component.selectedMissingsProfileId = 4;
    component.psychometricMappingIssueCount = 1;

    expect(component.isExportDisabled).toBe(true);

    component.onExport();

    expect(startJob).not.toHaveBeenCalled();
  });

  it('finishes loading and reports an error when missing profiles cannot be loaded', () => {
    fixture.destroy();
    getMissingsProfiles.mockReturnValueOnce(
      throwError(() => new Error('profiles failed'))
    );

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isLoadingPsychometricOptions).toBe(false);
    expect(component.missingsProfiles).toEqual([]);
    expect(component.selectedMissingsProfileId).toBeNull();
    expect(component.psychometricOptionsLoadFailed).toBe(true);
    expect(snackOpen).toHaveBeenCalledWith(
      'Missing-Profile konnten nicht geladen werden',
      'Schließen',
      { duration: 5000 }
    );
  });

  it('blocks psychometric exports when VOMD domain options cannot be loaded', () => {
    fixture.destroy();
    getPsychometricDomainCandidates.mockReturnValueOnce(
      throwError(() => new Error('VOMD failed'))
    );

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedFormat = 'psychometrics';
    component.selectedMissingsProfileId = 4;

    expect(component.isLoadingPsychometricOptions).toBe(false);
    expect(component.psychometricOptionsLoadFailed).toBe(true);
    expect(component.isExportDisabled).toBe(true);
    expect(snackOpen).toHaveBeenCalledWith(
      'VOMD-Domänen konnten nicht geladen werden',
      'Schließen',
      { duration: 5000 }
    );

    component.onExport();

    expect(startJob).not.toHaveBeenCalled();
  });

  it('keeps the combined option load pending until both requests complete', () => {
    fixture.destroy();
    const profiles = new Subject<Array<{ id: number; label: string }>>();
    const domains = new Subject<{
      candidates: [];
      mappingIssueCount: number;
    }>();
    getMissingsProfiles.mockReturnValueOnce(profiles);
    getPsychometricDomainCandidates.mockReturnValueOnce(domains);

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    expect(component.isLoadingPsychometricOptions).toBe(true);

    profiles.next([{ id: 7, label: 'Profil 7' }]);
    profiles.complete();

    expect(component.isLoadingPsychometricOptions).toBe(true);

    domains.next({ candidates: [], mappingIssueCount: 0 });
    domains.complete();

    expect(component.isLoadingPsychometricOptions).toBe(false);
    expect(component.psychometricOptionsLoadFailed).toBe(false);
    expect(component.missingsProfiles).toEqual([{ id: 7, label: 'Profil 7' }]);
    expect(component.selectedMissingsProfileId).toBe(7);
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
