import {
  Component, OnInit, OnDestroy, AfterViewInit, inject, HostListener, signal, viewChild, effect, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Subject, debounceTime, forkJoin, of, catchError, finalize, takeUntil, map, Observable, switchMap
} from 'rxjs';
import {
  MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog
} from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';

import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { CommonModule } from '@angular/common';

import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { CodingResult, createCodingResultFilter, createCodingResultSorter } from './coding-job-result-table';
import { injectUiTranslator } from '../../../../shared/utils/ui-translator';
import { FileService } from '../../../../shared/services/file/file.service';
import { CodingJobBackendService } from '../../../services/coding-job-backend.service';
import { MissingsProfileService } from '../../../services/missings-profile.service';
import { CodingJob } from '../../../models/coding-job.model';
import { SchemeEditorDialogComponent } from '../../scheme-editor-dialog/scheme-editor-dialog.component';
import { base64ToUtf8, utf8ToBase64 } from '../../../../shared/utils/common-utils';
import { MissingDto, MissingsProfilesDto } from '../../../../../../../../api-dto/coding/missings-profiles.dto';
import {
  ApplyCodingResultsDialogComponent,
  ApplyCodingResultsDialogResult
} from '../apply-coding-results-dialog.component';

import { UnitsReplay, UnitsReplayUnit } from '../../../../replay/services/units-replay.service';

interface CodingProgressEntry {
  id?: string | number;
  label?: string;
  score?: number | null;
  codingIssueOption?: number;
}

interface CodingJobUnitResult {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  variablePage?: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  isDoubleCoded: boolean;
  otherCoders: string[];
}

interface ResolvedMissingPreview {
  code: number;
  score: number | null;
  label?: string;
}

interface MissingPreviewLookup {
  byIssueOption: Map<number, ResolvedMissingPreview>;
  byCode: Map<number, ResolvedMissingPreview>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-job-result-dialog',
  templateUrl: './coding-job-result-dialog.component.html',
  styleUrls: ['./coding-job-result-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    MatDialogModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    MatProgressSpinner,
    MatButtonModule,
    MatIcon,
    MatTooltip
  ]
})
export class CodingJobResultDialogComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly uiTranslate = injectUiTranslator();

  dialogRef = inject<MatDialogRef<CodingJobResultDialogComponent>>(MatDialogRef);
  data = inject<{
    codingJob: CodingJob;
    workspaceId: number;
    canApplyResults?: boolean;
    canEdit?: boolean;
  }>(MAT_DIALOG_DATA);

  private readonly destroyRef = inject(DestroyRef);

  readonly sort = viewChild(MatSort);
  readonly paginator = viewChild(MatPaginator);

  private codingJobBackendService = inject(CodingJobBackendService);
  private missingsProfileService = inject(MissingsProfileService);
  private fileService = inject(FileService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  readonly isLoading = signal(true);
  readonly isNotesUnavailable = signal(false);
  protected readonly isMissingProfileUnavailable = signal(false);
  dataSource = new MatTableDataSource<CodingResult>([]);
  protected displayedColumns: string[] = [
    'unitName',
    'testPerson',
    'variableId',
    'code',
    'score',
    'codingIssueOption',
    'doubleCoding',
    'notes',
    'actions'
  ];

  private refreshSubject = new Subject<void>();
  private destroy$ = new Subject<void>();
  private hasAppliedResults = false;
  private readonly defaultMissingProfileLabel = 'IQB-Standard';
  private readonly manualMissingIdsByIssueOptionId = new Map<number, string>([
    [-3, 'mir'],
    [-4, 'mci']
  ]);

  protected readonly pageSize = 50;
  protected readonly pageSizeOptions = [25, 50, 100];

  protected readonly unitNameFilter = signal('');
  protected readonly variableFilter = signal('');
  protected readonly codingIssueFilter = signal('');
  readonly testPersonFilter = signal('');

  ngOnInit(): void {
    this.loadCodingResults();
    this.setupAutoRefresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.refreshSubject.complete();
  }

  closeDialog(): void {
    this.dialogRef.close(
      this.hasAppliedResults ? { resultsApplied: true } : undefined
    );
  }

  private setupAutoRefresh(): void {
    this.refreshSubject.pipe(
      debounceTime(1000),
      takeUntil(this.destroy$)
    ).subscribe(() => this.loadCodingResults());
  }

  @HostListener('window:focus')
  onWindowFocus(): void {
    this.refreshSubject.next();
  }

  private readonly synchronizeTable = effect(() => {
    this.dataSource.sort = this.sort() ?? null;
    this.dataSource.paginator = this.paginator() ?? null;
  });

  ngAfterViewInit(): void {
    this.dataSource.sortingDataAccessor = this.createSortingDataAccessor();
    this.dataSource.filterPredicate = this.createFilterPredicate();
    this.applyFilters();
  }

  loadCodingResults(): void {
    this.isLoading.set(true);
    this.isNotesUnavailable.set(false);
    this.isMissingProfileUnavailable.set(false);

    forkJoin({
      units: this.codingJobBackendService.getCodingJobUnits(this.data.workspaceId, this.data.codingJob.id),
      progress: this.codingJobBackendService.getCodingProgress(this.data.workspaceId, this.data.codingJob.id),
      missingProfile: this.getMissingProfileForJob(),
      notes: this.codingJobBackendService.getCodingNotes(this.data.workspaceId, this.data.codingJob.id).pipe(
        catchError(() => {
          this.isNotesUnavailable.set(true);
          this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.notizen-konnten-nicht-geladen-werden-ergebnisse-werden-trotzdem-angezeigt'), this.uiTranslate('deferred-view.close'), { duration: 4000 });
          return of({});
        })
      )
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => {
        this.isLoading.set(false);
      })
    ).subscribe({
      next: ({
        units, progress, notes, missingProfile
      }) => {
        const missingPreviewLookup = this.getMissingPreviewLookup(missingProfile);
        this.dataSource.data = (units || []).map(unit => this.mapCodingResult(
          unit as CodingJobUnitResult,
          progress as Record<string, CodingProgressEntry>,
          notes as Record<string, string>,
          missingPreviewLookup
        ));
        this.isMissingProfileUnavailable.set(this.getUnresolvedMissingCount() > 0);
        this.applyFilters();
        this.paginator()?.firstPage();
      },
      error: () => {
        this.dataSource.data = [];
        this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.fehler-beim-laden-der-kodierergebnisse'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      }
    });
  }

  private mapCodingResult(
    unit: CodingJobUnitResult,
    progressResult: Record<string, CodingProgressEntry>,
    notesResult: Record<string, string>,
    missingPreviewLookup: MissingPreviewLookup
  ): CodingResult {
    const progressKey = this.getCodingProgressKey(unit);
    const progress = progressResult[progressKey];
    const notes = notesResult ? notesResult[progressKey] : undefined;
    const mappedCode = this.getMappedResultCode(progress, missingPreviewLookup);
    const mappedScore = this.getMappedResultScore(progress, missingPreviewLookup);
    const reviewIssueOption = this.getReviewIssueOption(progress);
    const testPerson = this.getTestPersonLabel(unit);
    const otherCoders = (unit.otherCoders || []).filter(Boolean);
    const progressCode = this.toNumericCode(progress?.id);
    const missingPreview = this.getMissingPreviewForProgressCode(progressCode, missingPreviewLookup);
    const unresolvedMissing = this.isMissingProgressCode(progressCode) && !missingPreview;

    return {
      unitName: unit.unitName,
      unitAlias: unit.unitAlias,
      variableId: unit.variableId,
      variableAnchor: unit.variableAnchor,
      variablePage: unit.variablePage,
      bookletName: unit.bookletName,
      personLogin: unit.personLogin,
      personCode: unit.personCode,
      personGroup: unit.personGroup,
      testPerson,
      testPersonSearch: [
        testPerson,
        unit.personLogin,
        unit.personCode,
        unit.personGroup,
        unit.bookletName
      ].filter(Boolean).join(' '),
      code: mappedCode,
      codeLabel: missingPreview?.label ?? progress?.label,
      score: mappedScore,
      codingIssueOption: reviewIssueOption ?? undefined,
      codingIssueOptionLabel: reviewIssueOption !== null ? this.getCodingIssueOption(reviewIssueOption) : undefined,
      givenCode: reviewIssueOption !== null && progress?.id && this.isPositiveCode(progress.id) ? progress.id : undefined,
      givenScore: reviewIssueOption !== null && progress?.score !== undefined && progress?.score !== null ? progress.score : undefined,
      notes: notes,
      isDoubleCoded: otherCoders.length > 0,
      otherCoders,
      unresolvedMissing
    };
  }

  private getMissingProfileForJob(): Observable<MissingsProfilesDto | null> {
    if (this.data.codingJob.missings_profile) {
      return of(this.toMissingProfileDto(this.data.codingJob.missings_profile));
    }

    const profileId = this.data.codingJob.missings_profile_id ?? this.data.codingJob.missingsProfileId;
    if (profileId && profileId > 0) {
      return this.missingsProfileService.getMissingsProfileDetails(this.data.workspaceId, profileId);
    }

    return this.missingsProfileService.getMissingsProfiles(this.data.workspaceId).pipe(
      map(profiles => profiles.find(profile => profile.label === this.defaultMissingProfileLabel)?.id),
      switchMap(defaultProfileId => this.missingsProfileService.getMissingsProfileDetails(
        this.data.workspaceId,
        defaultProfileId || this.defaultMissingProfileLabel
      ))
    );
  }

  private toMissingProfileDto(profile: MissingsProfilesDto): MissingsProfilesDto {
    return Object.assign(new MissingsProfilesDto(), profile);
  }

  private getMissingPreviewLookup(profile: MissingsProfilesDto | null): MissingPreviewLookup {
    const lookup: MissingPreviewLookup = {
      byIssueOption: new Map<number, ResolvedMissingPreview>(),
      byCode: new Map<number, ResolvedMissingPreview>()
    };
    if (!profile) {
      return lookup;
    }

    const missings = this.toMissingProfileDto(profile).parseMissings();
    missings.forEach(missing => {
      const resolved = this.toResolvedMissingPreview(missing);
      if (resolved) {
        lookup.byCode.set(resolved.code, resolved);
      }
    });

    this.manualMissingIdsByIssueOptionId.forEach((missingId, issueOptionId) => {
      const missing = missings.find(entry => entry.id === missingId);
      const resolved = this.toResolvedMissingPreview(missing);
      if (resolved) {
        lookup.byIssueOption.set(issueOptionId, resolved);
      }
    });

    return lookup;
  }

  private toResolvedMissingPreview(missing?: MissingDto): ResolvedMissingPreview | null {
    if (!missing) {
      return null;
    }

    const code = Number(missing.code);
    if (!Number.isInteger(code) || !this.hasExplicitScoreProperty(missing) || !this.hasExplicitValidScore(missing.score)) {
      return null;
    }

    return {
      code,
      score: this.normalizeScore(missing.score),
      label: missing.label
    };
  }

  private hasExplicitScoreProperty(missing: MissingDto): boolean {
    return Object.prototype.hasOwnProperty.call(missing, 'score');
  }

  private hasExplicitValidScore(score: unknown): boolean {
    if (score === null) {
      return true;
    }

    if (typeof score === 'number') {
      return Number.isFinite(score);
    }

    if (typeof score === 'string') {
      const trimmedScore = score.trim();
      return trimmedScore !== '' && Number.isFinite(Number(trimmedScore));
    }

    return false;
  }

  private normalizeScore(score: unknown): number | null {
    if (score === null) {
      return null;
    }

    return Number(score);
  }

  private getCodingProgressKey(unit: CodingJobUnitResult): string {
    const testPerson = this.getCodingTestPerson(unit);
    return `${testPerson}::${unit.bookletName}::${unit.unitName}::${unit.variableId}`;
  }

  private getCodingTestPerson(unit: {
    personLogin: string;
    personCode: string;
    personGroup?: string | null;
    bookletName: string;
  }): string {
    if (unit.personGroup) {
      return `${unit.personLogin}@${unit.personCode}@${unit.personGroup}@${unit.bookletName}`;
    }

    return `${unit.personLogin}@${unit.personCode}@${unit.bookletName}`;
  }

  private getTestPersonLabel(unit: CodingJobUnitResult): string {
    return [
      unit.personLogin,
      unit.personCode,
      unit.personGroup,
      unit.bookletName
    ].filter(value => !!value).join(' / ');
  }

  private createFilterPredicate(): (data: CodingResult, filter: string) => boolean { return createCodingResultFilter(); }

  private createSortingDataAccessor(): (data: CodingResult, sortHeaderId: string) => string | number { return createCodingResultSorter(); }

  applyFilters(): void {
    const filterObj = {
      unitName: this.unitNameFilter(),
      variable: this.variableFilter(),
      codingIssue: this.codingIssueFilter(),
      testPerson: this.testPersonFilter()
    };
    this.dataSource.filter = JSON.stringify(filterObj);
    this.paginator()?.firstPage();
  }

  protected onUnitNameFilterChange(): void {
    this.applyFilters();
  }

  protected onVariableFilterChange(): void {
    this.applyFilters();
  }

  protected onCodingIssueFilterChange(): void {
    this.applyFilters();
  }

  protected onTestPersonFilterChange(): void {
    this.applyFilters();
  }

  protected clearUnitNameFilter(): void {
    this.unitNameFilter.set('');
    this.applyFilters();
  }

  protected clearVariableFilter(): void {
    this.variableFilter.set('');
    this.applyFilters();
  }

  protected clearCodingIssueFilter(): void {
    this.codingIssueFilter.set('');
    this.applyFilters();
  }

  protected clearTestPersonFilter(): void {
    this.testPersonFilter.set('');
    this.applyFilters();
  }

  protected clearAllFilters(): void {
    this.unitNameFilter.set('');
    this.variableFilter.set('');
    this.codingIssueFilter.set('');
    this.testPersonFilter.set('');
    this.applyFilters();
  }

  protected hasActiveFilters(): boolean {
    return [
      this.unitNameFilter(),
      this.variableFilter(),
      this.codingIssueFilter(),
      this.testPersonFilter()
    ].some(value => value.trim().length > 0);
  }

  getFilteredResultCount(): number {
    return this.dataSource.filteredData.length;
  }

  protected getTotalResultCount(): number {
    return this.dataSource.data.length;
  }

  getCodedResultCount(): number {
    return this.dataSource.data.filter(result => this.hasCode(result)).length;
  }

  protected getReviewIssueCount(): number {
    return this.dataSource.data.filter(result => this.isCodingIssueOption(result)).length;
  }

  getUnresolvedMissingCount(): number {
    return this.dataSource.data.filter(result => result.unresolvedMissing).length;
  }

  canApplyCodingResults(): boolean {
    return !this.isLoading() &&
      this.data.codingJob.status !== 'results_applied' &&
      this.isCodingJobFreshnessApplyable() &&
      !this.data.codingJob.training?.id &&
      !this.data.codingJob.training_id &&
      this.getUnresolvedMissingCount() === 0 &&
      this.getCodedResultCount() > 0;
  }

  getApplyButtonTooltip(): string {
    if (this.data.codingJob.status === 'results_applied') {
      return this.uiTranslate('ui-text.coding-job-result-dialog.kodierergebnisse-wurden-bereits-angewendet');
    }
    if (!this.isCodingJobFreshnessApplyable()) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.die-antwortdaten-haben-sich-geaendert-aktualisieren-sie-zuerst-den-kodierungsauftrag');
    }
    if (this.data.codingJob.training?.id || this.data.codingJob.training_id) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.trainingsergebnisse-koennen-nicht-auf-antwortdaten-angewendet-werden');
    }
    if (this.getUnresolvedMissingCount() > 0) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.missing-kodierung-en-koennen-nicht-aus-dem-missing-profil-aufgeloest-werden', { value1: this.getUnresolvedMissingCount() });
    }
    if (this.getCodedResultCount() === 0) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.keine-kodierten-ergebnisse-zum-anwenden-vorhanden');
    }
    if (this.getReviewIssueCount() > 0) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.ergebnis-se-benoetigen-vorher-eine-manuelle-pruefung-und-werden-uebersprungen', { value1: this.getReviewIssueCount() });
    }
    return this.uiTranslate('ui-text.coding-job-result-dialog.gepruefte-kodierergebnisse-auf-datenbank-anwenden');
  }

  private isCodingJobFreshnessApplyable(): boolean {
    const freshnessStatus = this.data.codingJob.freshnessStatus;
    return freshnessStatus !== 'stale_source';
  }

  protected getOtherCodersTooltip(result: CodingResult): string {
    const otherCoders = result.otherCoders || [];
    if (otherCoders.length === 0) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.doppelkodierung-erkannt');
    }

    const label = otherCoders.length === 1 ? this.uiTranslate('coding-results.tooltip-other-coder') : this.uiTranslate('ui-text.coding-job-result-dialog.andere-kodierer');
    return `${label}${otherCoders.join(', ')}`;
  }

  applyCodingResults(): void {
    const dialogRef = this.dialog.open(ApplyCodingResultsDialogComponent, {
      width: '600px',
      data: {
        jobName: this.data.codingJob.name,
        totalResults: this.getTotalResultCount(),
        codedResults: this.getCodedResultCount(),
        reviewIssues: this.getReviewIssueCount()
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
      if (!dialogResult) {
        return;
      }

      this.isLoading.set(true);

      this.codingJobBackendService.applyCodingResults(this.data.workspaceId, this.data.codingJob.id, {
        overwriteExisting: dialogResult.overwriteExisting
      }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: result => {
          this.isLoading.set(false);

          let message = this.translateService.instant(result.messageKey, result.messageParams || {});
          if (result.success) {
            this.hasAppliedResults = true;
            if (result.updatedResponsesCount > 0) {
              message += this.uiTranslate('ui-text.coding-job-result-dialog.aktualisiert-antworten', { updatedResponsesCount: result.updatedResponsesCount });
            }
            if (result.skippedAlreadyCodedCount > 0) {
              message += this.uiTranslate('ui-text.coding-job-result-dialog.bereits-vorhandene-kodierungen-nicht-ueberschrieben-antworten', { skippedAlreadyCodedCount: result.skippedAlreadyCodedCount });
            }
            if (result.overwrittenExistingCount > 0) {
              message += this.uiTranslate('ui-text.coding-job-result-dialog.vorhandene-kodierungen-ueberschrieben-antworten', { overwrittenExistingCount: result.overwrittenExistingCount });
            }
            if (result.skippedReviewCount > 0) {
              message += this.uiTranslate('ui-text.coding-job-result-dialog.uebersprungen-manuelle-pruefung-benoetigt-antworten', { skippedReviewCount: result.skippedReviewCount });
            }
            this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.ergebnisse-erfolgreich-angewendet', { message: message }), this.uiTranslate('deferred-view.close'), {
              duration: 5000,
              panelClass: ['success-snackbar']
            });
            if (result.skippedReviewCount > 0) {
              this.loadCodingResults();
            } else {
              this.dialogRef.close({ resultsApplied: true });
            }
          } else {
            this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.fehler-beim-anwenden-der-ergebnisse', { message: message }), this.uiTranslate('deferred-view.close'), {
              duration: 5000,
              panelClass: ['error-snackbar']
            });
          }
        },
        error: error => {
          this.isLoading.set(false);

          this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.fehler-beim-anwenden-der-kodierergebnisse', { value1: error.message || error }), this.uiTranslate('deferred-view.close'), { duration: 5000 });
        }
      });
    });
  }

  protected getAggregationSettingsText(): string {
    const job = this.data.codingJob;

    if (!job.aggregationSettingsVersion) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.aggregation-aeltere-jobs-nutzen-aktuelle-workspace-einstellungen');
    }

    if (!job.aggregationEnabled || job.aggregationThreshold === null || job.aggregationThreshold === undefined) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.aggregation-beim-erstellen-aus');
    }

    const flags = job.responseMatchingFlags || [];
    const matchingText = flags.length > 0 ?
      flags.map(flag => this.getResponseMatchingFlagLabel(flag)).join(', ') :
      this.uiTranslate('ui-text.coding-job-result-dialog.exakte-uebereinstimmung');

    return `Aggregation beim Erstellen: Schwellenwert ${job.aggregationThreshold}, ${matchingText}`;
  }

  private getResponseMatchingFlagLabel(flag: string): string {
    switch (flag) {
      case 'IGNORE_CASE':
        return this.uiTranslate('ui-text.coding-job-result-dialog.gross-kleinschreibung-ignoriert');
      case 'IGNORE_WHITESPACE':
        return this.uiTranslate('ui-text.coding-job-result-dialog.leerzeichen-ignoriert');
      case 'NO_AGGREGATION':
        return this.uiTranslate('ui-text.coding-job-result-dialog.nicht-aggregiert');
      default:
        return flag;
    }
  }

  getCodeDisplay(result: CodingResult): string {
    if (result.unresolvedMissing) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.missing-nicht-aufloesbar');
    }
    if (result.code !== undefined && result.code !== null) {
      if (this.isCodingIssueOption(result)) {
        if (result.givenCode !== undefined && result.givenCode !== null) {
          return `${result.givenCode} (unsicher)`;
        }
        return '';
      }
      return result.code.toString();
    }
    return this.uiTranslate('ui-text.coding-job-result-dialog.nicht-kodiert');
  }

  getScoreDisplay(result: CodingResult): string {
    if (result.unresolvedMissing) {
      return '';
    }
    if (this.isCodingIssueOption(result)) {
      if (result.givenScore !== undefined && result.givenScore !== null) {
        return `${result.givenScore} (unsicher)`;
      }
      return result.codeLabel || '';
    }
    if (result.score !== undefined && result.score !== null) {
      return result.score.toString();
    }
    if (result.score === null) {
      return 'NA';
    }
    if (this.hasCode(result)) {
      return '';
    }
    return this.uiTranslate('ui-text.coding-job-result-dialog.nicht-kodiert');
  }

  hasCode(result: CodingResult): boolean {
    return result.code !== undefined && result.code !== null;
  }

  private isPositiveCode(code: string | number): boolean {
    if (typeof code === 'number') {
      return code > 0;
    }
    const numCode = parseInt(code, 10);
    return !Number.isNaN(numCode) && numCode > 0;
  }

  private toNumericCode(code: string | number | undefined): number | null {
    if (code === undefined || code === null) {
      return null;
    }
    if (typeof code === 'number') {
      return code;
    }
    const parsed = parseInt(code, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private getMappedResultCode(
    progress: CodingProgressEntry | undefined,
    missingPreviewLookup: MissingPreviewLookup
  ): number | null {
    const code = this.toNumericCode(progress?.id);
    const missingPreview = this.getMissingPreviewForProgressCode(code, missingPreviewLookup);
    if (missingPreview) {
      return missingPreview.code;
    }
    if (this.isMissingProgressCode(code)) {
      return null;
    }
    return code;
  }

  private getMappedResultScore(
    progress: CodingProgressEntry | undefined,
    missingPreviewLookup: MissingPreviewLookup
  ): number | null | undefined {
    const code = this.toNumericCode(progress?.id);
    const missingPreview = this.getMissingPreviewForProgressCode(code, missingPreviewLookup);
    if (missingPreview) {
      return missingPreview.score;
    }
    if (this.isMissingProgressCode(code)) {
      return undefined;
    }
    return progress?.score;
  }

  private getMissingPreviewForProgressCode(
    code: number | null,
    missingPreviewLookup: MissingPreviewLookup
  ): ResolvedMissingPreview | undefined {
    if (code === null) {
      return undefined;
    }

    if (this.isManualMissingIssueOption(code)) {
      return missingPreviewLookup.byIssueOption.get(code);
    }

    if (this.isProfileMissingCode(code)) {
      return missingPreviewLookup.byCode.get(code);
    }

    return undefined;
  }

  private isMissingProgressCode(code: number | null): boolean {
    return this.isManualMissingIssueOption(code) || this.isProfileMissingCode(code);
  }

  private isProfileMissingCode(code: number | null): boolean {
    return code !== null && code < 0 && code !== -1 && code !== -2;
  }

  private isManualMissingIssueOption(code: number | null): boolean {
    return code !== null && this.manualMissingIdsByIssueOptionId.has(code);
  }

  private getReviewIssueOption(progress?: CodingProgressEntry): number | null {
    const code = this.toNumericCode(progress?.id);
    if (code === -1 || code === -2) {
      return code;
    }

    const issueOption = progress?.codingIssueOption;
    if (issueOption === -1 || issueOption === -2) {
      return issueOption;
    }

    return null;
  }

  protected isCodingIssueOption(result: CodingResult): boolean {
    return result.codingIssueOption === -1 || result.codingIssueOption === -2;
  }

  isCodingIssueReviewEnabled(): boolean {
    return this.data.canEdit === true && this.data.codingJob.status === 'review';
  }

  canReviewCodingResult(result: CodingResult): boolean {
    return this.isCodingIssueReviewEnabled() && this.isCodingIssueOption(result);
  }

  canEditCodingScheme(result: CodingResult): boolean {
    return this.isCodingIssueReviewEnabled() && this.isNewCodeNeeded(result);
  }

  getReviewCodingResultTooltip(result: CodingResult): string {
    if (!this.isCodingIssueReviewEnabled() && this.isCodingIssueOption(result)) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.kodierungshinweise-koennen-erst-im-status-zur-ueberpruefung-geprueft-werden');
    }

    return this.uiTranslate('ui-text.coding-job-result-dialog.kodierungs-hinweis-ueberpruefen');
  }

  protected getEditCodingSchemeTooltip(result: CodingResult): string {
    if (!this.isCodingIssueReviewEnabled() && this.isNewCodeNeeded(result)) {
      return this.uiTranslate('ui-text.coding-job-result-dialog.kodierungsschema-kann-erst-im-status-zur-ueberpruefung-bearbeitet-werden');
    }

    return this.uiTranslate('ui-text.coding-job-result-dialog.kodierungsschema-bearbeiten');
  }

  isNewCodeNeeded(result: CodingResult): boolean {
    return result.codingIssueOption === -2;
  }

  getCodingIssueOption(codingIssueOptionId: number): string {
    const keyMapping: { [key: number]: string } = {
      [-1]: 'code-selector.coding-issue-options.code-assignment-uncertain',
      [-2]: 'code-selector.coding-issue-options.new-code-needed',
      [-3]: 'code-selector.coding-issue-options.invalid-joke-answer',
      [-4]: 'code-selector.coding-issue-options.technical-problems'
    };

    const translationKey = keyMapping[codingIssueOptionId];
    if (translationKey) {
      return this.translateService.instant(translationKey);
    }
    return 'Unknown';
  }

  protected getCellClasses(result: CodingResult): string {
    if (this.isCodingIssueOption(result)) {
      if (result.givenCode !== undefined && result.givenCode !== null) {
        return 'uncertain-with-code';
      }
      return 'uncertain';
    }
    return this.hasCode(result) ? 'coded' : 'not-coded';
  }

  reviewCodingResult(result: CodingResult): void {
    if (!result || !this.isCodingIssueOption(result)) {
      this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.nur-kodierungs-hinweis-faelle-koennen-ueberprueft-werden'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    if (!this.isCodingIssueReviewEnabled()) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-job-result-dialog.kodierungshinweise-koennen-erst-im-status-zur-ueberpruefung-geprueft-werden'),
        this.uiTranslate('deferred-view.close'),
        { duration: 3000 }
      );
      return;
    }

    const testPerson = this.getCodingTestPerson(result);

    const reviewUnit: UnitsReplayUnit = {
      id: 0, // Not needed for replay
      name: result.unitName,
      alias: result.unitAlias,
      bookletId: 0, // Not needed for replay
      testPerson: testPerson,
      variableId: result.variableId,
      variableAnchor: result.variableAnchor,
      variablePage: result.variablePage || '0'
    };

    const unitsData: UnitsReplay = {
      id: this.data.codingJob.id, // Use original coding job ID
      name: this.uiTranslate('ui-text.coding-job-result-dialog.kodierungshinweis-726a2e', { name: this.data.codingJob.name, variableId: result.variableId }),
      units: [reviewUnit],
      currentUnitIndex: 0
    };

    const serializedUnits = this.serializeUnitsData(unitsData);

    const queryParams = {
      mode: 'coding-issue-review',
      unitsData: serializedUnits,
      workspaceId: this.data.workspaceId
    };

    const unitName = result.unitName || '';
    const url = this.router
      .serializeUrl(
        this.router.createUrlTree(
          [`replay/${testPerson}/${unitName}/${result.variablePage || '0'}/${result.variableId}`],
          { queryParams: queryParams })
      );

    window.open(`${window.location.origin}/#${url}`, '_blank');
  }

  protected editCodingScheme(result: CodingResult): void {
    if (!result || !this.isNewCodeNeeded(result)) {
      this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.nur-neuer-code-erforderlich-faelle-koennen-bearbeitet-werden'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    if (!this.isCodingIssueReviewEnabled()) {
      this.snackBar.open(
        this.uiTranslate('ui-text.coding-job-result-dialog.kodierungsschema-kann-erst-im-status-zur-ueberpruefung-bearbeitet-werden'),
        this.uiTranslate('deferred-view.close'),
        { duration: 3000 }
      );
      return;
    }

    const codingSchemeRef = result.unitAlias;
    if (!codingSchemeRef) {
      this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.kein-kodierungsschema-referenz-gefunden-fuer-diese-einheit'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    this.fileService.getCodingSchemeFile(this.data.workspaceId, codingSchemeRef).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: schemeFile => {
        if (!schemeFile) {
          this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.kodierungsschema-datei-nicht-gefunden'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
          return;
        }

        const schemeContent = base64ToUtf8(schemeFile.base64Data);

        const dialogRef = this.dialog.open(SchemeEditorDialogComponent, {
          width: '90vw',
          height: '90vh',
          maxWidth: '1200px',
          data: {
            workspaceId: this.data.workspaceId,
            fileId: codingSchemeRef, // Use the reference as fileId for saving logic
            fileName: schemeFile.filename,
            content: schemeContent
          }
        });

        dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(dialogResult => {
          if (dialogResult === true) {
            this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.kodierungsschema-erfolgreich-aktualisiert'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
            this.loadCodingResults();
          }
        });
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.coding-job-result-dialog.fehler-beim-laden-des-kodierungsschemas'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      }
    });
  }

  private serializeUnitsData(unitsData: UnitsReplay): string {
    try {
      const jsonString = JSON.stringify(unitsData);
      return utf8ToBase64(jsonString);
    } catch (error) {
      return '';
    }
  }
}
