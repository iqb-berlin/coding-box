import { Component, DestroyRef, inject } from '@angular/core';
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
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
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

export type ExportFormat =
  'results-by-version' | 'item-matrix' | 'psychometrics';
type ResultsVersion = 'v1' | 'v2' | 'v3';
type ResultsExportFormat = 'csv' | 'excel';
type MatrixValue = 'code' | 'score';
type MissingsProfileOption = { label: string; id: number };
type OptionLoadResult<T> = { ok: true; value: T } | { ok: false };

@Component({
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
    FormsModule,
    CommonModule
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

  selectedFormat: ExportFormat = 'results-by-version';
  isStartingExport = false;
  includeResponseValues = true;
  includeGeoGebraResponseValues = false;
  includeGeoGebraFiles = false;
  hasGeoGebraResponses = false;
  resultsVersion: ResultsVersion = 'v2';
  resultsFormat: ResultsExportFormat = 'csv';
  matrixValue: MatrixValue = 'score';
  itemDatasetOptions: ItemDatasetOption[] = [];
  selectedItemKeys: string[] = [];
  itemSearch = '';
  itemDatasetMappingIssues: ItemDatasetMappingIssueDto[] = [];
  itemDatasetMappingWarnings: ItemDatasetMappingWarningDto[] = [];
  notReachedScope: ItemDatasetNotReachedScope = 'unit';
  recodeTrailingOmissions = false;
  isLoadingItemDatasetOptions = false;
  itemDatasetOptionsLoadFailed = false;
  psychometricDomainCandidates: PsychometricDomainCandidateDto[] = [];
  psychometricItemCount = 0;
  psychometricMappingIssueCount = 0;
  psychometricMappingIssueDetails = '';
  missingsProfiles: MissingsProfileOption[] = [];
  itemDatasetMissingsProfiles: MissingsProfileOption[] = [];
  selectedPsychometricDomain = 'workspace';
  selectedMissingsProfileId: number | null = null;
  selectedItemDatasetMissingsProfileId: number | null = null;
  partWholeCorrection = true;
  maxCategoryCount = 10;
  isPsychometricInfoExpanded = false;
  isLoadingPsychometricOptions = false;
  psychometricOptionsLoadFailed = false;
  private psychometricOptionsWorkspaceId: number | null = null;
  private loadingPsychometricOptionsWorkspaceId: number | null = null;
  private itemDatasetOptionsWorkspaceId: number | null = null;
  private loadingItemDatasetOptionsWorkspaceId: number | null = null;

  constructor() {
    this.loadGeneralOptions();
    this.appService.selectedWorkspaceId$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.resetWorkspaceOptions();
        this.loadGeneralOptions();
        if (this.selectedFormat === 'psychometrics') {
          this.loadPsychometricOptions();
        } else if (this.selectedFormat === 'item-matrix') {
          this.loadItemDatasetOptions();
        }
      });
  }

  private loadGeneralOptions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.responseService
      .hasGeogebraResponses(workspaceId)
      .subscribe(hasGeoGebraResponses => {
        if (workspaceId !== this.appService.selectedWorkspaceId) return;
        this.hasGeoGebraResponses = hasGeoGebraResponses;
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

    this.psychometricOptionsLoadFailed = false;
    this.isLoadingPsychometricOptions = true;
    this.loadingPsychometricOptionsWorkspaceId = workspaceId;
    forkJoin({
      profiles: this.asOptionLoadResult(
        this.missingsProfileService.getMissingsProfilesOrThrow(workspaceId)
      ),
      domains: this.asOptionLoadResult(
        this.exportJobService.getPsychometricDomainCandidates(workspaceId)
      )
    }).subscribe(result => {
      if (workspaceId !== this.appService.selectedWorkspaceId) return;
      this.applyMissingsProfileResult(
        result.profiles,
        'ws-admin.export.errors.psychometric-options-failed'
      );
      this.applyDomainCandidateResult(result.domains);
      this.psychometricOptionsLoadFailed =
        !result.profiles.ok || !result.domains.ok;
      this.psychometricOptionsWorkspaceId =
        this.psychometricOptionsLoadFailed ? null : workspaceId;
      this.loadingPsychometricOptionsWorkspaceId = null;
      this.isLoadingPsychometricOptions = false;
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

    this.itemDatasetOptionsLoadFailed = false;
    this.isLoadingItemDatasetOptions = true;
    this.loadingItemDatasetOptionsWorkspaceId = workspaceId;
    forkJoin({
      profiles: this.asOptionLoadResult(
        this.missingsProfileService.getMissingsProfilesOrThrow(workspaceId)
      ),
      items: this.asOptionLoadResult(
        this.exportJobService.getItemDatasetOptions(workspaceId)
      )
    }).subscribe(result => {
      if (workspaceId !== this.appService.selectedWorkspaceId) return;
      this.applyMissingsProfileResult(
        result.profiles,
        'ws-admin.export.errors.item-dataset-options-failed',
        'item-dataset',
        false
      );
      this.applyItemDatasetOptionsResult(result.items);
      this.itemDatasetOptionsLoadFailed =
        !result.profiles.ok || !result.items.ok;
      this.itemDatasetOptionsWorkspaceId =
        this.itemDatasetOptionsLoadFailed ? null : workspaceId;
      this.loadingItemDatasetOptionsWorkspaceId = null;
      this.isLoadingItemDatasetOptions = false;
    });
  }

  private resetWorkspaceOptions(): void {
    this.hasGeoGebraResponses = false;
    this.psychometricDomainCandidates = [];
    this.psychometricItemCount = 0;
    this.psychometricMappingIssueCount = 0;
    this.psychometricMappingIssueDetails = '';
    this.missingsProfiles = [];
    this.itemDatasetMissingsProfiles = [];
    this.selectedPsychometricDomain = 'workspace';
    this.selectedMissingsProfileId = null;
    this.selectedItemDatasetMissingsProfileId = null;
    this.itemDatasetOptions = [];
    this.selectedItemKeys = [];
    this.itemSearch = '';
    this.itemDatasetMappingIssues = [];
    this.itemDatasetMappingWarnings = [];
    this.notReachedScope = 'unit';
    this.recodeTrailingOmissions = false;
    this.isLoadingItemDatasetOptions = false;
    this.itemDatasetOptionsLoadFailed = false;
    this.itemDatasetOptionsWorkspaceId = null;
    this.loadingItemDatasetOptionsWorkspaceId = null;
    this.isLoadingPsychometricOptions = false;
    this.psychometricOptionsLoadFailed = false;
    this.psychometricOptionsWorkspaceId = null;
    this.loadingPsychometricOptionsWorkspaceId = null;
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
    }
  }

  onNotReachedScopeChange(): void {
    if (this.notReachedScope === 'unit') {
      this.recodeTrailingOmissions = false;
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
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses
    ) {
      this.includeGeoGebraFiles = false;
    }

    if (
      this.selectedFormat !== 'results-by-version' ||
      !this.includeResponseValues ||
      !this.hasGeoGebraResponses ||
      this.includeGeoGebraFiles
    ) {
      this.includeGeoGebraResponseValues = false;
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

    this.isStartingExport = true;

    this.exportJobService
      .startJob(workspaceId, this.buildExportConfig())
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant('ws-admin.export.job-started'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
          this.isStartingExport = false;
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant(
              'ws-admin.export.errors.start-failed'
            ),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
          this.isStartingExport = false;
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
        missingsProfileId: this.selectedItemDatasetMissingsProfileId!,
        notReachedScope: this.notReachedScope,
        recodeTrailingOmissions: this.recodeTrailingOmissions,
        items: this.selectedItemKeys.map(key => {
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
        partWholeCorrection: this.partWholeCorrection,
        missingsProfileId: this.selectedMissingsProfileId || undefined,
        domain: this.getPsychometricDomainSelection(),
        maxCategoryCount: this.maxCategoryCount
      };
    }

    return {
      exportType: this.selectedFormat,
      userId: this.appService.userId,
      includeReplayUrl: false,
      version: this.resultsVersion,
      format: this.resultsFormat,
      includeResponseValues: this.includeResponseValues,
      includeGeoGebraResponseValues: this.includeGeoGebraResponseValues,
      includeGeoGebraFiles: this.includeGeoGebraFiles
    };
  }

  get isExportDisabled(): boolean {
    if (this.isStartingExport) {
      return true;
    }
    if (this.selectedFormat === 'item-matrix') {
      return this.isLoadingItemDatasetOptions ||
        this.itemDatasetOptionsLoadFailed ||
        this.selectedItemDatasetMissingsProfileId === null ||
        this.itemDatasetOptions.length === 0 ||
        this.selectedItemKeys.length === 0 ||
        this.itemDatasetMappingIssues.length > 0;
    }
    if (this.selectedFormat !== 'psychometrics') {
      return false;
    }
    if (
      this.isLoadingPsychometricOptions ||
      this.psychometricOptionsLoadFailed ||
      this.selectedMissingsProfileId === null ||
      this.psychometricItemCount === 0 ||
      !Number.isSafeInteger(this.maxCategoryCount) ||
      this.maxCategoryCount < 1 ||
      this.maxCategoryCount > 100
    ) {
      return true;
    }
    if (this.psychometricMappingIssueCount > 0) {
      return true;
    }
    if (this.selectedPsychometricDomain === 'workspace') {
      return false;
    }
    return !this.getSelectedDomainCandidate()?.selectable;
  }

  getPsychometricDomainKey(candidate: PsychometricDomainCandidateDto): string {
    return [candidate.scope, candidate.profileId, candidate.entryId].join(
      '\u001F'
    );
  }

  get filteredItemDatasetOptions(): ItemDatasetOption[] {
    const search = this.itemSearch.trim().toLocaleLowerCase();
    if (!search) {
      return this.itemDatasetOptions;
    }
    return this.itemDatasetOptions.filter(item => (
      item.columnName.toLocaleLowerCase().includes(search) ||
      item.itemLabel.toLocaleLowerCase().includes(search)
    ));
  }

  getItemDatasetKey(item: ItemDatasetOption): string {
    return ItemDatasetSelectionKey
      .from(item.unitId, item.itemId)
      .toString();
  }

  onItemDatasetSelectionChange(selectedVisibleKeys: string[]): void {
    const visibleKeys = new Set(
      this.filteredItemDatasetOptions.map(item => this.getItemDatasetKey(item))
    );
    const selectedVisible = new Set(selectedVisibleKeys);
    const previouslySelected = new Set(this.selectedItemKeys);
    this.selectedItemKeys = this.itemDatasetOptions
      .map(item => this.getItemDatasetKey(item))
      .filter(key => (
        visibleKeys.has(key) ?
          selectedVisible.has(key) :
          previouslySelected.has(key)
      ));
  }

  private getSelectedDomainCandidate():
  PsychometricDomainCandidateDto | undefined {
    return this.psychometricDomainCandidates.find(
      candidate => this.getPsychometricDomainKey(candidate) ===
        this.selectedPsychometricDomain
    );
  }

  private getPsychometricDomainSelection(): PsychometricDomainSelection {
    const candidate = this.getSelectedDomainCandidate();
    if (this.selectedPsychometricDomain === 'workspace' || !candidate) {
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
        this.selectedItemDatasetMissingsProfileId :
        this.selectedMissingsProfileId
    );
    const setSelectedProfileId = (profileId: number | null): void => {
      if (target === 'item-dataset') {
        this.selectedItemDatasetMissingsProfileId = profileId;
      } else {
        this.selectedMissingsProfileId = profileId;
      }
    };
    const setProfiles = (profiles: MissingsProfileOption[]): void => {
      if (target === 'item-dataset') {
        this.itemDatasetMissingsProfiles = profiles;
      } else {
        this.missingsProfiles = profiles;
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
      this.psychometricDomainCandidates = result.value.candidates;
      this.psychometricItemCount = result.value.itemCount;
      this.psychometricMappingIssueCount = result.value.mappingIssueCount;
      this.psychometricMappingIssueDetails =
        result.value.mappingIssuePreview.join('\n');
      return;
    }

    this.psychometricDomainCandidates = [];
    this.psychometricItemCount = 0;
    this.psychometricMappingIssueCount = 0;
    this.psychometricMappingIssueDetails = '';
    this.showPsychometricOptionsError(
      'ws-admin.export.errors.psychometric-domain-options-failed'
    );
  }

  private applyItemDatasetOptionsResult(
    result: OptionLoadResult<ItemDatasetOptionsDto>
  ): void {
    if (result.ok) {
      this.itemDatasetOptions = result.value.items;
      this.itemDatasetMappingIssues = result.value.mappingIssues;
      this.itemDatasetMappingWarnings = result.value.mappingWarnings || [];
      this.selectedItemKeys = result.value.items.map(item => (
        this.getItemDatasetKey(item)
      ));
      return;
    }
    this.itemDatasetOptions = [];
    this.selectedItemKeys = [];
    this.itemDatasetMappingIssues = [];
    this.itemDatasetMappingWarnings = [];
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
