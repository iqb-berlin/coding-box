import {
  Component, Inject, OnInit, OnDestroy, AfterViewInit,
  ViewChild,
  inject,
  HostListener
} from '@angular/core';
import {
  Subject, debounceTime, forkJoin, of, catchError, finalize, takeUntil
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
import { CommonModule, NgClass } from '@angular/common';

import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltip } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { FileService } from '../../../../shared/services/file/file.service';
import { CodingJobBackendService } from '../../../services/coding-job-backend.service';
import { AppService } from '../../../../core/services/app.service';
import { CodingJob } from '../../../models/coding-job.model';
import { SchemeEditorDialogComponent } from '../../scheme-editor-dialog/scheme-editor-dialog.component';
import { base64ToUtf8, utf8ToBase64 } from '../../../../shared/utils/common-utils';
import {
  ApplyCodingResultsDialogComponent,
  ApplyCodingResultsDialogResult
} from '../apply-coding-results-dialog.component';

import { UnitsReplay, UnitsReplayUnit } from '../../../../replay/services/units-replay.service';

interface CodingResult {
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  testPerson: string;
  testPersonSearch: string;
  code?: string | number | null;
  codeLabel?: string;
  score?: number;
  codingIssueOption?: number;
  codingIssueOptionLabel?: string;
  givenCode?: string | number;
  givenScore?: number;
  notes?: string;
  isDoubleCoded?: boolean;
  otherCoders?: string[];
}

interface CodingProgressEntry {
  id?: string | number;
  label?: string;
  score?: number;
  codingIssueOption?: number;
}

interface CodingJobUnitResult {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  isDoubleCoded: boolean;
  otherCoders: string[];
}

@Component({
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
    NgClass,
    MatTooltip
  ]
})
export class CodingJobResultDialogComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator?: MatPaginator;

  private codingJobBackendService = inject(CodingJobBackendService);
  private fileService = inject(FileService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private router = inject(Router);
  private dialog = inject(MatDialog);

  isLoading = true;
  isNotesUnavailable = false;
  dataSource = new MatTableDataSource<CodingResult>([]);
  displayedColumns: string[] = [
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

  readonly pageSize = 50;
  readonly pageSizeOptions = [25, 50, 100];

  unitNameFilter = '';
  variableFilter = '';
  codingIssueFilter = '';
  testPersonFilter = '';

  constructor(
    public dialogRef: MatDialogRef<CodingJobResultDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { codingJob: CodingJob; workspaceId: number; canApplyResults?: boolean }
  ) { }

  ngOnInit(): void {
    this.loadCodingResults();
    this.setupAutoRefresh();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.refreshSubject.complete();
  }

  private setupAutoRefresh(): void {
    this.refreshSubject.pipe(
      debounceTime(1000),
      takeUntil(this.destroy$)
    ).subscribe(() => this.loadCodingResults());
  }

  @HostListener('window:focus', ['$event'])
  onWindowFocus(): void {
    this.refreshSubject.next();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator || null;
    this.dataSource.sortingDataAccessor = this.createSortingDataAccessor();
    this.dataSource.filterPredicate = this.createFilterPredicate();
    this.applyFilters();
  }

  loadCodingResults(): void {
    this.isLoading = true;
    this.isNotesUnavailable = false;

    forkJoin({
      units: this.codingJobBackendService.getCodingJobUnits(this.data.workspaceId, this.data.codingJob.id),
      progress: this.codingJobBackendService.getCodingProgress(this.data.workspaceId, this.data.codingJob.id),
      notes: this.codingJobBackendService.getCodingNotes(this.data.workspaceId, this.data.codingJob.id).pipe(
        catchError(() => {
          this.isNotesUnavailable = true;
          this.snackBar.open('Notizen konnten nicht geladen werden. Ergebnisse werden trotzdem angezeigt.', 'Schließen', { duration: 4000 });
          return of({});
        })
      )
    }).pipe(
      takeUntil(this.destroy$),
      finalize(() => {
        this.isLoading = false;
      })
    ).subscribe({
      next: ({ units, progress, notes }) => {
        this.dataSource.data = (units || []).map(unit => this.mapCodingResult(
          unit as CodingJobUnitResult,
          progress as Record<string, CodingProgressEntry>,
          notes as Record<string, string>
        ));
        this.applyFilters();
        this.paginator?.firstPage();
      },
      error: () => {
        this.dataSource.data = [];
        this.snackBar.open('Fehler beim Laden der Kodierergebnisse', 'Schließen', { duration: 3000 });
      }
    });
  }

  private mapCodingResult(
    unit: CodingJobUnitResult,
    progressResult: Record<string, CodingProgressEntry>,
    notesResult: Record<string, string>
  ): CodingResult {
    const progressKey = this.getCodingProgressKey(unit);
    const progress = progressResult[progressKey];
    const notes = notesResult ? notesResult[progressKey] : undefined;
    const mappedCode = this.getMappedResultCode(progress);
    const mappedScore = this.getMappedResultScore(progress);
    const reviewIssueOption = this.getReviewIssueOption(progress);
    const testPerson = this.getTestPersonLabel(unit);
    const otherCoders = (unit.otherCoders || []).filter(Boolean);

    return {
      unitName: unit.unitName,
      unitAlias: unit.unitAlias,
      variableId: unit.variableId,
      variableAnchor: unit.variableAnchor,
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
      codeLabel: progress?.label,
      score: mappedScore,
      codingIssueOption: reviewIssueOption ?? undefined,
      codingIssueOptionLabel: reviewIssueOption !== null ? this.getCodingIssueOption(reviewIssueOption) : undefined,
      givenCode: reviewIssueOption !== null && progress?.id && this.isPositiveCode(progress.id) ? progress.id : undefined,
      givenScore: reviewIssueOption !== null && progress?.score !== undefined && progress?.score !== null ? progress.score : undefined,
      notes: notes,
      isDoubleCoded: otherCoders.length > 0,
      otherCoders
    };
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

  private createFilterPredicate(): (data: CodingResult, filter: string) => boolean {
    return (data: CodingResult, filter: string): boolean => {
      let filters: {
        unitName?: string;
        variable?: string;
        codingIssue?: string;
        testPerson?: string;
      };

      try {
        filters = JSON.parse(filter);
      } catch {
        return true;
      }

      // Check unit name filter (includes unitName and unitAlias)
      const unitFilter = filters.unitName?.toLowerCase() || '';
      if (unitFilter && !data.unitName.toLowerCase().includes(unitFilter) &&
        !(data.unitAlias && data.unitAlias.toLowerCase().includes(unitFilter))) {
        return false;
      }

      // Check variable filter
      const variableFilter = filters.variable?.toLowerCase() || '';
      if (variableFilter &&
        !data.variableId.toLowerCase().includes(variableFilter) &&
        !data.variableAnchor.toLowerCase().includes(variableFilter)) {
        return false;
      }

      // Check coding issue filter
      const codingIssueFilter = filters.codingIssue?.toLowerCase() || '';
      if (codingIssueFilter && !(data.codingIssueOptionLabel && data.codingIssueOptionLabel.toLowerCase().includes(codingIssueFilter))) {
        return false;
      }

      // Check test person filter
      const testPersonFilter = filters.testPerson?.toLowerCase() || '';
      return !(testPersonFilter && !data.testPersonSearch.toLowerCase().includes(testPersonFilter));
    };
  }

  private createSortingDataAccessor(): (data: CodingResult, sortHeaderId: string) => string | number {
    return (result: CodingResult, sortHeaderId: string): string | number => {
      switch (sortHeaderId) {
        case 'testPerson':
          return result.testPerson;
        case 'code':
          return result.code ?? Number.NEGATIVE_INFINITY;
        case 'score':
          return result.score ?? result.givenScore ?? Number.NEGATIVE_INFINITY;
        case 'codingIssueOption':
          return result.codingIssueOptionLabel || '';
        case 'doubleCoding':
          return result.otherCoders?.length || 0;
        case 'notes':
          return result.notes || '';
        default:
          return (result as unknown as Record<string, string | number | null | undefined>)[sortHeaderId] ?? '';
      }
    };
  }

  applyFilters(): void {
    const filterObj = {
      unitName: this.unitNameFilter,
      variable: this.variableFilter,
      codingIssue: this.codingIssueFilter,
      testPerson: this.testPersonFilter
    };
    this.dataSource.filter = JSON.stringify(filterObj);
    this.paginator?.firstPage();
  }

  onUnitNameFilterChange(): void {
    this.applyFilters();
  }

  onVariableFilterChange(): void {
    this.applyFilters();
  }

  onCodingIssueFilterChange(): void {
    this.applyFilters();
  }

  onTestPersonFilterChange(): void {
    this.applyFilters();
  }

  clearUnitNameFilter(): void {
    this.unitNameFilter = '';
    this.applyFilters();
  }

  clearVariableFilter(): void {
    this.variableFilter = '';
    this.applyFilters();
  }

  clearCodingIssueFilter(): void {
    this.codingIssueFilter = '';
    this.applyFilters();
  }

  clearTestPersonFilter(): void {
    this.testPersonFilter = '';
    this.applyFilters();
  }

  clearAllFilters(): void {
    this.unitNameFilter = '';
    this.variableFilter = '';
    this.codingIssueFilter = '';
    this.testPersonFilter = '';
    this.applyFilters();
  }

  hasActiveFilters(): boolean {
    return [
      this.unitNameFilter,
      this.variableFilter,
      this.codingIssueFilter,
      this.testPersonFilter
    ].some(value => value.trim().length > 0);
  }

  getFilteredResultCount(): number {
    return this.dataSource.filteredData.length;
  }

  getTotalResultCount(): number {
    return this.dataSource.data.length;
  }

  getCodedResultCount(): number {
    return this.dataSource.data.filter(result => this.hasCode(result)).length;
  }

  getReviewIssueCount(): number {
    return this.dataSource.data.filter(result => this.isCodingIssueOption(result)).length;
  }

  canApplyCodingResults(): boolean {
    return !this.isLoading &&
      this.data.codingJob.status !== 'results_applied' &&
      this.isCodingJobFreshnessApplyable() &&
      !this.data.codingJob.training?.id &&
      !this.data.codingJob.training_id &&
      this.getCodedResultCount() > 0;
  }

  getApplyButtonTooltip(): string {
    if (this.data.codingJob.status === 'results_applied') {
      return 'Kodierergebnisse wurden bereits angewendet';
    }
    if (!this.isCodingJobFreshnessApplyable()) {
      return 'Die Antwortdaten haben sich geändert. Aktualisieren Sie zuerst den Kodierungsauftrag.';
    }
    if (this.data.codingJob.training?.id || this.data.codingJob.training_id) {
      return 'Trainingsergebnisse können nicht auf Antwortdaten angewendet werden';
    }
    if (this.getCodedResultCount() === 0) {
      return 'Keine kodierten Ergebnisse zum Anwenden vorhanden';
    }
    if (this.getReviewIssueCount() > 0) {
      return `${this.getReviewIssueCount()} Ergebnis(se) benötigen vorher eine manuelle Prüfung und werden übersprungen`;
    }
    return 'Geprüfte Kodierergebnisse auf Datenbank anwenden';
  }

  private isCodingJobFreshnessApplyable(): boolean {
    const freshnessStatus = this.data.codingJob.freshnessStatus;
    return freshnessStatus !== 'stale_source';
  }

  getOtherCodersTooltip(result: CodingResult): string {
    const otherCoders = result.otherCoders || [];
    if (otherCoders.length === 0) {
      return 'Doppelkodierung erkannt';
    }

    const label = otherCoders.length === 1 ? 'Anderer Kodierer: ' : 'Andere Kodierer: ';
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

    dialogRef.afterClosed().subscribe((dialogResult?: ApplyCodingResultsDialogResult | false) => {
      if (!dialogResult) {
        return;
      }

      this.isLoading = true;
      this.codingJobBackendService.applyCodingResults(this.data.workspaceId, this.data.codingJob.id, {
        overwriteExisting: dialogResult.overwriteExisting
      }).subscribe({
        next: result => {
          this.isLoading = false;
          let message = this.translateService.instant(result.messageKey, result.messageParams || {});
          if (result.success) {
            if (result.updatedResponsesCount > 0) {
              message += `\n\nAktualisiert: ${result.updatedResponsesCount} Antworten`;
            }
            if (result.skippedAlreadyCodedCount > 0) {
              message += `\nBereits vorhandene Kodierungen nicht überschrieben: ${result.skippedAlreadyCodedCount} Antworten`;
            }
            if (result.overwrittenExistingCount > 0) {
              message += `\nVorhandene Kodierungen überschrieben: ${result.overwrittenExistingCount} Antworten`;
            }
            if (result.skippedReviewCount > 0) {
              message += `\nÜbersprungen (manuelle Prüfung benötigt): ${result.skippedReviewCount} Antworten`;
            }
            this.snackBar.open(`Ergebnisse erfolgreich angewendet!\n${message}`, 'Schließen', {
              duration: 5000,
              panelClass: ['success-snackbar']
            });
            this.dialogRef.close({ resultsApplied: true });
          } else {
            this.snackBar.open(`Fehler beim Anwenden der Ergebnisse: ${message}`, 'Schließen', {
              duration: 5000,
              panelClass: ['error-snackbar']
            });
          }
        },
        error: error => {
          this.isLoading = false;
          this.snackBar.open(`Fehler beim Anwenden der Kodierergebnisse: ${error.message || error}`, 'Schließen', { duration: 5000 });
        }
      });
    });
  }

  getAggregationSettingsText(): string {
    const job = this.data.codingJob;

    if (!job.aggregationSettingsVersion) {
      return 'Aggregation: ältere Jobs nutzen aktuelle Workspace-Einstellungen';
    }

    if (!job.aggregationEnabled || job.aggregationThreshold === null || job.aggregationThreshold === undefined) {
      return 'Aggregation beim Erstellen: aus';
    }

    const flags = job.responseMatchingFlags || [];
    const matchingText = flags.length > 0 ?
      flags.map(flag => this.getResponseMatchingFlagLabel(flag)).join(', ') :
      'exakte Übereinstimmung';

    return `Aggregation beim Erstellen: Schwellenwert ${job.aggregationThreshold}, ${matchingText}`;
  }

  private getResponseMatchingFlagLabel(flag: string): string {
    switch (flag) {
      case 'IGNORE_CASE':
        return 'Groß-/Kleinschreibung ignoriert';
      case 'IGNORE_WHITESPACE':
        return 'Leerzeichen ignoriert';
      case 'NO_AGGREGATION':
        return 'nicht aggregiert';
      default:
        return flag;
    }
  }

  getCodeDisplay(result: CodingResult): string {
    if (result.code !== undefined && result.code !== null) {
      if (this.isCodingIssueOption(result)) {
        if (result.givenCode !== undefined && result.givenCode !== null) {
          return `${result.givenCode} (unsicher)`;
        }
        return '';
      }
      return result.code.toString();
    }
    return 'Nicht kodiert';
  }

  getScoreDisplay(result: CodingResult): string {
    if (this.isCodingIssueOption(result)) {
      if (result.givenScore !== undefined && result.givenScore !== null) {
        return `${result.givenScore} (unsicher)`;
      }
      return result.codeLabel || '';
    }
    if (result.score !== undefined && result.score !== null) {
      return result.score.toString();
    }
    if (this.hasCode(result)) {
      return '';
    }
    return 'Nicht kodiert';
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

  private getMappedResultCode(progress?: CodingProgressEntry): number | null {
    const code = this.toNumericCode(progress?.id);
    if (code === -3) {
      return -98;
    }
    if (code === -4) {
      return -97;
    }
    return code;
  }

  private getMappedResultScore(progress?: CodingProgressEntry): number | undefined {
    const code = this.toNumericCode(progress?.id);
    if (code === -3 || code === -4) {
      return 0;
    }
    return progress?.score;
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

  isCodingIssueOption(result: CodingResult): boolean {
    return result.codingIssueOption === -1 || result.codingIssueOption === -2;
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

  getCellClasses(result: CodingResult): string {
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
      this.snackBar.open('Nur Kodierungs-Hinweis-Fälle können überprüft werden', 'Schließen', { duration: 3000 });
      return;
    }

    const loadingSnackBar = this.snackBar.open('Öffne Kodierungs-Interface...', '', { duration: 3000 });

    this.appService.createOwnToken(this.data.workspaceId, 1).subscribe({
      next: (token: string) => {
        loadingSnackBar.dismiss();

        const testPerson = this.getCodingTestPerson(result);

        const reviewUnit: UnitsReplayUnit = {
          id: 0, // Not needed for replay
          name: result.unitName,
          alias: result.unitAlias,
          bookletId: 0, // Not needed for replay
          testPerson: testPerson,
          variableId: result.variableId,
          variableAnchor: result.variableAnchor
        };

        const unitsData: UnitsReplay = {
          id: this.data.codingJob.id, // Use original coding job ID
          name: `${this.data.codingJob.name} - Review: ${result.variableId}`,
          units: [reviewUnit],
          currentUnitIndex: 0
        };

        const serializedUnits = this.serializeUnitsData(unitsData);

        const queryParams = {
          auth: token,
          mode: 'coding',
          unitsData: serializedUnits
        };

        const unitName = result.unitAlias || result.unitName || '';
        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${testPerson}/${unitName}/0/${result.variableId}`],
              { queryParams: queryParams })
          );

        window.open(`${window.location.origin}/#${url}`, '_blank');
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open('Fehler beim Erstellen des Authentisierungs-Tokens', 'Schließen', { duration: 3000 });
      }
    });
  }

  editCodingScheme(result: CodingResult): void {
    if (!result || !this.isNewCodeNeeded(result)) {
      this.snackBar.open('Nur "Neuer Code erforderlich" Fälle können bearbeitet werden', 'Schließen', { duration: 3000 });
      return;
    }

    const codingSchemeRef = result.unitAlias;
    if (!codingSchemeRef) {
      this.snackBar.open('Kein Kodierungsschema-Referenz gefunden für diese Einheit', 'Schließen', { duration: 3000 });
      return;
    }

    this.fileService.getCodingSchemeFile(this.data.workspaceId, codingSchemeRef).subscribe({
      next: schemeFile => {
        if (!schemeFile) {
          this.snackBar.open('Kodierungsschema-Datei nicht gefunden', 'Schließen', { duration: 3000 });
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

        dialogRef.afterClosed().subscribe(dialogResult => {
          if (dialogResult === true) {
            this.snackBar.open('Kodierungsschema erfolgreich aktualisiert', 'Schließen', { duration: 3000 });
            this.loadCodingResults();
          }
        });
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden des Kodierungsschemas', 'Schließen', { duration: 3000 });
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
