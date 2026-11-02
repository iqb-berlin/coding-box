import {
  ChangeDetectionStrategy,
  Component, computed, DestroyRef,
  effect,
  ElementRef, inject, OnDestroy, OnInit, signal,
  viewChild
} from '@angular/core';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';

import { SelectionModel } from '@angular/cdk/collections';
import { CommonModule, DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatDivider } from '@angular/material/divider';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle
} from '@angular/material/expansion';
import { MatIcon } from '@angular/material/icon';
import { MatInput } from '@angular/material/input';
import { MatList, MatListItem } from '@angular/material/list';
import {
  MatPaginator,
  MatPaginatorIntl,
  MatPaginatorModule,
  PageEvent
} from '@angular/material/paginator';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  debounceTime, finalize,
  Subject, Subscription
} from 'rxjs';
import {
  Booklet, BookletLog, TestResultPerson as P, Response, Unit, UnitResult
} from './test-results.models';
import { TestResultsDetailsFacade } from './test-results-details.facade';
import { TestResultsDeletionFacade } from './test-results-deletion.facade';
import { TestResultsExportFacade } from './test-results-export.facade';
import { TestResultsImportDialogComponent } from './test-results-import-dialog.component';
import { TestResultsImportFacade } from './test-results-import.facade';
import { TestResultsOverviewComponent } from './test-results-overview.component';
import { TestResultsStatisticsFacade } from './test-results-statistics.facade';
import { TestResultsSummaryFacade } from './test-results-summary.facade';

import { FileService } from '../../../shared/services/file/file.service';
import { SessionDistributionsDialogComponent } from './session-distributions-dialog.component';

import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import {
  AppliedResultsOverview,
  TestPersonCodingService
} from '../../../coding/services/test-person-coding.service';
import { AppService } from '../../../core/services/app.service';
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import {
  LogAnomalyDetailRow,
  QuickSearchResultItem,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';

import { VariableValidationDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import {
  UnitsReplay,
  UnitsReplayService
} from '../../../replay/services/units-replay.service';
import {
  ValidationTaskStateService,
  ValidationType
} from '../../../shared/services/validation/validation-task-state.service';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { TagDialogComponent } from '../tag-dialog/tag-dialog.component';
import {
  QuickSearchDialogResult,
  TestResultsSearchComponent
} from '../test-results-search/test-results-search.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { ValidationDialogComponent } from '../validation-dialog/validation-dialog.component';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';

import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { UnitInfoDto } from '../../../../../../../api-dto/unit-info/unit-info.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';

import {
  TestResultsLogAnomalyDetailsDialogComponent,
  TestResultsLogAnomalyDetailsDialogResult
} from './test-results-log-anomaly-details-dialog.component';

import {
  CodingFreshnessState, CodingFreshnessSummaryItemDto, CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';

import {
  PendingUploadBatch,
  TestResultsUploadStateService
} from '../../services/test-results-upload-state.service';
import type { FlatResponseFilters } from './test-results-flat-table.component';
import { TestResultsFlatTableComponent } from './test-results-flat-table.component';

import { TestResultsDeleteRequestDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

import { utf8ToBase64 } from '../../../shared/utils/common-utils';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-results',
  templateUrl: './test-results.component.html',
  styleUrls: ['./test-results.component.scss'],
  standalone: true,
  providers: [TestResultsSummaryFacade, TestResultsDeletionFacade, TestResultsDetailsFacade, TestResultsStatisticsFacade, TestResultsImportFacade, TestResultsExportFacade,
    DatePipe,
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
    TestResultsOverviewComponent,
    CommonModule,
    FormsModule,
    MatExpansionPanelHeader,
    MatPaginatorModule,
    TranslateModule,
    MatTable,
    MatCellDef,
    MatHeaderCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatCell,
    MatColumnDef,
    MatHeaderCell,
    MatHeaderRow,
    MatRow,
    MatSort,
    MatSortHeader,
    MatAccordion,
    MatExpansionPanel,
    MatExpansionPanelTitle,
    MatList,
    MatListItem,
    MatInput,
    MatIcon,
    MatProgressSpinner,
    MatProgressBar,
    MatCheckbox,
    MatAnchor,
    MatButton,
    MatIconButton,
    MatDivider,
    MatTooltipModule,
    TestResultsFlatTableComponent
  ]
})
export class TestResultsComponent implements OnInit, OnDestroy {
  private readonly statistics = inject(TestResultsStatisticsFacade);
  private readonly summary = inject(TestResultsSummaryFacade);
  private readonly details = inject(TestResultsDetailsFacade);
  private readonly deletion = inject(TestResultsDeletionFacade);
  private readonly imports = inject(TestResultsImportFacade);
  private readonly exports = inject(TestResultsExportFacade);

  private dialog = inject(MatDialog);

  private validationService = inject(ValidationService);
  private fileService = inject(FileService);
  private uploadStateService = inject(TestResultsUploadStateService);
  private statisticsService = inject(CodingStatisticsService);
  private testPersonCodingService = inject(TestPersonCodingService);
  private variableAnalysisService = inject(VariableAnalysisService);
  private appService = inject(AppService);
  private testResultService = inject(TestResultService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private validationTaskStateService = inject(ValidationTaskStateService);
  private unitsReplayService = inject(UnitsReplayService);

  private readonly destroyRef = inject(DestroyRef);

  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private testResultsRequest = { page: 0, limit: 50, searchText: '' };
  private testResultsRequestGeneration = 0;
  protected readonly personSearchText = signal('');
  private readonly appliedPersonSearchText = signal<string | null>(null);

  private flatFilterRequestSubscription: Subscription | null = null;
  private readonly SEARCH_DEBOUNCE_TIME = 800;
  protected selection = new SelectionModel<P>(true, []);
  protected dataSource!: MatTableDataSource<P>;
  protected displayedColumns: string[] = [
    'select',
    'code',
    'group',
    'login',
    'uploaded_at'
  ];

  readonly isTableView = signal<boolean>(false);
  readonly quickSearchTableFilters = signal<Partial<FlatResponseFilters> | null>(null);
  readonly forceShowLogAnomalyTableColumn = signal(false);
  data: P[] = [];
  readonly booklets = this.details.booklets;
  results: { [key: string]: unknown }[] = [];
  readonly responses = this.details.responses;
  readonly logs = this.details.logs;
  readonly bookletLogs = this.details.bookletLogs;

  protected readonly totalRecords = signal<number>(0);
  protected readonly pageSize = signal<number>(50);
  protected readonly pageIndex = signal<number>(0);
  readonly selectedUnit = this.details.selectedUnit;
  readonly testPerson = this.details.testPerson;
  protected readonly selectedBooklet = this.details.selectedBooklet;
  protected readonly isLoading = signal<boolean>(true);
  protected readonly testResultsLoadFailed = signal(false);
  protected readonly isUploadingResults = this.imports.isUploadingResults;
  protected readonly isSearching = signal<boolean>(false);
  protected readonly isPersonListCurrent = computed(() => !this.isLoading() && !this.testResultsLoadFailed() &&
    this.personSearchText().trim() === this.appliedPersonSearchText());

  readonly isLoadingBooklets = this.details.isLoadingBooklets;
  protected readonly isDeletingTestPersons = this.deletion.isDeletingTestPersons;
  readonly activeDeleteTask = this.deletion.activeDeleteTask;
  protected readonly canRetryDeletion = this.deletion.canRetry;
  protected readonly deletionRetryLabelKey = this.deletion.retryLabelKey;

  protected retryDeletion(): void { this.deletion.retry(); }
  protected readonly deleteProgress = this.deletion.deleteProgress;
  protected readonly deleteProgressMessage = this.deletion.deleteProgressMessage;
  readonly unitTags = this.details.unitTags;
  readonly unitTagsMap = this.details.unitTagsMap;
  readonly unitNotes = this.details.unitNotes;
  readonly unitNotesMap = this.details.unitNotesMap;
  readonly isVariableValidationRunning = signal<boolean>(false);
  readonly variableValidationResult = signal<VariableValidationDto | null>(null);
  readonly SHORT_PROCESSING_TIME_THRESHOLD_MS: number = 60000;
  private validationStatusInterval: number | null = null;

  private isInitialized: boolean = false;

  readonly overview = this.statistics.overview;
  readonly isLoadingOverview = this.statistics.isLoadingOverview;
  readonly showTestResultsLogAnomalies = this.statistics.showTestResultsLogAnomalies;
  readonly enableRegexSearch = this.statistics.enableRegexSearch;
  readonly logAnomalySummary = this.statistics.logAnomalySummary;
  readonly isLoadingLogAnomalySummary = this.statistics.isLoadingLogAnomalySummary;
  readonly logAnomalySummaryLoadFailed = this.statistics.logAnomalySummaryLoadFailed;
  readonly logAnomalySummaryRequested = this.statistics.logAnomalySummaryRequested;
  readonly codingFreshnessSummary = this.statistics.codingFreshnessSummary;
  readonly manualAppliedResultsOverview = this.statistics.manualAppliedResultsOverview;
  readonly manualAppliedResultsOverviewLoadFailed = this.statistics.manualAppliedResultsOverviewLoadFailed;
  readonly isLoadingManualAppliedResultsOverview = this.statistics.isLoadingManualAppliedResultsOverview;
  readonly autoRefreshCodingStatus = this.statistics.autoRefreshCodingStatus;
  readonly codingFreshnessStatusChecked = this.statistics.codingFreshnessStatusChecked;
  readonly isLoadingCodingFreshnessStatus = this.statistics.isLoadingCodingFreshnessStatus;

  readonly exportJobId = this.exports.exportJobId;
  protected readonly isExporting = this.exports.isExporting;
  readonly exportJobStatus = this.exports.exportJobStatus;
  readonly exportJobProgress = this.exports.exportJobProgress;
  readonly exportTypeInProgress = this.exports.exportTypeInProgress;
  protected readonly uploadingMessage = this.imports.uploadingMessage;

  readonly paginator = viewChild(MatPaginator);
  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    if (this.dataSource) this.dataSource.sort = this.sort() ?? null;
  });

  readonly hiddenResponsesFileInput = viewChild.required<ElementRef<HTMLInputElement>>('hiddenResponsesFileInput');

  readonly hiddenLogsFileInput = viewChild.required<ElementRef<HTMLInputElement>>('hiddenLogsFileInput');

  ngOnInit(): void {
    this.deletion.resetDetails$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.resetSelectedResultDetails());
    this.deletion.selectionCleared$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.selection.clear());
    this.deletion.changed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(change => {
      if (change.scope === 'unit') this.details.removeUnit(change.unitId, change.bookletId);
      if (change.scope === 'response') this.details.removeResponse(change.responseId);
      this.loadWorkspaceOverview();
      this.refreshCodingFreshnessStatusAfterChange();
      if (change.scope === 'workspace') this.createTestResultsList(this.pageIndex(), this.pageSize(), this.getCurrentSearchText());
    });
    this.imports.loadingChanged$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => this.isLoading.set(value));
    this.imports.imported$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.loadWorkspaceOverview();
      this.refreshCodingFreshnessStatusAfterChange();
      this.createTestResultsList(this.pageIndex(), this.pageSize(), this.getCurrentSearchText());
    });
    let workspaceId = this.appService.selectedWorkspaceId;
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      if (id === workspaceId) return;
      workspaceId = id;
      this.resetSelectedResultDetails();
      this.selection.clear();
      this.data = [];
      this.dataSource = new MatTableDataSource<P>([]);
      this.quickSearchTableFilters.set(null);
      this.forceShowLogAnomalyTableColumn.set(false);
      this.totalRecords.set(0);
      this.isSearching.set(false);
      if (!id) {
        this.testResultsRequestGeneration += 1;
        this.personSearchText.set('');
        this.appliedPersonSearchText.set(null);
        this.isLoading.set(false);
        return;
      }
      this.createTestResultsList(0, this.pageSize(), '');
      this.loadRegexSearchSetting();
      this.loadTestResultsLogAnomalySetting();
      this.loadCodingStatusAutoRefreshSetting();
      this.loadWorkspaceOverview();
      this.exports.checkExistingExportJobs();
    });
    this.searchSubscription = this.searchSubject
      .pipe(debounceTime(this.SEARCH_DEBOUNCE_TIME))
      .subscribe(searchText => {
        if (searchText.trim() !== this.personSearchText().trim()) return;
        if (searchText.trim() === this.testResultsRequest.searchText.trim()) return;
        this.createTestResultsList(0, this.pageSize(), searchText);
      });

    // Sync with upload state service
    this.uploadStateService.uploadingBatches$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (batches: PendingUploadBatch[]) => {
        const myBatch = batches.find(
          (b: PendingUploadBatch) => b.workspaceId === this.appService.selectedWorkspaceId
        );
        if (myBatch) {
          this.imports.updateUploadProgress(true, `Verarbeite... ${myBatch.progress}% (${myBatch.completedCount}/${myBatch.totalJobs} Dateien)`);
          this.isLoading.set(true);
        } else {
          this.imports.updateUploadProgress(false);
        }
      }
    );

    this.uploadStateService.uploadsFinished$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((wsId: number) => {
      if (wsId === this.appService.selectedWorkspaceId) {
        this.loadWorkspaceOverview();
        this.reloadLogAnomalySummaryIfRequested();
        this.refreshCodingFreshnessStatusAfterChange();
        this.createTestResultsList(
          this.pageIndex(),
          this.pageSize(),
          this.getCurrentSearchText()
        );
        this.isLoading.set(false);
        this.imports.updateUploadProgress(false);
      }
    });

    this.flatFilterRequestSubscription =
      this.testResultService.flatResponseFilterRequests$.subscribe(request => {
        if (request.workspaceId !== this.appService.selectedWorkspaceId) {
          return;
        }
        this.quickSearchTableFilters.set({ ...(request.filters || {}) });
        this.forceShowLogAnomalyTableColumn.set(this.showTestResultsLogAnomalies() && !!request.forceShowLogAnomalies);
        this.isTableView.set(true);
        this.isLoading.set(false);
        this.imports.updateUploadProgress(false);
      });

    this.loadTestResultsLogAnomalySetting();
    this.loadRegexSearchSetting();
    this.loadCodingStatusAutoRefreshSetting();
    this.createTestResultsList(0, this.pageSize());
    this.loadWorkspaceOverview();
    this.startValidationStatusCheck();
    this.checkExistingExportJobs();
    this.isInitialized = true;
  }

  ngOnDestroy(): void {
    this.testResultsRequestGeneration += 1;
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
      this.searchSubscription = null;
    }
    if (this.flatFilterRequestSubscription) {
      this.flatFilterRequestSubscription.unsubscribe();
      this.flatFilterRequestSubscription = null;
    }

    this.stopValidationStatusCheck();
    this.stopExportStatusPolling();
  }

  protected toggleTableView(): void {
    this.isTableView.set(!this.isTableView());
  }

  private startValidationStatusCheck(): void {
    this.checkValidationStatus();

    this.validationStatusInterval = window.setInterval(() => {
      this.checkValidationStatus();
    }, 1000);
  }

  private stopValidationStatusCheck(): void {
    if (this.validationStatusInterval !== null) {
      window.clearInterval(this.validationStatusInterval);
      this.validationStatusInterval = null;
    }
  }

  private checkValidationStatus(): void {
    if (!this.isInitialized || !this.appService.selectedWorkspaceId) {
      return;
    }

    const taskIds = this.validationTaskStateService.getAllTaskIds(
      this.appService.selectedWorkspaceId
    );

    if (Object.keys(taskIds).length > 0) {
      for (const [type, task] of Object.entries(taskIds)) {
        this.validationService
          .getValidationTask(this.appService.selectedWorkspaceId, task.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: updatedTask => {
              if (updatedTask.status === 'completed' || updatedTask.status === 'failed') {
                this.validationTaskStateService.removeTaskId(
                  this.appService.selectedWorkspaceId,
                  type as ValidationType
                );
              } else {
                // Update task details in state service to keep progress up to date
                this.validationTaskStateService.setTaskId(
                  this.appService.selectedWorkspaceId,
                  type as ValidationType,
                  updatedTask
                );
              }
            },
            error: () => {
              this.validationTaskStateService.removeTaskId(
                this.appService.selectedWorkspaceId,
                type as ValidationType
              );
            }
          });
      }
    }
  }

  protected isAnyValidationRunning(): boolean {
    if (!this.appService.selectedWorkspaceId) {
      return false;
    }

    const taskIds = this.validationTaskStateService.getAllTaskIds(
      this.appService.selectedWorkspaceId
    );
    return Object.keys(taskIds).length > 0;
  }

  getOverallValidationStatus(): 'running' | 'failed' | 'success' | 'partial' | 'not-run' {
    if (this.isAnyValidationRunning()) {
      return 'running';
    }

    if (this.appService.selectedWorkspaceId) {
      const results = this.validationTaskStateService.getAllValidationResults(
        this.appService.selectedWorkspaceId
      );

      if (Object.keys(results).length > 0) {
        const hasFailedValidation = Object.values(results).some(
          result => result.status === 'failed'
        );
        if (hasFailedValidation) {
          return 'failed';
        }

        const validationTypes = [
          'variables',
          'variableTypes',
          'responseStatus',
          'testTakers',
          'duplicateResponses',
          'groupResponses'
        ];
        const hasAllValidations = validationTypes.every(
          type => results[type]
        );
        if (hasAllValidations) {
          return 'success';
        }

        return 'partial';
      }
    }

    return 'not-run';
  }

  onRowClick(row: P): void { return this.details.onRowClick(row); }

  sortBooklets(): void { return this.details.sortBooklets(); }

  sortBookletUnits(): void { return this.details.sortBookletUnits(); }

  protected getUnitTags(unitId: number): UnitTagDto[] {
    return this.unitTagsMap().get(unitId) || [];
  }

  toggleResponseExpansion(responseId: number): void { return this.details.toggleResponseExpansion(responseId); }

  loadAllUnitTags(): void { return this.details.loadAllUnitTags(); }

  loadAllUnitNotes(): void { return this.details.loadAllUnitNotes(); }

  replayBooklet(booklet: Booklet) {
    if (!booklet || !booklet.name) {
      this.snackBar.open('Ungültiges Testheft', 'Info', { duration: 3000 });
      return;
    }

    const testPerson = this.buildReplayTestPerson(booklet.name);
    if (!testPerson) {
      this.snackBar.open('Keine gültige Testperson ausgewählt', 'Info', {
        duration: 3000
      });
      return;
    }

    const loadingSnackBar = this.snackBar.open('Lade Testheft...', '', {
      duration: 3000
    });

    this.unitsReplayService
      .getUnitsFromFileUpload(
        this.appService.selectedWorkspaceId,
        booklet.name,
        testPerson
      ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: bookletReplay => {
          loadingSnackBar.dismiss();

          if (
            !bookletReplay ||
            !bookletReplay.units ||
            bookletReplay.units.length === 0
          ) {
            this.snackBar.open('Keine Units im Testheft vorhanden', 'Info', {
              duration: 3000
            });
            return;
          }
          const serializedBooklet = this.serializeUnitsData(bookletReplay);
          const firstUnit = bookletReplay.units[0];

          const queryParams = {
            mode: 'booklet-view',
            unitsData: serializedBooklet,
            workspaceId: this.appService.selectedWorkspaceId
          };

          const url = this.router.serializeUrl(
            this.router.createUrlTree(
              [
                `replay/${testPerson}/${firstUnit.name}/0/0`
              ],
              { queryParams: queryParams }
            )
          );

          window.open(`${window.location.origin}/#${url}`, '_blank');

          if (
            bookletReplay.skippedUnits &&
            bookletReplay.skippedUnits > 0
          ) {
            this.snackBar.open(
              `${bookletReplay.skippedUnits} nicht replaybare Booklet-Units wurden übersprungen.`,
              'Info',
              { duration: 5000 }
            );
          }
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open('Fehler beim Laden des Testhefts', 'Fehler', {
            duration: 3000
          });
        }
      });
  }

  protected canReplayBooklet(): boolean {
    return !!this.testPerson()?.login?.trim();
  }

  private buildReplayTestPerson(bookletName: string): string | null {
    const login = this.testPerson()?.login?.trim();
    if (!login) {
      return null;
    }

    return [
      login,
      this.testPerson()?.code ?? '',
      this.testPerson()?.group ?? '',
      bookletName
    ].join('@');
  }

  protected replayUnit() {
    if (
      !this.selectedUnit() ||
      !this.testPerson() ||
      !this.appService.selectedWorkspaceId
    ) {
      this.snackBar.open(
        'Keine gültige Unit oder Testperson ausgewählt',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    if (!this.responses() || this.responses().length === 0) {
      this.snackBar.open('Keine Antworten für diese Unit vorhanden', 'Info', {
        duration: 3000
      });
      return;
    }

    const firstResponse = this.responses()[0];

    this.statisticsService
      .getReplayUrl(this.appService.selectedWorkspaceId, firstResponse.id).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (result && result.replayUrl) {
            window.open(result.replayUrl, '_blank');
          } else {
            this.snackBar.open(
              'Replay-URL konnte nicht erzeugt werden',
              'Fehler',
              { duration: 3000 }
            );
          }
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Replay-URL',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  protected applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.selection.clear();
    this.personSearchText.set(filterValue);
    this.isSearching.set(filterValue.trim() !== this.appliedPersonSearchText());
    this.searchSubject.next(filterValue);
  }

  protected openBookletLogsDialog(booklet: Booklet) {
    if (!booklet.logs || booklet.logs.length === 0) {
      this.snackBar.open('Keine Logs für dieses Testheft vorhanden', 'Info', {
        duration: 3000
      });
      return;
    }

    this.dialog.open(LogDialogComponent, {
      width: '700px',
      data: {
        logs: booklet.logs,
        sessions: booklet.sessions,
        units: booklet.units
      }
    });
  }

  protected openUnitLogsDialog() {
    const selectedUnitSnapshot = this.selectedUnit();

    if (!selectedUnitSnapshot || !this.logs() || this.logs().length === 0) {
      this.snackBar.open('Keine Logs für diese Unit vorhanden', 'Info', {
        duration: 3000
      });
      return;
    }

    this.dialog.open(UnitLogsDialogComponent, {
      width: '700px',
      data: {
        logs: this.logs(),
        title: `Logs für Unit: ${
          selectedUnitSnapshot.alias || 'Unbenannte Einheit'
        }`
      }
    });
  }

  protected openTagsDialog() {
    const selectedUnitSnapshot = this.selectedUnit();

    if (!selectedUnitSnapshot || !selectedUnitSnapshot.id) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(TagDialogComponent, {
      width: '500px',
      data: {
        unitId: selectedUnitSnapshot.id as number,
        tags: this.unitTags(),
        title: `Tags für Unit: ${
          selectedUnitSnapshot.alias || 'Unbenannte Einheit'
        }`
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        this.unitTags.set(result);
        this.unitTagsMap.update(value => {
          const next = new Map(value);
          next.set(selectedUnitSnapshot?.id as number, result);
          return next;
        });
      }
    });
  }

  protected openNotesDialog() {
    const selectedUnitSnapshot = this.selectedUnit();

    if (!selectedUnitSnapshot || !selectedUnitSnapshot.id) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(NoteDialogComponent, {
      width: '600px',
      data: {
        unitId: selectedUnitSnapshot.id as number,
        notes: this.unitNotes(),
        title: `Notizen für Unit: ${
          selectedUnitSnapshot.alias || 'Unbenannte Einheit'
        }`
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        this.unitNotes.set(result);
        this.unitNotesMap.update(value => {
          const next = new Map(value);
          next.set(selectedUnitSnapshot?.id as number, result);
          return next;
        });
      }
    });
  }

  protected onUnitClick(unit: Unit, booklet: Booklet): void { return this.details.onUnitClick(unit, booklet); }

  loadUnitTags(): void { return this.details.loadUnitTags(); }

  loadUnitNotes(): void { return this.details.loadUnitNotes(); }

  protected hasUnitNotes(unitId: number): boolean {
    if (!unitId || !this.unitNotesMap().has(unitId)) {
      return false;
    }
    const notes = this.unitNotesMap().get(unitId) || [];
    return notes.length > 0;
  }

  protected setSelectedBooklet(booklet: Booklet) { return this.details.setSelectedBooklet(booklet); }

  calculateBookletProcessingTime(booklet: Booklet): number | null {
    if (
      !booklet.logs ||
      !Array.isArray(booklet.logs) ||
      booklet.logs.length === 0
    ) {
      return null;
    }

    const pollingLog = booklet.logs.find(
      (log: BookletLog) => log.key === 'CONTROLLER' && log.parameter === 'RUNNING'
    );
    const terminatedLog = booklet.logs.find(
      (log: BookletLog) => log.key === 'CONTROLLER' && log.parameter === 'TERMINATED'
    );
    if (pollingLog && terminatedLog) {
      const pollingTime = Number(pollingLog.ts);
      const terminatedTime = Number(terminatedLog.ts);

      if (!Number.isNaN(pollingTime) && !Number.isNaN(terminatedTime)) {
        return terminatedTime - pollingTime;
      }
    }

    return null;
  }

  protected isBookletComplete(booklet: Booklet): boolean {
    if (
      !booklet.logs ||
      !Array.isArray(booklet.logs) ||
      booklet.logs.length === 0
    ) {
      return true;
    }

    if (
      !booklet.units ||
      !Array.isArray(booklet.units) ||
      booklet.units.length === 0
    ) {
      return false;
    }
    const unitIdLogs = booklet.logs.filter(
      (log: BookletLog) => log.key === 'CURRENT_UNIT_ID'
    );
    const unitAliases = booklet.units
      .map((unit: Unit) => unit.alias)
      .filter((alias: string | null) => alias !== null) as string[];

    const allUnitsVisited = unitAliases.every((alias: string) => unitIdLogs.some((log: BookletLog) => log.parameter === alias)
    );

    return allUnitsVisited && unitAliases.length > 0;
  }

  protected hasShortProcessingTime(booklet: Booklet): boolean {
    if (
      !booklet.logs ||
      !Array.isArray(booklet.logs) ||
      booklet.logs.length === 0
    ) {
      return false;
    }

    const processingTime = this.calculateBookletProcessingTime(booklet);
    return (
      processingTime === null ||
      processingTime < this.SHORT_PROCESSING_TIME_THRESHOLD_MS
    );
  }

  protected hasGeogebraResponse(unit: Unit): boolean {
    if (!unit || !unit.results || !Array.isArray(unit.results)) {
      return false;
    }

    return unit.results.some(
      (response: UnitResult) => response.value && response.value.startsWith('UEsD')
    );
  }

  protected getColor(status: string): string {
    switch (status) {
      case 'VALUE_CHANGED':
        return 'green';
      case 'NOT_REACHED':
        return 'blue';
      case 'CODING_INCOMPLETE':
        return 'red';
      case 'CODING_COMPLETE':
        return 'violet';
      default:
        return 'lightgrey';
    }
  }

  getCurrentSearchText(): string {
    return this.personSearchText();
  }

  protected clearSearch(): void {
    this.searchSubject.next('');
    this.createTestResultsList(0, this.pageSize());
  }

  protected onPaginatorChange(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
    this.createTestResultsList(
      this.pageIndex(),
      this.pageSize(),
      this.getCurrentSearchText()
    );
  }

  createTestResultsList(
    page: number = 0,
    limit: number = 50,
    searchText: string = ''
  ): void {
    this.testResultsRequestGeneration += 1;
    const requestGeneration = this.testResultsRequestGeneration;
    const workspaceId = this.appService.selectedWorkspaceId;
    this.selection.clear();
    this.pageIndex.set(page);
    this.pageSize.set(limit);
    this.testResultsRequest = { page, limit, searchText };
    this.personSearchText.set(searchText);
    this.appliedPersonSearchText.set(null);
    this.isLoading.set(true);
    this.testResultsLoadFailed.set(false);
    this.testResultService
      .getTestResults(workspaceId, page, limit, searchText)
      .pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          if (requestGeneration !== this.testResultsRequestGeneration ||
            workspaceId !== this.appService.selectedWorkspaceId) return;
          this.isLoading.set(false);
          this.appliedPersonSearchText.set(searchText.trim());
          this.isSearching.set(this.personSearchText().trim() !== searchText.trim());
          const { data, total } = response;
          this.updateTable(data, total);
        },
        error: () => {
          if (requestGeneration !== this.testResultsRequestGeneration ||
            workspaceId !== this.appService.selectedWorkspaceId) return;
          this.isLoading.set(false);
          this.isSearching.set(false);
          this.testResultsLoadFailed.set(true);
        }
      });
  }

  retryTestResultsLoad(): void {
    const { page, limit, searchText } = this.testResultsRequest;
    this.createTestResultsList(page, limit, searchText);
  }

  private loadWorkspaceOverview(): void { return this.statistics.loadWorkspaceOverview(); }

  private loadTestResultsLogAnomalySetting(): void { return this.statistics.loadTestResultsLogAnomalySetting(); }

  private loadRegexSearchSetting(): void { return this.statistics.loadRegexSearchSetting(); }

  private loadCodingStatusAutoRefreshSetting(): void { return this.statistics.loadCodingStatusAutoRefreshSetting(); }

  private setAutoRefreshCodingStatus(enabled: boolean): void { return this.statistics.setAutoRefreshCodingStatus(enabled); }

  private loadLogAnomalySummary(): void { return this.statistics.loadLogAnomalySummary(); }

  protected loadLogAnomalySummaryOnDemand(): void {
    this.loadLogAnomalySummary();
  }

  private reloadLogAnomalySummaryIfRequested(): void { return this.statistics.reloadLogAnomalySummaryIfRequested(); }

  readonly hasLogAnomalySummary = this.summary.hasLogAnomalySummary;

  protected readonly logAnomalyAffectedPercent = this.summary.logAnomalyAffectedPercent;

  protected get logAnomalyTopCodes(): Array<{ code: string; label: string; count: number }> { return this.summary.logAnomalyTopCodes(); }

  getLogAnomalyCodeLabel(code: string): string { return this.summary.getLogAnomalyCodeLabel(code); }

  showLogAnomaliesInTable(): void {
    this.quickSearchTableFilters.set({ logAnomalies: 'any' });
    this.forceShowLogAnomalyTableColumn.set(this.showTestResultsLogAnomalies());
    this.isTableView.set(true);
    this.isLoading.set(false);
    this.imports.updateUploadProgress(false);
  }

  protected openLogAnomalyDetailsDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const getLogAnomalyDetails =
      (this.testResultService as Partial<TestResultService>).getLogAnomalyDetails;
    if (!getLogAnomalyDetails) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Log-Auffälligkeiten...',
      '',
      { duration: undefined }
    );

    getLogAnomalyDetails.call(this.testResultService, workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: details => {
          loadingSnackBar.dismiss();
          if (!details.data.length) {
            this.snackBar.open(
              'Keine Log-Auffälligkeiten gefunden.',
              'OK',
              { duration: 4000 }
            );
            return;
          }

          const dialogRef = this.dialog.open<
            TestResultsLogAnomalyDetailsDialogComponent,
            {
              affectedBooklets: number;
              rows: LogAnomalyDetailRow[];
              truncated: boolean;
            },
          TestResultsLogAnomalyDetailsDialogResult | undefined
          >(TestResultsLogAnomalyDetailsDialogComponent, {
            width: '900px',
            maxWidth: '95vw',
            data: {
              affectedBooklets:
                this.logAnomalySummary()?.affectedBooklets || details.total,
              rows: details.data,
              truncated: details.total > details.data.length
            }
          });

          dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
            if (result?.showTable) {
              this.showLogAnomaliesInTable();
            }
          });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Log-Auffälligkeiten konnten nicht geladen werden.',
            'OK',
            { duration: 4000 }
          );
        }
      });
  }

  private loadCodingFreshnessStatus(
    options: { force?: boolean } = {}
  ): void { return this.statistics.loadCodingFreshnessStatus(options); }

  private refreshCodingFreshnessStatusAfterChange(): void { return this.statistics.refreshCodingFreshnessStatusAfterChange(); }

  private async fetchManualAppliedResultsOverview(
    workspaceId: number
  ): Promise<{ overview: AppliedResultsOverview | null; loadFailed: boolean }> { return this.statistics.fetchManualAppliedResultsOverview(workspaceId); }

  readonly overviewResponseStatusTotal = this.summary.overviewResponseStatusTotal;

  protected get overviewStatusCounts(): Array<{ status: string; count: number; percent: number }> { return this.summary.overviewStatusCounts(); }

  readonly codingFreshnessWarnings = this.summary.codingFreshnessWarnings;

  readonly hasCodingFreshnessWarning = this.summary.hasCodingFreshnessWarning;

  readonly codingFreshnessDisplayWarnings = this.summary.codingFreshnessDisplayWarnings;

  readonly autoCodingFreshnessWarnings = this.summary.autoCodingFreshnessWarnings;

  readonly manualCodingFreshnessWarnings = this.summary.manualCodingFreshnessWarnings;

  readonly hasOnlyManualCodingFreshnessWarnings = this.summary.hasOnlyManualCodingFreshnessWarnings;

  readonly codingFreshnessAffectedUnitVersions = this.summary.codingFreshnessAffectedUnitVersions;

  readonly codingFreshnessAffectedResponses = this.summary.codingFreshnessAffectedResponses;

  get codingFreshnessSummaryText(): string { return this.summary.codingFreshnessSummaryText; }

  protected get codingFreshnessExplanationText(): string { return this.summary.codingFreshnessExplanationText; }

  get codingFreshnessBannerTitle(): string { return this.summary.codingFreshnessBannerTitle; }

  readonly codingFreshnessActionLabel = this.summary.codingFreshnessActionLabel;

  protected readonly codingFreshnessActionIcon = this.summary.codingFreshnessActionIcon;

  getCodingFreshnessVersionLabel(version: CodingFreshnessVersion): string { return this.summary.getCodingFreshnessVersionLabel(version); }

  getCodingFreshnessStateLabel(state: CodingFreshnessState): string { return this.summary.getCodingFreshnessStateLabel(state); }

  getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string { return this.summary.getCodingFreshnessChipLabel(item); }

  private readonly shouldShowSecondAutocodingWaitingState = this.summary.shouldShowSecondAutocodingWaitingState;

  protected openCodingFreshnessTarget(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const target = (this.shouldShowSecondAutocodingWaitingState() || this.hasOnlyManualCodingFreshnessWarnings()) ?
      'manual' :
      'management';
    this.router.navigate([`/workspace-admin/${workspaceId}/coding/${target}`]);
  }

  onFlatTableResponseDeleted(): void {
    this.testResultService.invalidateCache(this.appService.selectedWorkspaceId);
    this.loadWorkspaceOverview();
    this.reloadLogAnomalySummaryIfRequested();
    this.refreshCodingFreshnessStatusAfterChange();
    this.testPersonCodingService.notifyTestResultsChanged();
  }

  get overviewBrowserCounts(): Array<{ key: string; count: number }> { return this.summary.overviewBrowserCounts(); }

  get overviewOsCounts(): Array<{ key: string; count: number }> { return this.summary.overviewOsCounts(); }

  get overviewScreenCounts(): Array<{ key: string; count: number }> { return this.summary.overviewScreenCounts(); }

  getBrowserTotal(): number { return this.summary.getBrowserTotal(); }

  getOsTotal(): number { return this.summary.getOsTotal(); }

  getScreenTotal(): number { return this.summary.getScreenTotal(); }

  getPercent(count: number, total: number): number { return this.summary.getPercent(count, total); }

  protected openSessionDistributionsDialog(): void {
    const overviewValue = this.overview();

    if (!overviewValue) {
      return;
    }

    this.dialog.open(SessionDistributionsDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: {
        browserCounts: overviewValue.sessionBrowserCounts || {},
        osCounts: overviewValue.sessionOsCounts || {},
        screenCounts: overviewValue.sessionScreenCounts || {}
      }
    });
  }

  protected openResponseStatusInTable(status: string): void {
    this.quickSearchTableFilters.set({ responseStatus: status });
    this.forceShowLogAnomalyTableColumn.set(false);
    this.isTableView.set(true);
    this.isLoading.set(false);
    this.imports.updateUploadProgress(false);
  }

  getResponseStatusTooltip(status: string): string { return this.summary.getResponseStatusTooltip(status); }

  protected isAllSelected(): boolean {
    const rows = this.dataSource?.data ?? [];
    return rows.length > 0 && rows.every(row => this.selection.isSelected(row));
  }

  protected masterToggle(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource?.data.forEach(row => this.selection.select(row));
    }
  }

  protected toggleRowSelection(row: P): void {
    this.selection.toggle(row);
  }

  private updateTable(data: Record<string, unknown>[], total: number): void {
    this.selection.clear();
    this.data = data as unknown as P[];
    const mappedResults = data.map((result: Record<string, unknown>) => ({
      id: result.id as number,
      code: result.code as string,
      group: result.group as string,
      login: result.login as string,
      uploaded_at: result.uploaded_at as Date
    }));
    this.dataSource = new MatTableDataSource(mappedResults);
    this.totalRecords.set(total);
    this.dataSource.sort = this.sort() ?? null;
  }

  openImportDialog(): void {
    const dialogRef = this.dialog.open(TestResultsImportDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(async result => {
      if (result) {
        switch (result.type) {
          case 'testcenter':
            await this.testCenterImport();
            break;
          case 'responses':
            this.hiddenResponsesFileInput().nativeElement.click();
            break;
          case 'logs':
            this.hiddenLogsFileInput().nativeElement.click();
            break;
          default:
            break;
        }
      }
    });
  }

  async testCenterImport(): Promise<void> { return this.imports.testCenterImport(); }

  onFileSelected(
    targetElement: EventTarget | null,
    resultType: 'logs' | 'responses'
  ) { return this.imports.onFileSelected(targetElement, resultType); }

  protected deleteSelectedPersons(): void {
    const selectedTestPersons = this.selection.selected;
    if (!this.isPersonListCurrent() || selectedTestPersons.length === 0) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'persons',
      personIds: selectedTestPersons.map(person => person.id)
    });
  }

  protected deleteFilteredPersons(): void {
    if (!this.isPersonListCurrent()) return;
    this.confirmAndStartDelete({
      scope: 'filteredPersons',
      searchText: this.testResultsRequest.searchText
    });
  }

  protected get hasPersonFilter(): boolean {
    return this.personSearchText().trim().length > 0;
  }

  protected deleteFilteredGroups(): void {
    if (!this.isPersonListCurrent()) return;
    this.confirmAndStartDelete({
      scope: 'filteredGroups',
      searchText: this.testResultsRequest.searchText
    });
  }

  protected deleteSelectedGroups(): void {
    if (!this.isPersonListCurrent()) return;
    const groups = Array.from(
      new Set(
        this.selection.selected
          .map(person => person.group)
          .filter(group => group && group.trim().length > 0)
      )
    );

    if (groups.length === 0) {
      this.snackBar.open('Keine Testgruppe ausgewählt.', 'Info', {
        duration: 3000
      });
      return;
    }

    this.confirmAndStartDelete({
      scope: 'groups',
      groups
    });
  }

  protected deleteBookletsByName(bookletName: string): void {
    if (!bookletName) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'booklets',
      bookletNames: [bookletName]
    });
  }

  protected deleteUnitsByName(unit: Unit): void {
    const unitName = unit.alias || unit.name;
    if (!unitName) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'units',
      unitNames: [unitName]
    });
  }

  protected openResponseCleanupDialog(): void { return this.deletion.openResponseCleanupDialog(); }

  protected isDeleteJobRunning(): boolean { return this.deletion.isDeleteJobRunning(); }

  private confirmAndStartDelete(request: TestResultsDeleteRequestDto): void { return this.deletion.confirmAndStartDelete(request); }

  private resetSelectedResultDetails(): void { return this.details.resetSelectedResultDetails(); }

  protected openTestResultsSearchDialog(): void {
    const dialogRef = this.dialog.open(TestResultsSearchComponent, {
      width: '1200px',
      data: {
        title: 'Testergebnisse schnell finden'
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((result?: QuickSearchDialogResult) => {
      if (!result) {
        return;
      }

      if (result.action === 'table') {
        this.quickSearchTableFilters.set(result.filters || null);
        this.forceShowLogAnomalyTableColumn.set(false);
        this.isTableView.set(true);
        return;
      }

      this.openQuickSearchBrowserTarget(result.item);
    });
  }

  private openQuickSearchBrowserTarget(item: QuickSearchResultItem): void {
    if (item.personId && this.appService.selectedWorkspaceId) this.isTableView.set(false);
    this.details.openQuickSearchBrowserTarget(item);
  }

  deleteUnit(unit: Unit, booklet: Booklet): void { return this.deletion.deleteUnit(unit, booklet); }

  deleteResponse(response: Response): void { return this.deletion.deleteResponse(response); }

  protected openValidationDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const shouldAutoStart = workspaceId ?
      !this.validationTaskStateService.hasAnyValidationResult(workspaceId) :
      true;

    const dialogRef = this.dialog.open(ValidationDialogComponent, {
      width: '90vw',
      maxWidth: '1400px',
      height: '90vh',
      autoFocus: false,
      data: {
        autoStart: shouldAutoStart
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        if (result.variableValidationResult) {
          this.variableValidationResult.set(result.variableValidationResult);
          this.isVariableValidationRunning.set(false);
        }
        this.checkValidationStatus();
        this.getOverallValidationStatus();
      }
    });
  }

  private serializeUnitsData(booklet: UnitsReplay): string {
    try {
      const jsonString = JSON.stringify(booklet);
      return utf8ToBase64(jsonString);
    } catch (error) {
      return '';
    }
  }

  protected openVariableAnalysisDialog(): void {
    const loadingSnackBar = this.snackBar.open('Lade Analyse-Aufträge...', '', {
      duration: 3000
    });

    this.variableAnalysisService
      .getAllJobs(this.appService.selectedWorkspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: jobs => {
          loadingSnackBar.dismiss();

          const variableAnalysisJobs = jobs.filter(
            job => job.type === 'variable-analysis'
          );

          this.dialog.open(VariableAnalysisDialogComponent, {
            width: 'min(96vw, 1320px)',
            maxWidth: '96vw',
            data: {
              unitId: this.selectedUnit()?.id,
              title: 'Antwortwertanalyse',
              workspaceId: this.appService.selectedWorkspaceId,
              jobs: variableAnalysisJobs
            }
          });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Analyse-Aufträge',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  openBookletInfo(bookletName: string): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    const loadingSnackBar = this.snackBar.open(
      'Lade Booklet-Informationen...',
      '',
      { duration: 3000 }
    );

    this.fileService
      .getBookletInfo(workspaceId, bookletName)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss()))
      .subscribe({
        next: (bookletInfo: BookletInfoDto) => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          loadingSnackBar.dismiss();

          this.dialog.open(BookletInfoDialogComponent, {
            width: 'min(96vw, 1400px)',
            maxWidth: '96vw',
            height: '92vh',
            maxHeight: '92vh',
            data: {
              bookletInfo,
              bookletId: bookletName
            }
          });
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Booklet-Informationen',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  openUnitInfoForSelectedUnit(): void {
    const selectedUnitSnapshot = this.selectedUnit();

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!selectedUnitSnapshot || !selectedUnitSnapshot.name) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const unitFileId = String(selectedUnitSnapshot.name || '')
      .trim()
      .toUpperCase();
    if (!unitFileId) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Unit-Informationen...',
      '',
      { duration: 3000 }
    );

    this.fileService
      .getUnitInfo(workspaceId, unitFileId)
      .pipe(takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss()))
      .subscribe({
        next: (unitInfo: UnitInfoDto) => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          loadingSnackBar.dismiss();

          this.dialog.open(UnitInfoDialogComponent, {
            width: 'min(96vw, 1400px)',
            maxWidth: '96vw',
            height: '92vh',
            maxHeight: '92vh',
            data: {
              unitInfo,
              unitId: unitFileId
            }
          });
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Unit-Informationen',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  protected openExportDialog(): void { return this.exports.openExportDialog(); }

  private checkExistingExportJobs(): void { return this.exports.checkExistingExportJobs(); }

  private stopExportStatusPolling(): void { return this.exports.stopExportStatusPolling(); }

  downloadExportResult(jobId: string): void { return this.exports.downloadExportResult(jobId); }
}
