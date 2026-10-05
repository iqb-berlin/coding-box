import {
  Component, DestroyRef, inject, signal,
  computed, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';

import {
  catchError, forkJoin, map, Observable, of
} from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import {
  ExportJobConfig,
  ExportJobService
} from '../../../shared/services/file/export-job.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { MissingsProfileService } from '../../../coding/services/missings-profile.service';
import type {
  PsychometricDomainCandidatesDto,
  PsychometricDomainCandidateDto,
  PsychometricDomainSelection
} from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import type {
  ItemDatasetNotReachedScope,
  ItemDatasetMappingIssueDto,
  ItemDatasetMappingWarningDto,
  ItemDatasetOption,
  ItemDatasetOptionsDto
} from '../../../../../../../api-dto/coding/export-request.dto';
import {
  ItemDatasetSelectionKey
} from '../../../../../../../api-dto/coding/item-dataset-key';
import {
  ItemDatasetMappingDiagnosticsDialogComponent,
  ItemDatasetMappingSeverity
} from './item-dataset-mapping-diagnostics-dialog.component';

export type ExportFormat =
  'results-by-version' | 'item-matrix' | 'psychometrics';
type ResultsVersion = 'v1' | 'v2' | 'v3';
type ResultsExportFormat = 'csv' | 'excel';
type MatrixValue = 'code' | 'score';
type MissingsProfileOption = { label: string; id: number };
type OptionLoadResult<T> = { ok: true; value: T } | { ok: false };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatDialogModule,
    FormsModule
  ]
})
export class ExportComponent {
  private appService = inject(AppService);
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private responseService = inject(ResponseService);
  private missingsProfileService = inject(MissingsProfileService);
  private destroyRef = inject(DestroyRef);
  private dialog = inject(MatDialog);

  selectedFormat: ExportFormat = 'results-by-version';
  readonly isStartingExport = signal(false);
  readonly includeResponseValues = signal(true);
  readonly includeGeoGebraResponseValues = signal(false);
  readonly includeGeoGebraFiles = signal(false);
  readonly hasGeoGebraResponses = signal(false);
  resultsVersion: ResultsVersion = 'v2';
  resultsFormat: ResultsExportFormat = 'csv';
  matrixValue: MatrixValue = 'score';
  readonly itemDatasetOptions = signal<ItemDatasetOption[]>([]);
  readonly selectedItemKeys = signal<string[]>([]);
  readonly itemSearch = signal('');
  readonly itemDatasetMappingIssues = signal<ItemDatasetMappingIssueDto[]>([]);
  readonly itemDatasetMappingWarnings = signal<ItemDatasetMappingWarningDto[]>([]);
  readonly notReachedScope = signal<ItemDatasetNotReachedScope>('unit');
  readonly recodeTrailingOmissions = signal(false);
  readonly isLoadingItemDatasetOptions = signal(false);
  readonly itemDatasetOptionsLoadFailed = signal(false);
  readonly psychometricDomainCandidates = signal<PsychometricDomainCandidateDto[]>([]);
  readonly psychometricItemCount = signal(0);
  readonly psychometricMappingIssueCount = signal(0);
  readonly psychometricMappingIssueDetails = signal('');
  readonly missingsProfiles = signal<MissingsProfileOption[]>([]);
  readonly itemDatasetMissingsProfiles = signal<MissingsProfileOption[]>([]);
  readonly resultsMissingsProfiles = signal<MissingsProfileOption[]>([]);
  readonly selectedPsychometricDomain = signal('workspace');
  readonly selectedMissingsProfileId = signal<number | null>(null);
  readonly selectedItemDatasetMissingsProfileId = signal<number | null>(null);
  readonly selectedResultsMissingsProfileId = signal<number | null>(null);
  readonly partWholeCorrection = signal(true);
  readonly maxCategoryCount = signal(10);
  readonly isPsychometricInfoExpanded = signal(false);
  readonly isLoadingPsychometricOptions = signal(false);
  readonly psychometricOptionsLoadFailed = signal(false);
  private psychometricOptionsWorkspaceId: number | null = null;
  private loadingPsychometricOptionsWorkspaceId: number | null = null;
  private itemDatasetOptionsWorkspaceId: number | null = null;
  private loadingItemDatasetOptionsWorkspaceId: number | null = null;
  private resultsOptionsWorkspaceId: number | null = null;
  private loadingResultsOptionsWorkspaceId: number | null = null;
  readonly isLoadingResultsOptions = signal(false);
  readonly resultsOptionsLoadFailed = signal(false);

  constructor() {
    this.loadGeneralOptions();
    this.loadResultsOptions();
    this.appService.selectedWorkspaceId$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.resetWorkspaceOptions();
        this.loadGeneralOptions();
        if (this.selectedFormat === 'psychometrics') {
          this.loadPsychometricOptions();
        } else if (this.selectedFormat === 'item-matrix') {
          this.loadItemDatasetOptions();
        } else if (this.selectedFormat === 'results-by-version') {
          this.loadResultsOptions();
        }
      });
  }

  private loadGeneralOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.responseService
      .hasGeogebraResponses(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(hasGeoGebraResponses => {
        if (workspaceId !== this.appService.selectedWorkspaceId) return;
        this.hasGeoGebraResponses.set(hasGeoGebraResponses);
        this.clearUnsupportedResultsOptions();
      });
  }

  private loadPsychometricOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.psychometricOptionsWorkspaceId === workspaceId ||
      this.loadingPsychometricOptionsWorkspaceId === workspaceId
    ) {
      return;
    }

    this.psychometricOptionsLoadFailed.set(false);
    this.isLoadingPsychometricOptions.set(true);
    this.loadingPsychometricOptionsWorkspaceId = workspaceId;
    forkJoin({
      profiles: this.asOptionLoadResult(
        this.missingsProfileService.getMissingsProfilesOrThrow(workspaceId)
      ),
      domains: this.asOptionLoadResult(
        this.exportJobService.getPsychometricDomainCandidates(workspaceId)
      )
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (workspaceId !== this.appService.selectedWorkspaceId) return;
      this.applyMissingsProfileResult(
        result.profiles,
        'ws-admin.export.errors.psychometric-options-failed'
      );
      this.applyDomainCandidateResult(result.domains);
      this.psychometricOptionsLoadFailed.set(!result.profiles.ok || !result.domains.ok);
      this.psychometricOptionsWorkspaceId =
        this.psychometricOptionsLoadFailed() ? null : workspaceId;
      this.loadingPsychometricOptionsWorkspaceId = null;
      this.isLoadingPsychometricOptions.set(false);
    });
  }

  private loadItemDatasetOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.itemDatasetOptionsWorkspaceId === workspaceId ||
      this.loadingItemDatasetOptionsWorkspaceId === workspaceId
    ) {
      return;
    }

    this.itemDatasetOptionsLoadFailed.set(false);
    this.isLoadingItemDatasetOptions.set(true);
    this.loadingItemDatasetOptionsWorkspaceId = workspaceId;
    forkJoin({
      profiles: this.asOptionLoadResult(
        this.missingsProfileService.getMissingsProfilesOrThrow(workspaceId)
      ),
      items: this.asOptionLoadResult(
        this.exportJobService.getItemDatasetOptions(workspaceId)
      )
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (workspaceId !== this.appService.selectedWorkspaceId) return;
      this.applyMissingsProfileResult(
        result.profiles,
        'ws-admin.export.errors.item-dataset-options-failed',
        'item-dataset',
        false
      );
      this.applyItemDatasetOptionsResult(result.items);
      this.itemDatasetOptionsLoadFailed.set(!result.profiles.ok || !result.items.ok);
      this.itemDatasetOptionsWorkspaceId =
        this.itemDatasetOptionsLoadFailed() ? null : workspaceId;
      this.loadingItemDatasetOptionsWorkspaceId = null;
      this.isLoadingItemDatasetOptions.set(false);
    });
  }

  private loadResultsOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (
      !workspaceId ||
      this.resultsOptionsWorkspaceId === workspaceId ||
      this.loadingResultsOptionsWorkspaceId === workspaceId
    ) {
      return;
    }
    this.resultsOptionsLoadFailed.set(false);
    this.isLoadingResultsOptions.set(true);
    this.loadingResultsOptionsWorkspaceId = workspaceId;
    this.missingsProfileService.getExportMissingsProfilesOrThrow(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: profiles => {
          if (workspaceId !== this.appService.selectedWorkspaceId) return;
          this.resultsMissingsProfiles.set(profiles.filter(profile => (Number.isSafeInteger(profile.id) && profile.id > 0)));
          const standard = this.resultsMissingsProfiles().find(profile => (
            profile.label === 'IQB-Standard'
          ));
          this.selectedResultsMissingsProfileId.set(standard?.id ??
    this.resultsMissingsProfiles()[0]?.id ?? null);
          this.resultsOptionsWorkspaceId = workspaceId;
          this.loadingResultsOptionsWorkspaceId = null;
          this.isLoadingResultsOptions.set(false);
        },
        error: () => {
          if (workspaceId !== this.appService.selectedWorkspaceId) return;
          this.resultsMissingsProfiles.set([]);
          this.selectedResultsMissingsProfileId.set(null);
          this.resultsOptionsLoadFailed.set(true);
          this.resultsOptionsWorkspaceId = null;
          this.loadingResultsOptionsWorkspaceId = null;
          this.isLoadingResultsOptions.set(false);
          this.showPsychometricOptionsError(
            'ws-admin.export.errors.results-options-failed'
          );
        }
      });
  }

  private resetWorkspaceOptions(): void {
    this.hasGeoGebraResponses.set(false);
    this.psychometricDomainCandidates.set([]);
    this.psychometricItemCount.set(0);
    this.psychometricMappingIssueCount.set(0);
    this.psychometricMappingIssueDetails.set('');
    this.missingsProfiles.set([]);
    this.itemDatasetMissingsProfiles.set([]);
    this.resultsMissingsProfiles.set([]);
    this.selectedPsychometricDomain.set('workspace');
    this.selectedMissingsProfileId.set(null);
    this.selectedItemDatasetMissingsProfileId.set(null);
    this.selectedResultsMissingsProfileId.set(null);
    this.itemDatasetOptions.set([]);
    this.selectedItemKeys.set([]);
    this.itemSearch.set('');
    this.itemDatasetMappingIssues.set([]);
    this.itemDatasetMappingWarnings.set([]);
    this.notReachedScope.set('unit');
    this.recodeTrailingOmissions.set(false);
    this.isLoadingItemDatasetOptions.set(false);
    this.itemDatasetOptionsLoadFailed.set(false);
    this.itemDatasetOptionsWorkspaceId = null;
    this.loadingItemDatasetOptionsWorkspaceId = null;
    this.isLoadingPsychometricOptions.set(false);
    this.psychometricOptionsLoadFailed.set(false);
    this.psychometricOptionsWorkspaceId = null;
    this.loadingPsychometricOptionsWorkspaceId = null;
    this.isLoadingResultsOptions.set(false);
    this.resultsOptionsLoadFailed.set(false);
    this.resultsOptionsWorkspaceId = null;
    this.loadingResultsOptionsWorkspaceId = null;
    this.clearUnsupportedResultsOptions();
  }

  onResultsFormatChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onSelectedFormatChange(): void {
    this.clearUnsupportedResultsOptions();
    if (this.selectedFormat === 'psychometrics') {
      this.loadPsychometricOptions();
    } else if (this.selectedFormat === 'item-matrix') {
      this.loadItemDatasetOptions();
    } else if (this.selectedFormat === 'results-by-version') {
      this.loadResultsOptions();
    }
  }

  onResultsVersionChange(): void {
    this.loadResultsOptions();
  }

  onNotReachedScopeChange(): void {
    if (this.notReachedScope() === 'unit') {
      this.recodeTrailingOmissions.set(false);
    }
  }

  onIncludeResponseValuesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  onIncludeGeoGebraFilesChange(): void {
    this.clearUnsupportedResultsOptions();
  }

  private clearUnsupportedResultsOptions(): void {
    if (
      this.selectedFormat !== 'results-by-version' ||
      this.resultsFormat !== 'excel' ||
      !this.includeResponseValues() ||
      !this.hasGeoGebraResponses()
    ) {
      this.includeGeoGebraFiles.set(false);
    }

    if (
      this.selectedFormat !== 'results-by-version' ||
      !this.includeResponseValues() ||
      !this.hasGeoGebraResponses() ||
      this.includeGeoGebraFiles()
    ) {
      this.includeGeoGebraResponseValues.set(false);
    }
  }

  onExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translateService.instant('ws-admin.export.errors.no-workspace'),
        this.translateService.instant('close'),
        { duration: 5000 }
      );
      return;
    }

    if (this.isExportDisabled) {
      return;
    }

    this.isStartingExport.set(true);

    this.exportJobService
      .startJob(workspaceId, this.buildExportConfig()).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant('ws-admin.export.job-started'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          this.isStartingExport.set(false);
        },
        error: () => {
          this.isStartingExport.set(false);
        }
      });
  }

  private buildExportConfig(): ExportJobConfig {
    if (this.selectedFormat === 'item-matrix') {
      return {
        exportType: 'item-matrix',
        userId: this.appService.userId,
        version: this.resultsVersion,
        format: this.resultsFormat,
        matrixValue: this.matrixValue,
        missingsProfileId: this.selectedItemDatasetMissingsProfileId()!,
        notReachedScope: this.notReachedScope(),
        recodeTrailingOmissions: this.recodeTrailingOmissions(),
        items: this.selectedItemKeys().map(key => {
          const selectionKey = ItemDatasetSelectionKey.parse(key);
          return {
            unitId: selectionKey?.unitId || '',
            itemId: selectionKey?.itemId || ''
          };
        }),
        displayLabelKey: 'export-toast.types.item-matrix',
        downloadFilePrefix: 'Itemdatensatz'
      };
    }

    if (this.selectedFormat === 'psychometrics') {
      return {
        exportType: 'psychometrics',
        userId: this.appService.userId,
        version: this.resultsVersion,
        format: this.resultsFormat,
        partWholeCorrection: this.partWholeCorrection(),
        missingsProfileId: this.selectedMissingsProfileId() || undefined,
        domain: this.getPsychometricDomainSelection(),
        maxCategoryCount: this.maxCategoryCount()
      };
    }

    return {
      exportType: this.selectedFormat,
      userId: this.appService.userId,
      includeReplayUrl: false,
      version: this.resultsVersion,
      format: this.resultsFormat,
      includeResponseValues: this.includeResponseValues(),
      includeGeoGebraResponseValues: this.includeGeoGebraResponseValues(),
      includeGeoGebraFiles: this.includeGeoGebraFiles(),
      missingsProfileId: this.selectedResultsMissingsProfileId()!
    };
  }

  get isExportDisabled(): boolean {
    if (this.isStartingExport()) {
      return true;
    }
    if (this.selectedFormat === 'item-matrix') {
      return this.isLoadingItemDatasetOptions() ||
        this.itemDatasetOptionsLoadFailed() ||
        this.selectedItemDatasetMissingsProfileId() === null ||
        this.itemDatasetOptions().length === 0 ||
        this.selectedItemKeys().length === 0 ||
        this.itemDatasetMappingIssues().length > 0;
    }
    if (this.selectedFormat === 'results-by-version') {
      return (
        this.isLoadingResultsOptions() ||
        this.resultsOptionsLoadFailed() ||
        this.selectedResultsMissingsProfileId() === null
      );
    }
    if (this.selectedFormat !== 'psychometrics') {
      return false;
    }
    if (
      this.isLoadingPsychometricOptions() ||
      this.psychometricOptionsLoadFailed() ||
      this.selectedMissingsProfileId() === null ||
      this.psychometricItemCount() === 0 ||
      !Number.isSafeInteger(this.maxCategoryCount()) ||
      this.maxCategoryCount() < 1 ||
      this.maxCategoryCount() > 100
    ) {
      return true;
    }
    if (this.psychometricMappingIssueCount() > 0) {
      return true;
    }
    if (this.selectedPsychometricDomain() === 'workspace') {
      return false;
    }
    return !this.getSelectedDomainCandidate()?.selectable;
  }

  getPsychometricDomainKey(candidate: PsychometricDomainCandidateDto): string {
    return [candidate.scope, candidate.profileId, candidate.entryId].join(
      '\u001F'
    );
  }

  readonly filteredItemDatasetOptions = computed<ItemDatasetOption[]>(() => {
    const search = this.itemSearch().trim().toLocaleLowerCase();
    if (!search) {
      return this.itemDatasetOptions();
    }
    return this.itemDatasetOptions().filter(item => (
      item.columnName.toLocaleLowerCase().includes(search) ||
      item.itemLabel.toLocaleLowerCase().includes(search)
    ));
  });

  getItemDatasetKey(item: ItemDatasetOption): string {
    return ItemDatasetSelectionKey
      .from(item.unitId, item.itemId)
      .toString();
  }

  onItemDatasetSelectionChange(selectedVisibleKeys: string[]): void {
    const visibleKeys = new Set(
      this.filteredItemDatasetOptions().map(item => this.getItemDatasetKey(item))
    );
    const selectedVisible = new Set(selectedVisibleKeys);
    const previouslySelected = new Set(this.selectedItemKeys());
    this.selectedItemKeys.set(this.itemDatasetOptions().map(item => this.getItemDatasetKey(item))
      .filter(key => (visibleKeys.has(key) ?
        selectedVisible.has(key) :
        previouslySelected.has(key))));
  }

  selectAllItemDatasetItems(): void {
    this.selectedItemKeys.set(this.itemDatasetOptions().map(item => (this.getItemDatasetKey(item))));
  }

  clearAllItemDatasetItems(): void {
    this.selectedItemKeys.set([]);
  }

  selectFilteredItemDatasetItems(): void {
    const selected = new Set(this.selectedItemKeys());
    this.filteredItemDatasetOptions().forEach(item => (
      selected.add(this.getItemDatasetKey(item))
    ));
    this.selectedItemKeys.set(this.itemDatasetOptions().map(item => this.getItemDatasetKey(item))
      .filter(key => selected.has(key)));
  }

  clearFilteredItemDatasetItems(): void {
    const filtered = new Set(this.filteredItemDatasetOptions().map(item => (
      this.getItemDatasetKey(item)
    )));
    this.selectedItemKeys.set(this.selectedItemKeys().filter(key => (!filtered.has(key))));
  }

  openItemDatasetMappingDiagnostics(
    severity: ItemDatasetMappingSeverity
  ): void {
    const diagnostics = severity === 'warning' ?
      this.itemDatasetMappingWarnings() : this.itemDatasetMappingIssues();
    if (diagnostics.length === 0) return;
    this.dialog.open(ItemDatasetMappingDiagnosticsDialogComponent, {
      data: { severity, diagnostics },
      maxWidth: '95vw',
      maxHeight: '75vh',
      restoreFocus: true,
      width: '1000px'
    });
  }

  private getSelectedDomainCandidate():
  PsychometricDomainCandidateDto | undefined {
    return this.psychometricDomainCandidates().find(
      candidate => this.getPsychometricDomainKey(candidate) ===
        this.selectedPsychometricDomain()
    );
  }

  private getPsychometricDomainSelection(): PsychometricDomainSelection {
    const candidate = this.getSelectedDomainCandidate();
    if (this.selectedPsychometricDomain() === 'workspace' || !candidate) {
      return { mode: 'workspace' };
    }
    return {
      mode: 'vomd-field',
      scope: candidate.scope,
      profileId: candidate.profileId,
      entryId: candidate.entryId
    };
  }

  private applyMissingsProfileResult(
    result: OptionLoadResult<MissingsProfileOption[]>,
    errorMessageKey: string,
    target: 'psychometric' | 'item-dataset' = 'psychometric',
    selectFirstWhenStandardIsMissing = true
  ): void {
    const getSelectedProfileId = (): number | null => (
      target === 'item-dataset' ?
        this.selectedItemDatasetMissingsProfileId() :
        this.selectedMissingsProfileId()
    );
    const setSelectedProfileId = (profileId: number | null): void => {
      if (target === 'item-dataset') {
        this.selectedItemDatasetMissingsProfileId.set(profileId);
      } else {
        this.selectedMissingsProfileId.set(profileId);
      }
    };
    const setProfiles = (profiles: MissingsProfileOption[]): void => {
      if (target === 'item-dataset') {
        this.itemDatasetMissingsProfiles.set(profiles);
      } else {
        this.missingsProfiles.set(profiles);
      }
    };

    if (result.ok) {
      setProfiles(result.value);
      if (
        getSelectedProfileId() !== null &&
        !result.value.some(
          profile => profile.id === getSelectedProfileId()
        )
      ) {
        setSelectedProfileId(null);
      }
      if (getSelectedProfileId() === null && result.value.length > 0) {
        const isStandardProfile = (profile: MissingsProfileOption) => (
          profile.label === 'IQB-Standard'
        );
        const standardProfile = result.value.find(isStandardProfile);
        setSelectedProfileId(
          standardProfile?.id ||
          (selectFirstWhenStandardIsMissing ? result.value[0].id : null)
        );
      }
      return;
    }

    setProfiles([]);
    setSelectedProfileId(null);
    this.showPsychometricOptionsError(errorMessageKey);
  }

  private applyDomainCandidateResult(
    result: OptionLoadResult<PsychometricDomainCandidatesDto>
  ): void {
    if (result.ok) {
      this.psychometricDomainCandidates.set(result.value.candidates);
      this.psychometricItemCount.set(result.value.itemCount);
      this.psychometricMappingIssueCount.set(result.value.mappingIssueCount);
      this.psychometricMappingIssueDetails.set(result.value.mappingIssuePreview.join('\n'));
      return;
    }

    this.psychometricDomainCandidates.set([]);
    this.psychometricItemCount.set(0);
    this.psychometricMappingIssueCount.set(0);
    this.psychometricMappingIssueDetails.set('');
    this.showPsychometricOptionsError(
      'ws-admin.export.errors.psychometric-domain-options-failed'
    );
  }

  private applyItemDatasetOptionsResult(
    result: OptionLoadResult<ItemDatasetOptionsDto>
  ): void {
    if (result.ok) {
      this.itemDatasetOptions.set(result.value.items);
      this.itemDatasetMappingIssues.set(result.value.mappingIssues);
      this.itemDatasetMappingWarnings.set(result.value.mappingWarnings || []);
      this.selectedItemKeys.set(result.value.items.map(item => (this.getItemDatasetKey(item))));
      return;
    }
    this.itemDatasetOptions.set([]);
    this.selectedItemKeys.set([]);
    this.itemDatasetMappingIssues.set([]);
    this.itemDatasetMappingWarnings.set([]);
    this.showPsychometricOptionsError(
      'ws-admin.export.errors.item-dataset-options-failed'
    );
  }

  private asOptionLoadResult<T>(
    request: Observable<T>
  ): Observable<OptionLoadResult<T>> {
    return request.pipe(
      map((value): OptionLoadResult<T> => ({
        ok: true,
        value
      })),
      catchError(() => of<OptionLoadResult<T>>({ ok: false }))
    );
  }

  private showPsychometricOptionsError(messageKey: string): void {
    this.snackBar.open(
      this.translateService.instant(messageKey),
      this.translateService.instant('close'),
      { duration: 5000 }
    );
  }
}
