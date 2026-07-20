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
  let getItemDatasetOptions: jest.Mock;
  let selectedWorkspaceIdSubject: Subject<number>;
  let appService: {
    selectedWorkspaceId: number;
    selectedWorkspaceId$: Subject<number>;
    userId: number;
    loggedUser: undefined;
  };

  beforeEach(async () => {
    selectedWorkspaceIdSubject = new Subject<number>();
    appService = {
      selectedWorkspaceId: 5,
      selectedWorkspaceId$: selectedWorkspaceIdSubject,
      userId: 2,
      loggedUser: undefined
    };
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
        itemCount: 2,
        mappingIssueCount: 0,
        mappingFallbackCount: 0,
        mappingIssuePreview: [],
        mappingFallbackPreview: []
      })
    );
    getItemDatasetOptions = jest.fn().mockReturnValue(of({
      items: [{
        unitId: 'UNIT1',
        unitLabel: 'Aufgabe 1',
        itemId: 'ITEM1',
        itemLabel: 'Item 1',
        columnName: 'Aufgabe1_ITEM1'
      }],
      mappingIssues: []
    }));

    await TestBed.configureTestingModule({
      imports: [
        ExportComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot()
      ],
      providers: [
        {
          provide: AppService,
          useValue: appService
        },
        {
          provide: ExportJobService,
          useValue: {
            startJob,
            getPsychometricDomainCandidates,
            getItemDatasetOptions
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
          'psychometric-no-items': 'Keine auswertbaren VOMD-Items gefunden',
          'psychometric-mapping-issues': 'Fatale Zuordnungsprobleme: {{count}}',
          'psychometric-info-summary':
            'Der Export enthält aggregierte Trennschärfen, keine personenbezogenen Daten. Ein Item ist eine in der VOMD ausgewiesene Testaufgabe bzw. Ergebnisvariable.',
          'psychometric-items-detected': 'Erkannte VOMD-Items: {{count}}',
          'psychometric-info-show-details':
            'Kennwerte und Status erläutern',
          'psychometric-info-hide-details': 'Erläuterungen ausblenden',
          'psychometric-info-score-title': 'Score-Trennschärfe',
          'psychometric-info-score-description':
            'Zusammenhang zwischen Item-Score und Domänenscore.',
          'psychometric-info-code-category-title':
            'Code-/Kategorientrennschärfe',
          'psychometric-info-code-category-description':
            'Zusammenhang einer 0/1-Markierung mit dem Domänenscore.',
          'psychometric-info-status-title':
            'Paarweise vollständige Fälle und Status',
          'psychometric-info-status-description':
            'n bezeichnet paarweise vollständige Fälle. Weniger als 30 Fälle verhindern den Export nicht.',
          'psychometric-info-part-whole-title': 'Part-Whole-Korrektur',
          'psychometric-info-part-whole-description':
            'Zieht den aktuellen Item-Score aus dem Domänenscore ab.'
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
    expect(getMissingsProfiles).not.toHaveBeenCalled();
    expect(getPsychometricDomainCandidates).not.toHaveBeenCalled();
  });

  it('loads psychometric options lazily and caches successful results', () => {
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();

    expect(getMissingsProfiles).toHaveBeenCalledTimes(1);
    expect(getPsychometricDomainCandidates).toHaveBeenCalledTimes(1);
    expect(component.psychometricItemCount).toBe(2);

    component.selectedFormat = 'results-by-version';
    component.onSelectedFormatChange();
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();

    expect(getMissingsProfiles).toHaveBeenCalledTimes(1);
    expect(getPsychometricDomainCandidates).toHaveBeenCalledTimes(1);
  });

  it('shows the explanatory block only for psychometric exports', () => {
    expect(
      fixture.nativeElement.querySelector('.psychometric-info-block')
    ).toBeNull();

    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();
    fixture.detectChanges();

    const infoBlock = fixture.nativeElement.querySelector(
      '.psychometric-info-block'
    );
    expect(infoBlock).not.toBeNull();
    expect(infoBlock.textContent).toContain(
      'Der Export enthält aggregierte Trennschärfen, keine personenbezogenen Daten.'
    );
    expect(infoBlock.textContent).toContain(
      'Ein Item ist eine in der VOMD ausgewiesene Testaufgabe bzw. Ergebnisvariable.'
    );
  });

  it('expands and collapses the psychometric explanations', () => {
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector(
      '.psychometric-info-toggle'
    ) as HTMLButtonElement;
    expect(
      fixture.nativeElement.querySelector('.psychometric-info-grid')
    ).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.psychometric-info-grid').textContent
    ).toContain('Score-Trennschärfe');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    toggle.click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.psychometric-info-grid')
    ).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the detected VOMD item count', () => {
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.psychometric-item-count')
        .textContent
    ).toContain('Erkannte VOMD-Items: 2');
  });

  it('does not require case-count data before starting a psychometric export', () => {
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();
    fixture.detectChanges();

    expect(component.isExportDisabled).toBe(false);
    expect(getPsychometricDomainCandidates).toHaveBeenCalledTimes(1);

    fixture.nativeElement
      .querySelector('.psychometric-info-toggle')
      .click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Weniger als 30 Fälle verhindern den Export nicht.'
    );

    component.onExport();

    expect(startJob).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        exportType: 'psychometrics',
        missingsProfileId: 4,
        domain: { mode: 'workspace' }
      })
    );
  });

  it('reloads cached psychometric options when the workspace changes', () => {
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();

    appService.selectedWorkspaceId = 6;
    selectedWorkspaceIdSubject.next(6);

    expect(getMissingsProfiles).toHaveBeenCalledTimes(2);
    expect(getMissingsProfiles).toHaveBeenLastCalledWith(6);
    expect(getPsychometricDomainCandidates).toHaveBeenCalledTimes(2);
    expect(getPsychometricDomainCandidates).toHaveBeenLastCalledWith(6);
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
        matrixValue: 'score',
        missingsProfileId: 4,
        notReachedScope: 'unit',
        recodeTrailingOmissions: false,
        items: [{ unitId: 'UNIT1', itemId: 'ITEM1' }],
        downloadFilePrefix: 'Itemdatensatz'
      })
    );
    const config = startJob.mock.calls[0][1];
    expect(config).not.toHaveProperty('includeResponseValues');
    expect(config).not.toHaveProperty('includeGeoGebraResponseValues');
    expect(config).not.toHaveProperty('includeGeoGebraFiles');
    expect(component.includeGeoGebraResponseValues).toBe(false);
    expect(component.includeGeoGebraFiles).toBe(false);
  });

  it('blocks item dataset exports when VOMD mappings are invalid', () => {
    getItemDatasetOptions.mockReturnValue(of({
      items: [],
      mappingIssues: [{
        code: 'vomd-mapping',
        message: 'UNIT1/VAR1: keine VOMD-Zuordnung',
        unitId: 'UNIT1'
      }]
    }));
    component.selectedFormat = 'item-matrix';

    component.onSelectedFormatChange();

    expect(component.itemDatasetMappingIssues).toEqual([
      {
        code: 'vomd-mapping',
        message: 'UNIT1/VAR1: keine VOMD-Zuordnung',
        unitId: 'UNIT1'
      }
    ]);
    expect(component.isExportDisabled).toBe(true);
  });

  it('requires an explicit item dataset profile when IQB standard is absent', () => {
    fixture.destroy();
    getMissingsProfiles.mockReturnValueOnce(of([
      { id: 7, label: 'Projektprofil' }
    ]));

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedFormat = 'item-matrix';
    component.onSelectedFormatChange();

    expect(component.selectedItemDatasetMissingsProfileId).toBeNull();
    expect(component.isExportDisabled).toBe(true);

    component.selectedItemDatasetMissingsProfileId = 7;

    expect(component.isExportDisabled).toBe(false);
  });

  it('preselects only the canonical IQB standard profile', () => {
    fixture.destroy();
    getMissingsProfiles.mockReturnValueOnce(of([
      { id: 7, label: 'Mein IQB Standard angepasst' },
      { id: 4, label: 'IQB-Standard' }
    ]));

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedFormat = 'item-matrix';
    component.onSelectedFormatChange();

    expect(component.selectedItemDatasetMissingsProfileId).toBe(4);
  });

  it('keeps item dataset and psychometric profile selections separate', () => {
    component.selectedFormat = 'item-matrix';
    component.onSelectedFormatChange();
    component.selectedItemDatasetMissingsProfileId = 7;

    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();
    component.selectedMissingsProfileId = 9;

    expect(component.selectedItemDatasetMissingsProfileId).toBe(7);
    expect(component.selectedMissingsProfileId).toBe(9);
  });

  it('preserves hidden item selections when a filtered selection changes', () => {
    component.itemDatasetOptions = [
      {
        unitId: 'UNIT1',
        unitLabel: 'Aufgabe 1',
        itemId: 'ITEM1',
        itemLabel: 'Item 1',
        columnName: 'Aufgabe1_ITEM1'
      },
      {
        unitId: 'UNIT2',
        unitLabel: 'Aufgabe 2',
        itemId: 'ITEM2',
        itemLabel: 'Item 2',
        columnName: 'Aufgabe2_ITEM2'
      }
    ];
    component.selectedItemKeys = component.itemDatasetOptions.map(
      item => component.getItemDatasetKey(item)
    );
    component.itemSearch = 'ITEM2';

    component.onItemDatasetSelectionChange([]);

    expect(component.selectedItemKeys).toEqual(['UNIT1\u001FITEM1']);
  });

  it('keeps item profiles available when psychometric profile loading fails', () => {
    fixture.destroy();
    getMissingsProfiles
      .mockReturnValueOnce(of([{ id: 4, label: 'IQB-Standard' }]))
      .mockReturnValueOnce(
        throwError(() => new Error('psychometric profiles failed'))
      );

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedFormat = 'item-matrix';
    component.onSelectedFormatChange();

    expect(component.itemDatasetMissingsProfiles).toEqual([
      { id: 4, label: 'IQB-Standard' }
    ]);
    expect(component.selectedItemDatasetMissingsProfileId).toBe(4);

    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();
    component.selectedFormat = 'item-matrix';
    component.onSelectedFormatChange();

    expect(component.itemDatasetMissingsProfiles).toEqual([
      { id: 4, label: 'IQB-Standard' }
    ]);
    expect(component.selectedItemDatasetMissingsProfileId).toBe(4);
    expect(component.isExportDisabled).toBe(false);
  });

  it('clears trailing omission recoding for per-task scope', () => {
    component.notReachedScope = 'booklet';
    component.recodeTrailingOmissions = true;
    component.notReachedScope = 'unit';

    component.onNotReachedScopeChange();

    expect(component.recodeTrailingOmissions).toBe(false);
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
    component.onSelectedFormatChange();
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
      'Fatale Zuordnungsprobleme: 3'
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

  it('disables psychometric exports when no VOMD items are mapped', () => {
    component.selectedFormat = 'psychometrics';
    component.selectedPsychometricDomain = 'workspace';
    component.selectedMissingsProfileId = 4;
    component.psychometricItemCount = 0;
    component.psychometricMappingIssueCount = 0;

    fixture.detectChanges();

    expect(component.isExportDisabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Keine auswertbaren VOMD-Items gefunden'
    );
  });

  it('allows unambiguous legacy mappings without presenting a warning', () => {
    component.selectedFormat = 'psychometrics';
    component.selectedPsychometricDomain = 'workspace';
    component.selectedMissingsProfileId = 4;
    component.psychometricItemCount = 23;
    component.psychometricMappingIssueCount = 0;

    fixture.detectChanges();

    expect(component.isExportDisabled).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain(
      'Legacy-Zuordnungen'
    );
  });

  it('finishes loading and reports an error when missing profiles cannot be loaded', () => {
    fixture.destroy();
    getMissingsProfiles.mockReturnValueOnce(
      throwError(() => new Error('profiles failed'))
    );

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();

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
    component.onSelectedFormatChange();
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
      itemCount: number;
      mappingIssueCount: number;
      mappingFallbackCount: number;
      mappingIssuePreview: string[];
      mappingFallbackPreview: string[];
    }>();
    getMissingsProfiles.mockReturnValueOnce(profiles);
    getPsychometricDomainCandidates.mockReturnValueOnce(domains);

    fixture = TestBed.createComponent(ExportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    component.selectedFormat = 'psychometrics';
    component.onSelectedFormatChange();

    expect(component.isLoadingPsychometricOptions).toBe(true);

    profiles.next([{ id: 7, label: 'Profil 7' }]);
    profiles.complete();

    expect(component.isLoadingPsychometricOptions).toBe(true);

    domains.next({
      candidates: [],
      itemCount: 7,
      mappingIssueCount: 0,
      mappingFallbackCount: 1,
      mappingIssuePreview: [],
      mappingFallbackPreview: ['Legacy-Fallback']
    });
    domains.complete();

    expect(component.isLoadingPsychometricOptions).toBe(false);
    expect(component.psychometricOptionsLoadFailed).toBe(false);
    expect(component.missingsProfiles).toEqual([{ id: 7, label: 'Profil 7' }]);
    expect(component.selectedMissingsProfileId).toBe(7);
    expect(component.psychometricItemCount).toBe(7);
    expect(component.psychometricMappingIssueDetails).toBe('');
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
