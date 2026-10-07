import {
  MatTable,
  MatHeaderCellDef,
  MatCellDef,
  MatHeaderRowDef,
  MatRowDef,
  MatTableDataSource,
  MatCell,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderRow,
  MatRow
} from '@angular/material/table';
import {
  Component, DestroyRef, ElementRef, inject, OnDestroy, OnInit, signal, computed, viewChild, effect, ChangeDetectionStrategy
} from '@angular/core';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  MatPaginator,
  MatPaginatorModule,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import {
  BehaviorSubject,
  ReplaySubject,
  Subject,
  Subscription,
  catchError,
  debounceTime,
  distinctUntilChanged,
  finalize,
  firstValueFrom,
  forkJoin,
  of,
  switchMap,
  takeUntil,
  takeWhile,
  timer as rxjsTimer
} from 'rxjs';
import { SelectionModel } from '@angular/cdk/collections';
import {
  MatAccordion,
  MatExpansionPanel,
  MatExpansionPanelHeader,
  MatExpansionPanelTitle
} from '@angular/material/expansion';
import { MatList, MatListItem } from '@angular/material/list';
import { MatInput } from '@angular/material/input';
import { CommonModule, DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { Router } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatProgressBar } from '@angular/material/progress-bar';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDivider } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TestResultsImportDialogComponent } from './test-results-import-dialog.component';
import { TestResultsExportDialogComponent } from './test-results-export-dialog.component';
import { SessionDistributionsDialogComponent } from './session-distributions-dialog.component';
import { FileService } from '../../../shared/services/file/file.service';
import {
  TestResultBackendService,
  TestResultExportJob
} from '../../../shared/services/test-result/test-result-backend.service';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { getResponseStatusTooltipKey } from '../../../shared/utils/response-status-metadata.util';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import {
  AppliedResultsOverview,
  TestPersonCodingService
} from '../../../coding/services/test-person-coding.service';
import { VariableAnalysisService } from '../../../shared/services/response/variable-analysis.service';
import { AppService } from '../../../core/services/app.service';
import {
  TestResultService,
  TestResultsOverviewResponse,
  PersonTestResult,
  QuickSearchResultItem,
  LogAnomalyDashboardSummary,
  LogAnomalyDetailRow
} from '../../../shared/services/test-result/test-result.service';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { TagDialogComponent } from '../tag-dialog/tag-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import {
  QuickSearchDialogResult,
  TestResultsSearchComponent
} from '../test-results-search/test-results-search.component';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { ValidationDialogComponent } from '../validation-dialog/validation-dialog.component';
import { VariableValidationDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';
import {
  ValidationTaskStateService,
  ValidationType
} from '../../../shared/services/validation/validation-task-state.service';
import {
  UnitsReplay,
  UnitsReplayService
} from '../../../replay/services/units-replay.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { UnitInfoDto } from '../../../../../../../api-dto/unit-info/unit-info.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import {
  ExportOptionsDialogComponent,
  ExportOptions
} from './export-options-dialog.component';
import {
  TestResultsLogAnomalyDetailsDialogComponent,
  TestResultsLogAnomalyDetailsDialogResult
} from './test-results-log-anomaly-details-dialog.component';

import { ImportResultDto } from '../../../../../../../api-dto/files/import-options.dto';
import {
  TestResultsUploadIssueDto,
  TestResultsUploadResultDto
} from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import {
  CodingFreshnessState,
  CodingFreshnessSummaryDto,
  CodingFreshnessSummaryItemDto,
  CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import {
  CODING_FRESHNESS_TASK_RESULT_HELP,
  getCodingFreshnessAffectedResponseCount,
  getCodingFreshnessAffectedTaskResultCount,
  getCodingFreshnessAttentionTitle,
  getCodingFreshnessAutoCodingWarnings,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessManualReviewWarnings,
  getCodingFreshnessStateLabel,
  getCodingFreshnessSummaryText,
  getCodingFreshnessVersionLabel,
  formatCodingFreshnessTaskResultCount,
  getSecondAutocodingFreshnessWarnings,
  hasOnlyManualCodingFreshnessWarnings,
  isCodingFreshnessOpenWarning,
  isSecondAutocodingWaitingForManualCoding,
  SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS
} from '../../../shared/utils/coding-freshness-text.util';
import { TestResultsUploadResultDialogComponent } from './test-results-upload-result-dialog.component';
import {
  TestResultsImportProgressDialogComponent,
  TestResultsImportProgressState
} from './test-results-import-progress-dialog.component';
import { TestResultsDeletePreviewDialogComponent } from './test-results-delete-preview-dialog.component';
import { TestResultsResponseCleanupDialogComponent } from './test-results-response-cleanup-dialog.component';
import {
  PendingUploadBatch,
  TestResultsUploadStateService
} from '../../services/test-results-upload-state.service';
import {
  FlatResponseFilters,
  TestResultsFlatTableComponent
} from './test-results-flat-table.component';
import {
  OverwriteMode,
  TestResultsUploadOptionsDialogComponent,
  TestResultsUploadOptionsDialogData,
  TestResultsUploadOptionsDialogResult
} from './test-results-upload-options-dialog.component';
import {
  TestResultsDeletePreviewDto,
  TestResultsDeleteRequestDto,
  TestResultsDeleteResultDto,
  TestResultsResponseCleanupRequestDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { utf8ToBase64 } from '../../../shared/utils/common-utils';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';

interface BookletLog {
  id: number;
  bookletid: number;
  ts: string;
  parameter: string;
  key: string;
}

interface BookletSession {
  id: number;
  browser: string;
  os: string;
  screen: string;
  ts: string;
}

interface UnitResult {
  id: number;
  unitid: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code?: number;
  score?: number;
  codedstatus?: string;
}

interface UnitLog {
  id: number;
  unitid: number;
  ts: string;
  key: string;
  parameter: string;
}

interface Unit {
  id: number;
  bookletid: number;
  name: string;
  alias: string | null;
  results: UnitResult[];
  logs: UnitLog[];
  tags: UnitTagDto[];
}

interface Booklet {
  id: number;
  personid: number;
  name: string;
  title?: string;
  size: number;
  logs: BookletLog[];
  sessions?: BookletSession[];
  units: Unit[];
}

interface Response {
  id: number;
  unitid: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code?: number;
  score?: number;
  codedstatus?: string;
  expanded?: boolean;
}

interface P {
  id: number;
  code: string;
  group: string;
  login: string;
  uploaded_at: Date;
}

const RESPONSE_STATUS_INFO: Record<
  string,
  { numeric: number; description: string }
> = {
  UNSET: {
    numeric: 0,
    description:
      'Ausgangszustand beim Anlegen von Variablen. Sollte eine Variable an ein Interaktionselement gebunden sein, dann erhält sie jedoch sofort den Status NOT_REACHED.'
  },
  NOT_REACHED: {
    numeric: 1,
    description:
      'Ausgangszustand beim Anlegen von Variablen, die an ein Interaktionselement gebunden sind.'
  },
  DISPLAYED: {
    numeric: 2,
    description:
      'Variablen, die an ein Interaktionselement gebunden sind, bekommen diesen Status, wenn sie der Testperson präsentiert wurden - also sichtbar sind.'
  },
  VALUE_CHANGED: {
    numeric: 3,
    description:
      'Dieser Status zeigt an, dass eine Interaktion stattgefunden hat und also der Wert (Value) auszuwerten ist. Bei abgeleiteten Variablen zeigt dieser Status eine erfolgreiche Ableitung an.'
  },
  CODING_COMPLETE: {
    numeric: 5,
    description: 'Die Kodierung der Variablen ist erfolgreich abgeschlossen.'
  },
  NO_CODING: {
    numeric: 6,
    description:
      'Bei diesem Status wurde festgestellt, dass keine Informationen für eine Kodierung vorliegen (keine Codes sind im Kodierschema definiert). Das stellt eine Fehlersituation dar.'
  },
  INVALID: {
    numeric: 7,
    description:
      'Es wurde bei diesem Status eine Antwort festgestellt, die außerhalb des zulässigen Bereiches liegt. Beispielsweise wurde zwar zunächst ein Text eingegeben, dann aber alles gelöscht, so dass eine leere Antwort gespeichert wurde. Mit diesem Code werden auch Spaßantworten “Mir ist langweilig” kodiert.'
  },
  CODING_INCOMPLETE: {
    numeric: 8,
    description:
      'Dieser Code zeigt nach einem Durchlauf einer Kodierprozedur an, dass keiner der vorgesehenen Codes als zutreffend angesehen wurde. Dieser Kodierfall muss dann manuell gesichtet werden.'
  },
  CODING_ERROR: {
    numeric: 9,
    description:
      'Während der Kodierung ist ein Fehler aufgetreten, der die Bewertung der Antwort verhindert hat. Dies kann ein technischer Fehler bei der Anzeige (Replay) für das manuelle Kodieren sein, aber auch Typkonflikte zwischen dem Wert und dem Kodierschema können die Ursache sein.'
  },
  PARTLY_DISPLAYED: {
    numeric: 10,
    description:
      'Diesen Zustand erhalten abgeleitete Variablen, die von Variablen abgeleitet wurden mit dem Status PARTLY_DISPLAYED oder mit DISPLAYED sowie außerdem den Status NOT_REACHED oder UNSET.'
  },
  DERIVE_PENDING: {
    numeric: 11,
    description:
      'Dieser Status zeigt an, dass eine Ableitung nicht möglich ist, weil mindestens eine Variable, die zur Ableitung nötig ist, den Status CODING_INCOMPLETE oder CODING_ERROR hat. Im Arbeitsablauf “wartet” diese Variable also darauf, dass eine manuelle Kodierung zu CODING_COMPLETE führt und der Autocoder neu angestoßen wird.'
  },
  INTENDED_INCOMPLETE: {
    numeric: 12,
    description:
      'Die Kodierung der Variablen ist nicht abgeschlossen, aber dies stellt keinen Fehler dar. Es handelt sich hier z. B. um Variablen, die über andere Wege kodiert werden sollen (z. B. Rating oder Übersetzung in Berufe-Codes außerhalb der regulären Kodierprozesse). Es kann auch sein, dass der Variablenwert erst durch eine Ableitung ausgewertet wird und innerhalb der Variable keine isolierte Bewertung möglich ist.'
  },
  CODE_SELECTION_PENDING: { numeric: 13, description: '' }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-results',
  templateUrl: './test-results.component.html',
  styleUrls: ['./test-results.component.scss'],
  standalone: true,
  providers: [
    DatePipe,
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
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
  private readonly selectedResultRequestsCancelled = new Subject<void>();
  private unitNotesRequest?: Subscription;
  private cancelTestCenterImport: (() => void) | null = null;
  private dialog = inject(MatDialog);
  private testResultBackendService = inject(TestResultBackendService);
  private validationService = inject(ValidationService);
  private unitNoteService = inject(UnitNoteService);
  private fileService = inject(FileService);
  private responseService = inject(ResponseService);
  private unitService = inject(UnitService);
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
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private deleteTaskSubscription: Subscription | null = null;
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
  readonly booklets = signal<Booklet[]>([]);
  results: { [key: string]: unknown }[] = [];
  readonly responses = signal<Response[]>([]);
  readonly logs = signal<UnitLog[]>([]);
  readonly bookletLogs = signal<{
    [key: string]: unknown;
  }[]>([]);

  protected readonly totalRecords = signal<number>(0);
  protected readonly pageSize = signal<number>(50);
  protected readonly pageIndex = signal<number>(0);
  readonly selectedUnit = signal<Unit | undefined>(undefined);
  readonly testPerson = signal<P | null>(null);
  protected readonly selectedBooklet = signal<Booklet | string>('');
  protected readonly isLoading = signal<boolean>(true);
  protected readonly isUploadingResults = signal<boolean>(false);
  protected readonly isSearching = signal<boolean>(false);
  readonly isLoadingBooklets = signal<boolean>(false);
  protected readonly isDeletingTestPersons = signal<boolean>(false);
  readonly activeDeleteTask = signal<ValidationTaskDto | null>(null);
  protected readonly deleteProgress = signal<number>(0);
  protected readonly deleteProgressMessage = signal<string>('');
  readonly unitTags = signal<UnitTagDto[]>([]);
  readonly unitTagsMap = signal<Map<number, UnitTagDto[]>>(new Map());
  readonly unitNotes = signal<UnitNoteDto[]>([]);
  readonly unitNotesMap = signal<Map<number, UnitNoteDto[]>>(new Map());
  readonly isVariableValidationRunning = signal<boolean>(false);
  readonly variableValidationResult = signal<VariableValidationDto | null>(null);
  readonly SHORT_PROCESSING_TIME_THRESHOLD_MS: number = 60000;
  private validationStatusInterval: number | null = null;
  private exportStatusInterval: number | null = null;
  private isInitialized: boolean = false;

  readonly overview = signal<TestResultsOverviewResponse | null>(null);
  readonly isLoadingOverview = signal<boolean>(false);
  readonly showTestResultsLogAnomalies = signal<boolean>(false);
  readonly enableRegexSearch = signal<boolean>(false);
  readonly logAnomalySummary = signal<LogAnomalyDashboardSummary | null>(null);
  readonly isLoadingLogAnomalySummary = signal<boolean>(false);
  readonly logAnomalySummaryLoadFailed = signal<boolean>(false);
  readonly logAnomalySummaryRequested = signal<boolean>(false);
  readonly codingFreshnessSummary = signal<CodingFreshnessSummaryDto | null>(null);
  readonly manualAppliedResultsOverview = signal<AppliedResultsOverview | null>(null);
  readonly manualAppliedResultsOverviewLoadFailed = signal<boolean>(false);
  readonly isLoadingManualAppliedResultsOverview = signal<boolean>(false);
  readonly autoRefreshCodingStatus = signal<boolean>(true);
  readonly codingFreshnessStatusChecked = signal<boolean>(false);
  readonly isLoadingCodingFreshnessStatus = signal<boolean>(false);
  private codingFreshnessStatusRequestGeneration = 0;

  readonly exportJobId = signal<string | null>(null);
  protected readonly isExporting = signal<boolean>(false);
  readonly exportJobStatus = signal<string | null>(null);
  readonly exportJobProgress = signal<number>(0);
  readonly exportTypeInProgress = signal<'test-results' | 'test-logs' | null>(null);
  protected readonly uploadingMessage = signal('Ergebnisse werden hochgeladen...');

  readonly paginator = viewChild(MatPaginator);
  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    if (this.dataSource) this.dataSource.sort = this.sort() ?? null;
  });

  readonly hiddenResponsesFileInput = viewChild.required<ElementRef<HTMLInputElement>>('hiddenResponsesFileInput');

  readonly hiddenLogsFileInput = viewChild.required<ElementRef<HTMLInputElement>>('hiddenLogsFileInput');

  ngOnInit(): void {
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.resetSelectedResultDetails();
      this.testPerson.set(null);
    });
    this.searchSubscription = this.searchSubject
      .pipe(debounceTime(this.SEARCH_DEBOUNCE_TIME), distinctUntilChanged())
      .subscribe(searchText => {
        this.createTestResultsList(0, this.pageSize(), searchText);
      });

    // Sync with upload state service
    this.uploadStateService.uploadingBatches$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (batches: PendingUploadBatch[]) => {
        const myBatch = batches.find(
          (b: PendingUploadBatch) => b.workspaceId === this.appService.selectedWorkspaceId
        );
        if (myBatch) {
          this.isUploadingResults.set(true);
          this.uploadingMessage.set(`Verarbeite... ${myBatch.progress}% (${myBatch.completedCount}/${myBatch.totalJobs} Dateien)`);
          this.isLoading.set(true);
        } else {
          this.isUploadingResults.set(false);
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
        this.isUploadingResults.set(false);
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
        this.isUploadingResults.set(false);
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
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
      this.searchSubscription = null;
    }
    if (this.deleteTaskSubscription) {
      this.deleteTaskSubscription.unsubscribe();
      this.deleteTaskSubscription = null;
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
          .getValidationTask(this.appService.selectedWorkspaceId, task.id).pipe(takeUntilDestroyed(this.destroyRef))
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

  onRowClick(row: P): void {
    this.resetSelectedResultDetails();
    this.testPerson.set(row);
    this.isLoadingBooklets.set(true);
    this.testResultService
      .getPersonTestResults(this.appService.selectedWorkspaceId, row.id).pipe(
        takeUntil(this.selectedResultRequestsCancelled), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => { if (!this.destroyRef.destroyed) this.isLoadingBooklets.set(false); })
      )
      .subscribe({
        next: (booklets: PersonTestResult[]) => {
          this.selectedBooklet.set('');
          this.booklets.set(booklets as unknown as Booklet[]);
          this.sortBooklets();
          this.sortBookletUnits();
          this.loadAllUnitTags();
          this.loadAllUnitNotes();
          this.isLoadingBooklets.set(false);
        },
        error: () => {
          this.isLoadingBooklets.set(false);
        }
      });
  }

  sortBooklets(): void {
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }
    this.booklets.update(value => {
      const next = [...value];
      next.sort((a, b) => {
        const nameA = a.name || '';
        const nameB = b.name || '';
        return nameA.localeCompare(nameB);
      });
      return next;
    });
  }

  sortBookletUnits(): void {
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }

    this.booklets.update(booklets => booklets.map(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        const units = [...booklet.units].sort((a, b) => {
          const aliasA = a.alias || a.name || '';
          const aliasB = b.alias || b.name || '';
          return aliasA.localeCompare(aliasB);
        });
        return { ...booklet, units };
      }
      return booklet;
    }));
  }

  protected getUnitTags(unitId: number): UnitTagDto[] {
    return this.unitTagsMap().get(unitId) || [];
  }

  toggleResponseExpansion(responseId: number): void {
    this.responses.update(responses => responses.map(response => (response.id === responseId ? {
      ...response, expanded: !response.expanded
    } : response)));
  }

  loadAllUnitTags(): void {
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }
    this.unitTagsMap.set(new Map());
    this.booklets().forEach(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        booklet.units.forEach(unit => {
          if (unit.id && unit.tags) {
            this.unitTagsMap.update(value => {
              const next = new Map(value);
              next.set(unit.id, unit.tags);
              return next;
            });
          }
        });
      }
    });
  }

  loadAllUnitNotes(): void {
    this.unitNotesRequest?.unsubscribe();
    if (!this.booklets() || this.booklets().length === 0) {
      return;
    }
    this.unitNotesMap.set(new Map());
    const unitIds: number[] = [];
    this.booklets().forEach(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        booklet.units.forEach(unit => {
          if (unit.id) {
            unitIds.push(unit.id);
          }
        });
      }
    });

    if (unitIds.length === 0) {
      return;
    }

    this.unitNotesRequest = this.unitNoteService
      .getNotesForMultipleUnits(this.appService.selectedWorkspaceId, unitIds).pipe(
        takeUntil(this.selectedResultRequestsCancelled), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: notesByUnitId => {
          Object.entries(notesByUnitId).forEach(([unitId, notes]) => {
            this.unitNotesMap.update(value => {
              const next = new Map(value);
              next.set(Number(unitId), notes as UnitNoteDto[]);
              return next;
            });
          });
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Notizen', 'Fehler', {
            duration: 3000
          });
        }
      });
  }

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
      ).pipe(takeUntilDestroyed(this.destroyRef))
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
      .getReplayUrl(this.appService.selectedWorkspaceId, firstResponse.id).pipe(takeUntilDestroyed(this.destroyRef))
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
    this.isSearching.set(true);
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

  protected onUnitClick(unit: Unit, booklet: Booklet): void {
    const mappedResponses = unit.results.map((response: UnitResult) => ({
      ...response,
      status: response.status,
      expanded: false
    }));
    this.responses.set(Array.from(mappedResponses));
    this.selectedBooklet.set(booklet.name);

    this.responses.update(value => {
      const next = [...value];
      next.sort((a: Response, b: Response) => {
        if (a.status === 'VALUE_CHANGED' && b.status !== 'VALUE_CHANGED') {
          return -1;
        }
        if (a.status !== 'VALUE_CHANGED' && b.status === 'VALUE_CHANGED') {
          return 1;
        }
        return a.variableid.localeCompare(b.variableid);
      });
      return next;
    });

    this.logs.set(unit.logs);
    this.selectedUnit.set(unit);

    this.loadUnitTags();
    this.loadUnitNotes();
  }

  loadUnitTags(): void {
    const selectedUnitSnapshot = this.selectedUnit();

    if (selectedUnitSnapshot && selectedUnitSnapshot.id) {
      this.unitTags.set(this.unitTagsMap().get(selectedUnitSnapshot.id as number) || []);
    } else {
      this.unitTags.set([]);
    }
  }

  loadUnitNotes(): void {
    const selectedUnitSnapshot = this.selectedUnit();

    if (selectedUnitSnapshot && selectedUnitSnapshot.id) {
      const unitId = selectedUnitSnapshot.id as number;
      if (this.unitNotesMap().has(unitId)) {
        this.unitNotes.set(this.unitNotesMap().get(unitId) || []);
      } else {
        this.unitNoteService
          .getUnitNotes(this.appService.selectedWorkspaceId, unitId).pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: notes => {
              this.unitNotes.set(notes);
              this.unitNotesMap.update(value => {
                const next = new Map(value);
                next.set(unitId, notes);
                return next;
              });
            },
            error: () => {
              this.snackBar.open('Fehler beim Laden der Notizen', 'Fehler', {
                duration: 3000
              });
            }
          });
      }
    } else {
      this.unitNotes.set([]);
    }
  }

  protected hasUnitNotes(unitId: number): boolean {
    if (!unitId || !this.unitNotesMap().has(unitId)) {
      return false;
    }
    const notes = this.unitNotesMap().get(unitId) || [];
    return notes.length > 0;
  }

  protected setSelectedBooklet(booklet: Booklet) {
    this.selectedBooklet.set(booklet.name);
  }

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
    const searchInput = document.querySelector(
      '.search-input'
    ) as HTMLInputElement;
    return searchInput ? searchInput.value : '';
  }

  protected clearSearch(): void {
    const searchInput = document.querySelector(
      '.search-input'
    ) as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
      this.createTestResultsList(0, this.pageSize());
    }
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
    this.isLoading.set(true);
    this.testResultService
      .getTestResults(
        this.appService.selectedWorkspaceId,
        page,
        limit,
        searchText
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          this.isLoading.set(false);
          this.isSearching.set(false);
          const { data, total } = response;
          this.updateTable(data, total);
        },
        error: () => {
          this.isLoading.set(false);
        }
      });
  }

  private loadWorkspaceOverview(): void {
    this.isLoadingOverview.set(true);
    this.testResultService
      .getWorkspaceOverview(this.appService.selectedWorkspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          if (result) {
            this.overview.set(result);
          }
          this.isLoadingOverview.set(false);
        },
        error: () => {
          this.isLoadingOverview.set(false);
        }
      });
  }

  private loadTestResultsLogAnomalySetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.setShowTestResultsLogAnomalies(false);
      return;
    }

    this.workspaceSettingsService
      .getShowTestResultsLogAnomalies(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.setShowTestResultsLogAnomalies(enabled);
      });
  }

  private loadRegexSearchSetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.enableRegexSearch.set(false);
      return;
    }

    this.workspaceSettingsService
      .getEnableRegexSearch(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.enableRegexSearch.set(enabled);
      });
  }

  private loadCodingStatusAutoRefreshSetting(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.setAutoRefreshCodingStatus(true);
      return;
    }

    this.workspaceSettingsService
      .getAutoRefreshManualCodingJobs(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(enabled => {
        this.setAutoRefreshCodingStatus(enabled);
      });
  }

  private setAutoRefreshCodingStatus(enabled: boolean): void {
    this.autoRefreshCodingStatus.set(enabled);

    if (enabled) {
      this.loadCodingFreshnessStatus({ force: true });
      return;
    }

    this.clearCodingFreshnessStatus();
  }

  private clearCodingFreshnessStatus(): void {
    this.codingFreshnessStatusRequestGeneration += 1;
    this.codingFreshnessSummary.set(null);
    this.manualAppliedResultsOverview.set(null);
    this.manualAppliedResultsOverviewLoadFailed.set(false);
    this.isLoadingManualAppliedResultsOverview.set(false);
    this.isLoadingCodingFreshnessStatus.set(false);
    this.codingFreshnessStatusChecked.set(false);
  }

  private setShowTestResultsLogAnomalies(enabled: boolean): void {
    this.showTestResultsLogAnomalies.set(enabled);

    if (!enabled) {
      this.logAnomalySummary.set(null);
      this.logAnomalySummaryLoadFailed.set(false);
      this.isLoadingLogAnomalySummary.set(false);
      this.logAnomalySummaryRequested.set(false);
    }
  }

  private loadLogAnomalySummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.showTestResultsLogAnomalies()) {
      this.logAnomalySummary.set(null);
      this.logAnomalySummaryLoadFailed.set(false);
      this.isLoadingLogAnomalySummary.set(false);
      this.logAnomalySummaryRequested.set(false);
      return;
    }

    const getLogAnomalySummary =
      (this.testResultService as Partial<TestResultService>).getLogAnomalySummary;
    if (!getLogAnomalySummary) {
      return;
    }

    this.logAnomalySummaryRequested.set(true);
    this.isLoadingLogAnomalySummary.set(true);
    this.logAnomalySummaryLoadFailed.set(false);
    getLogAnomalySummary.call(this.testResultService, workspaceId)
      .pipe(finalize(() => {
        this.isLoadingLogAnomalySummary.set(false);
      })).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: summary => {
          this.logAnomalySummary.set(summary);
        },
        error: () => {
          this.logAnomalySummary.set(null);
          this.logAnomalySummaryLoadFailed.set(true);
        }
      });
  }

  protected loadLogAnomalySummaryOnDemand(): void {
    this.loadLogAnomalySummary();
  }

  private reloadLogAnomalySummaryIfRequested(): void {
    if (this.showTestResultsLogAnomalies() && this.logAnomalySummaryRequested()) {
      this.loadLogAnomalySummary();
    }
  }

  readonly hasLogAnomalySummary = computed<boolean>(() => !!this.logAnomalySummary());

  protected readonly logAnomalyAffectedPercent = computed<number>(() => {
    const total = Number(this.logAnomalySummary()?.totalBooklets || 0);
    if (total <= 0) {
      return 0;
    }
    return Math.round(
      (Number(this.logAnomalySummary()?.affectedBooklets || 0) / total) * 1000
    ) / 10;
  });

  protected get logAnomalyTopCodes(): Array<{ code: string; label: string; count: number }> {
    const byCode = this.logAnomalySummary()?.byCode || {};
    return Object.entries(byCode)
      .map(([code, count]) => ({
        code,
        label: this.getLogAnomalyCodeLabel(code),
        count: Number(count) || 0
      }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 6);
  }

  getLogAnomalyCodeLabel(code: string): string {
    const labels: Record<string, string> = {
      controller_error: 'Controller-Fehler',
      missing_termination: 'Kein Abschluss',
      connection_lost: 'Verbindung verloren',
      timestamp_zero: 'Timestamp 0',
      player_stuck_loading: 'Player hängt',
      repeated_start: 'Mehrfach gestartet',
      long_loading: 'Lange Ladezeit',
      timer_left_on_exit: 'Restzeit am Ende',
      timer_never_finished: 'Timer nicht beendet',
      focus_lost_long: 'Langer Fokusverlust',
      unit_progress_incomplete: 'Units fehlen',
      progress_incomplete: 'Progress unvollständig',
      debug_command: 'Debug-Befehl',
      session_span_long: 'Lange Zeitspanne',
      orphan_logs: 'Logs ohne Start'
    };
    return labels[code] || code;
  }

  showLogAnomaliesInTable(): void {
    this.quickSearchTableFilters.set({ logAnomalies: 'any' });
    this.forceShowLogAnomalyTableColumn.set(this.showTestResultsLogAnomalies());
    this.isTableView.set(true);
    this.isLoading.set(false);
    this.isUploadingResults.set(false);
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

    getLogAnomalyDetails.call(this.testResultService, workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
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
  ): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.clearCodingFreshnessStatus();
      return;
    }

    if (this.isLoadingCodingFreshnessStatus() && !options.force) {
      return;
    }

    if (options.force) {
      this.testPersonCodingService.invalidateCodingStatusCache(workspaceId);
    }

    const getCodingFreshness =
      (this.statisticsService as Partial<CodingStatisticsService>).getCodingFreshness;
    const codingFreshness$ = getCodingFreshness ?
      getCodingFreshness.call(this.statisticsService, workspaceId)
        .pipe(catchError(() => of(null))) :
      of(null);

    const requestGeneration =
      this.codingFreshnessStatusRequestGeneration + 1;
    this.codingFreshnessStatusRequestGeneration = requestGeneration;
    this.codingFreshnessStatusChecked.set(true);
    this.isLoadingCodingFreshnessStatus.set(true);
    this.isLoadingManualAppliedResultsOverview.set(true);
    this.manualAppliedResultsOverviewLoadFailed.set(false);

    forkJoin([
      codingFreshness$,
      this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
        .pipe(catchError(() => of(null)))
    ])
      .pipe(finalize(() => {
        if (this.codingFreshnessStatusRequestGeneration === requestGeneration) {
          this.isLoadingCodingFreshnessStatus.set(false);
          this.isLoadingManualAppliedResultsOverview.set(false);
        }
      })).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ([summary, overview]) => {
          if (this.codingFreshnessStatusRequestGeneration !== requestGeneration) {
            return;
          }

          this.codingFreshnessSummary.set(summary);
          this.manualAppliedResultsOverview.set(overview);
          this.manualAppliedResultsOverviewLoadFailed.set(overview === null);
        }
      });
  }

  private refreshCodingFreshnessStatusAfterChange(): void {
    if (this.autoRefreshCodingStatus()) {
      this.loadCodingFreshnessStatus({ force: true });
      return;
    }

    this.clearCodingFreshnessStatus();
  }

  private async fetchCodingFreshnessSummary(
    workspaceId: number
  ): Promise<CodingFreshnessSummaryDto | null> {
    const getCodingFreshness =
      (this.statisticsService as Partial<CodingStatisticsService>).getCodingFreshness;
    if (!getCodingFreshness) {
      return null;
    }

    try {
      return await firstValueFrom(
        getCodingFreshness.call(this.statisticsService, workspaceId)
      );
    } catch {
      return null;
    }
  }

  private async fetchManualAppliedResultsOverview(
    workspaceId: number
  ): Promise<{ overview: AppliedResultsOverview | null; loadFailed: boolean }> {
    try {
      const overview = await firstValueFrom(
        this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
      );
      return {
        overview,
        loadFailed: overview === null
      };
    } catch {
      return {
        overview: null,
        loadFailed: true
      };
    }
  }

  readonly overviewResponseStatusTotal = computed<number>(() => Object.values(this.overview()?.responseStatusCounts || {})
    .reduce((sum, count) => sum + (Number(count) || 0), 0));

  protected get overviewStatusCounts(): Array<{ status: string; count: number; percent: number }> {
    const map = (this.overview()?.responseStatusCounts || {}) as Record<
      string,
      number
    >;
    const total = this.overviewResponseStatusTotal();
    return Object.entries(map)
      .map(([status, count]) => {
        const normalizedCount = Number(count) || 0;
        return {
          status,
          count: normalizedCount,
          percent: this.getPercent(normalizedCount, total)
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  private readonly allCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => (this.codingFreshnessSummary()?.items || [])
    .filter(isCodingFreshnessOpenWarning)
    .sort((a, b) => a.version.localeCompare(b.version) || a.state.localeCompare(b.state)));

  readonly codingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => this.allCodingFreshnessWarnings()
    .filter(item => !(item.version === 'v3' && (
      this.isSecondAutocodingManualStatusPending() ||
        this.isSecondAutocodingWaitingForManualCoding()
    ))));

  readonly hasCodingFreshnessWarning = computed<boolean>(() => this.codingFreshnessWarnings().length > 0 ||
      this.shouldShowSecondAutocodingWaitingState());

  readonly codingFreshnessDisplayWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => {
    if (this.codingFreshnessWarnings().length > 0) {
      return this.codingFreshnessWarnings();
    }

    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.secondAutocodingFreshnessWarnings();
    }

    return [];
  });

  readonly autoCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getCodingFreshnessAutoCodingWarnings(this.codingFreshnessWarnings()));

  readonly manualCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getCodingFreshnessManualReviewWarnings(this.codingFreshnessWarnings()));

  readonly hasOnlyManualCodingFreshnessWarnings = computed<boolean>(() => hasOnlyManualCodingFreshnessWarnings(this.codingFreshnessWarnings()));

  readonly codingFreshnessAffectedUnitVersions = computed<number>(() => getCodingFreshnessAffectedTaskResultCount(this.codingFreshnessWarnings()));

  readonly codingFreshnessAffectedResponses = computed<number>(() => getCodingFreshnessAffectedResponseCount(this.codingFreshnessWarnings()));

  get codingFreshnessSummaryText(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.getSecondAutocodingWaitingSummaryText();
    }

    return getCodingFreshnessSummaryText(this.codingFreshnessWarnings());
  }

  protected get codingFreshnessExplanationText(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.help,
        { taskResultHelp: CODING_FRESHNESS_TASK_RESULT_HELP }
      );
    }

    const guidanceText = getCodingFreshnessManualReviewGuidanceText(
      this.codingFreshnessWarnings()
    );
    if (guidanceText) {
      return `${guidanceText} ${CODING_FRESHNESS_TASK_RESULT_HELP}`;
    }

    return CODING_FRESHNESS_TASK_RESULT_HELP;
  }

  get codingFreshnessBannerTitle(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.translateService.instant(SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.title);
    }

    return getCodingFreshnessAttentionTitle(this.codingFreshnessWarnings());
  }

  readonly codingFreshnessActionLabel = computed<string>(() => {
    if (this.shouldShowSecondAutocodingWaitingState() || this.hasOnlyManualCodingFreshnessWarnings()) {
      return 'Manuelle Kodierung öffnen';
    }

    return this.autoCodingFreshnessWarnings().length > 0 ?
      'Auto-Coding öffnen' :
      'Kodierung öffnen';
  });

  protected readonly codingFreshnessActionIcon = computed<string>(() => ((this.shouldShowSecondAutocodingWaitingState() || this.hasOnlyManualCodingFreshnessWarnings()) ?
    'keyboard' :
    'rule'));

  getCodingFreshnessVersionLabel(version: CodingFreshnessVersion): string {
    return getCodingFreshnessVersionLabel(version);
  }

  getCodingFreshnessStateLabel(state: CodingFreshnessState): string {
    return getCodingFreshnessStateLabel(state);
  }

  getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
    if (item.version === 'v3' && this.isSecondAutocodingWaitingForManualCoding()) {
      return this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.chip,
        {
          version: getCodingFreshnessVersionLabel(item.version),
          count: formatCodingFreshnessTaskResultCount(item.unitCount)
        }
      );
    }

    return getCodingFreshnessChipLabel(item);
  }

  private readonly secondAutocodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getSecondAutocodingFreshnessWarnings(this.allCodingFreshnessWarnings()));

  private readonly isSecondAutocodingWaitingForManualCoding = computed<boolean>(() => isSecondAutocodingWaitingForManualCoding(
    this.allCodingFreshnessWarnings(),
    this.manualAppliedResultsOverview(),
    this.manualAppliedResultsOverviewLoadFailed()
  ));

  private readonly isSecondAutocodingManualStatusPending = computed<boolean>(() => this.secondAutocodingFreshnessWarnings().length > 0 &&
      this.isLoadingManualAppliedResultsOverview() &&
      !this.manualAppliedResultsOverviewLoadFailed());

  private readonly shouldShowSecondAutocodingWaitingState = computed<boolean>(() => {
    if (this.isSecondAutocodingManualStatusPending()) {
      return false;
    }

    return this.isSecondAutocodingWaitingForManualCoding() &&
      this.codingFreshnessWarnings().length === 0;
  });

  private getSecondAutocodingWaitingSummaryText(): string {
    if (this.manualAppliedResultsOverviewLoadFailed()) {
      return this.translateService.instant(SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.loadFailed);
    }

    const remaining = this.manualAppliedResultsOverview()?.remainingResponses || 0;
    const remainingText = remaining > 0 ?
      this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.remaining,
        { count: remaining }
      ) :
      '';

    return this.translateService.instant(
      SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.summary,
      { remaining: remainingText }
    );
  }

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

  private toSortedCountList(
    map?: Record<string, number>
  ): Array<{ key: string; count: number }> {
    const m = (map || {}) as Record<string, number>;
    return Object.entries(m)
      .map(([key, count]) => ({ key, count: Number(count) }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  private totalCount(list: Array<{ count: number }>): number {
    return list.reduce((sum, x) => sum + (Number(x.count) || 0), 0);
  }

  get overviewBrowserCounts(): Array<{ key: string; count: number }> {
    return this.toSortedCountList(this.overview()?.sessionBrowserCounts);
  }

  get overviewOsCounts(): Array<{ key: string; count: number }> {
    return this.toSortedCountList(this.overview()?.sessionOsCounts);
  }

  get overviewScreenCounts(): Array<{ key: string; count: number }> {
    return this.toSortedCountList(this.overview()?.sessionScreenCounts);
  }

  getBrowserTotal(): number {
    return this.totalCount(this.overviewBrowserCounts);
  }

  getOsTotal(): number {
    return this.totalCount(this.overviewOsCounts);
  }

  getScreenTotal(): number {
    return this.totalCount(this.overviewScreenCounts);
  }

  getPercent(count: number, total: number): number {
    const t = Number(total) || 0;
    if (t <= 0) {
      return 0;
    }
    return Math.round((Number(count) / t) * 1000) / 10;
  }

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
    this.isUploadingResults.set(false);
  }

  getResponseStatusTooltip(status: string): string {
    const sharedTooltipKey = getResponseStatusTooltipKey(status);
    if (sharedTooltipKey) {
      return this.translateService.instant(sharedTooltipKey);
    }

    const info = RESPONSE_STATUS_INFO[status];
    if (!info) {
      return status;
    }

    const descriptionPart = info.description ? `: ${info.description}` : '';
    return `${status}${descriptionPart}`;
  }

  protected isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource?.data.length ?? 0;
    return numSelected === numRows;
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

  async testCenterImport(): Promise<void> {
    if (this.destroyRef.destroyed) return;
    this.cancelTestCenterImport?.();
    const workspaceId = this.appService.selectedWorkspaceId;
    const cancellation = new ReplaySubject<void>(1);
    const ownedDialogs = new Set<MatDialogRef<unknown>>();
    let cancelled = false;
    let workspaceChanges: Subscription | undefined;
    let unregisterDestroy = () => {};
    const cancel = (): void => {
      if (cancelled) return;
      cancelled = true;
      cancellation.next();
      cancellation.complete();
      workspaceChanges?.unsubscribe();
      unregisterDestroy();
      ownedDialogs.forEach(ref => ref.close());
      ownedDialogs.clear();
      if (this.cancelTestCenterImport === cancel) this.cancelTestCenterImport = null;
    };
    this.cancelTestCenterImport = cancel;
    unregisterDestroy = this.destroyRef.onDestroy(cancel);
    workspaceChanges = this.appService.selectedWorkspaceId$.subscribe(id => {
      if (id !== workspaceId) cancel();
    });
    const fallbackOverview: TestResultsOverviewResponse = {
      testPersons: 0,
      testGroups: 0,
      uniqueBooklets: 0,
      uniqueUnits: 0,
      uniqueResponses: 0,
      responseStatusCounts: {},
      sessionBrowserCounts: {},
      sessionOsCounts: {},
      sessionScreenCounts: {}
    };

    let loadedBeforeOverview: TestResultsOverviewResponse | null = null;
    if (workspaceId) {
      try {
        loadedBeforeOverview = await firstValueFrom(
          this.testResultService.getWorkspaceOverview(workspaceId).pipe(takeUntil(cancellation)),
          { defaultValue: null }
        );
      } catch {
        loadedBeforeOverview = null;
      }
    }
    if (cancelled) return;
    const beforeOverview =
      loadedBeforeOverview || this.overview() || fallbackOverview;

    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '1200px',
      maxWidth: '95vw',
      minHeight: '800px',
      disableClose: true,
      data: {
        importType: 'testResults'
      }
    });
    ownedDialogs.add(dialogRef);

    const sleep = (ms: number) => firstValueFrom(rxjsTimer(ms).pipe(takeUntil(cancellation)), { defaultValue: null });

    const hasOverviewChanged = (current: TestResultsOverviewResponse) => (
      current.testPersons !== beforeOverview.testPersons ||
      current.testGroups !== beforeOverview.testGroups ||
      current.uniqueBooklets !== beforeOverview.uniqueBooklets ||
      current.uniqueUnits !== beforeOverview.uniqueUnits ||
      current.uniqueResponses !== beforeOverview.uniqueResponses
    );

    const pollOverviewAfterImport =
      async (progressState$?: BehaviorSubject<TestResultsImportProgressState>): Promise<{
        overview: TestResultsOverviewResponse;
        loaded: boolean;
        changed: boolean;
      }> => {
        if (!workspaceId) {
          return {
            overview: this.overview() || fallbackOverview,
            loaded: false,
            changed: false
          };
        }

        // A loaded overview is the reliable result. It may legitimately be unchanged
        // when an import only confirms already existing data.
        for (let i = 0; i < 12; i += 1) {
          if (cancelled) return { overview: beforeOverview, loaded: false, changed: false };
          progressState$?.next({
            title: 'Testcenter-Import',
            icon: 'upload_file',
            phase: 'refreshingOverview',
            phaseLabel: 'Übersicht wird aktualisiert',
            message: 'Der Import ist abgeschlossen. Lade die aktualisierten Ergebniszahlen.',
            percent: Math.min(95, Math.round(((i + 1) / 12) * 100)),
            mode: 'determinate'
          });

          let current: TestResultsOverviewResponse | null = null;
          try {
            current = await firstValueFrom(
              this.testResultService.getWorkspaceOverview(workspaceId).pipe(takeUntil(cancellation)),
              { defaultValue: null }
            );
          } catch {
            current = null;
          }
          if (!current) {
            await sleep(1000);
            continue;
          }
          return { overview: current, loaded: true, changed: hasOverviewChanged(current) };
        }
        let finalOverview: TestResultsOverviewResponse | null = null;
        try {
          finalOverview = await firstValueFrom(
            this.testResultService.getWorkspaceOverview(workspaceId).pipe(takeUntil(cancellation)),
            { defaultValue: null }
          );
        } catch {
          finalOverview = null;
        }
        return {
          overview: finalOverview || this.overview() || beforeOverview,
          loaded: !!finalOverview,
          changed: !!finalOverview && hasOverviewChanged(finalOverview)
        };
      };

    dialogRef.afterClosed().pipe(takeUntil(cancellation), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      ownedDialogs.delete(dialogRef);
      let awaitingOverview = false;
      const maybePayload = result as
        | {
          didImport?: boolean;
          resultType?: 'logs' | 'responses';
        }
        | boolean
        | undefined;

      if (
        maybePayload &&
        typeof maybePayload === 'object' &&
        'didImport' in maybePayload &&
        (maybePayload as { didImport?: boolean }).didImport
      ) {
        awaitingOverview = true;
        (async () => {
          const progressState$ = new BehaviorSubject<TestResultsImportProgressState>({
            title: 'Testcenter-Import',
            icon: 'upload_file',
            phase: 'refreshingOverview',
            phaseLabel: 'Übersicht wird aktualisiert',
            message: 'Der Import ist abgeschlossen. Lade die aktualisierten Ergebniszahlen.',
            mode: 'indeterminate'
          });
          const progressDialogRef = this.dialog.open(
            TestResultsImportProgressDialogComponent,
            {
              width: '560px',
              maxWidth: '95vw',
              disableClose: true,
              data: { state$: progressState$ }
            }
          );
          ownedDialogs.add(progressDialogRef);

          let overviewResult: {
            overview: TestResultsOverviewResponse;
            loaded: boolean;
            changed: boolean;
          } = {
            overview: this.overview() || beforeOverview,
            loaded: false,
            changed: false
          };

          try {
            if (workspaceId) {
              this.testResultService.invalidateCache(workspaceId);
            }

            overviewResult = await pollOverviewAfterImport(progressState$);
            if (cancelled) return;

            progressState$.next({
              title: 'Testcenter-Import',
              icon: 'upload_file',
              phase: 'completed',
              phaseLabel: 'Ergebnis bereit',
              message: 'Die Ergebnisübersicht wurde geladen.',
              percent: 100,
              mode: 'determinate'
            });
          } finally {
            if (ownedDialogs.delete(progressDialogRef)) progressDialogRef.close();
            progressState$.complete();
          }

          const afterOverview = overviewResult.overview;

          const delta = {
            testPersons: afterOverview.testPersons - beforeOverview.testPersons,
            testGroups: afterOverview.testGroups - beforeOverview.testGroups,
            uniqueBooklets:
              afterOverview.uniqueBooklets - beforeOverview.uniqueBooklets,
            uniqueUnits: afterOverview.uniqueUnits - beforeOverview.uniqueUnits,
            uniqueResponses:
              afterOverview.uniqueResponses - beforeOverview.uniqueResponses
          };

          const payload = maybePayload as {
            resultType?: 'logs' | 'responses';
            importedLogs?: boolean;
            importedResponses?: boolean;
            uploadResult?: ImportResultDto;
            // Legacy/Fallback properties
            issues?: TestResultsUploadIssueDto[];
            logMetrics?: {
              bookletsWithLogs: number;
              totalBooklets: number;
              unitsWithLogs: number;
              totalUnits: number;
              bookletDetails?: { name: string; hasLog: boolean }[];
              unitDetails?: {
                bookletName: string;
                unitKey: string;
                hasLog: boolean;
              }[];
            };
          };

          const logMetrics = payload.uploadResult ?
            {
              bookletsWithLogs: payload.uploadResult.bookletsWithLogs ?? 0,
              totalBooklets: payload.uploadResult.totalBooklets ?? 0,
              unitsWithLogs: payload.uploadResult.unitsWithLogs ?? 0,
              totalUnits: payload.uploadResult.totalUnits ?? 0,
              bookletDetails: payload.uploadResult.bookletDetails || [],
              unitDetails: payload.uploadResult.unitDetails || []
            } :
            payload.logMetrics;

          const overviewPending = !overviewResult.loaded;
          let codingFreshness = payload.uploadResult?.codingFreshness || null;
          if (!codingFreshness && workspaceId) {
            codingFreshness = await this.fetchCodingFreshnessSummary(workspaceId);
          }
          if (cancelled) return;
          if (codingFreshness) {
            this.codingFreshnessSummary.set(codingFreshness);
          }
          const manualOverviewResult = workspaceId ?
            await this.fetchManualAppliedResultsOverview(workspaceId) :
            {
              overview: this.manualAppliedResultsOverview(),
              loadFailed: this.manualAppliedResultsOverviewLoadFailed()
            };
          if (cancelled) return;
          this.manualAppliedResultsOverview.set(manualOverviewResult.overview);
          this.manualAppliedResultsOverviewLoadFailed.set(manualOverviewResult.loadFailed);

          const dialogResult: TestResultsUploadResultDto = {
            expected: { ...delta },
            before: {
              testPersons: beforeOverview.testPersons,
              testGroups: beforeOverview.testGroups,
              uniqueBooklets: beforeOverview.uniqueBooklets,
              uniqueUnits: beforeOverview.uniqueUnits,
              uniqueResponses: beforeOverview.uniqueResponses
            },
            after: {
              testPersons: afterOverview.testPersons,
              testGroups: afterOverview.testGroups,
              uniqueBooklets: afterOverview.uniqueBooklets,
              uniqueUnits: afterOverview.uniqueUnits,
              uniqueResponses: afterOverview.uniqueResponses
            },
            delta,
            responseStatusCounts: afterOverview.responseStatusCounts,
            issues: payload.uploadResult?.issues || payload.issues || [],
            logMetrics: logMetrics,
            importedLogs: payload.importedLogs,
            importedResponses: payload.importedResponses,
            overviewPending,
            overviewMessage: overviewPending ?
              'Der Import wurde vom Server angenommen, aber die aktualisierte Übersicht konnte noch nicht zuverlässig gelesen werden. Bitte diese Ansicht in Kürze aktualisieren.' :
              undefined,
            codingFreshness: codingFreshness || undefined
          };

          this.dialog.open(TestResultsUploadResultDialogComponent, {
            width: '1040px',
            maxWidth: '95vw',
            data: {
              resultType: payload.resultType || 'responses',
              result: dialogResult,
              manualAppliedResultsOverview: manualOverviewResult.overview,
              manualAppliedResultsOverviewLoadFailed: manualOverviewResult.loadFailed
            }
          });
        })().finally(cancel);
      }

      if (result) {
        if (workspaceId) {
          this.testResultService.invalidateCache(workspaceId);
        }
        this.loadWorkspaceOverview();
        this.refreshCodingFreshnessStatusAfterChange();
        this.createTestResultsList(
          this.pageIndex(),
          this.pageSize(),
          this.getCurrentSearchText()
        );
      }
      if (!awaitingOverview) cancel();
    });
  }

  onFileSelected(
    targetElement: EventTarget | null,
    resultType: 'logs' | 'responses'
  ) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        const optionsRef = this.dialog.open<
          TestResultsUploadOptionsDialogComponent,
          TestResultsUploadOptionsDialogData,
        TestResultsUploadOptionsDialogResult | undefined
        >(TestResultsUploadOptionsDialogComponent, {
          width: '600px',
          data: {
            resultType,
            defaultOverwriteMode: 'skip',
            defaultScope: 'person'
          }
        });

        optionsRef
          .afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
          .subscribe(
            (options: TestResultsUploadOptionsDialogResult | undefined) => {
              if (!options) {
                return;
              }

              const overwriteMode: OverwriteMode = options.overwriteMode;
              const scope = options.scope;
              const filters = {
                groupName: options.groupName,
                bookletName: options.bookletName,
                unitNameOrAlias: options.unitNameOrAlias,
                variableId: options.variableId,
                subform: options.subform
              };

              const overwriteExisting = overwriteMode !== 'skip';
              const workspaceId = this.appService.selectedWorkspaceId;
              const beforeOverview = this.overview() || {
                testPersons: 0,
                testGroups: 0,
                uniqueBooklets: 0,
                uniqueUnits: 0,
                uniqueResponses: 0,
                responseStatusCounts: {},
                sessionBrowserCounts: {},
                sessionOsCounts: {},
                sessionScreenCounts: {}
              };
              this.isLoading.set(true);
              this.isUploadingResults.set(true);
              this.uploadingMessage.set(resultType === 'responses' ?
                'Importiere Antworten... (0%)' : 'Importiere Logs... (0%)');
              this.uploadStateService.startChunkedUpload(
                workspaceId,
                inputElement.files![0],
                resultType,
                {
                  overwriteExisting, overwriteMode, scope, filters
                },
                beforeOverview
              ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
                error: () => {
                  this.isLoading.set(false);
                  this.isUploadingResults.set(false);
                }
              });
            }
          );
      }
    }
  }

  protected deleteSelectedPersons(): void {
    const selectedTestPersons = this.selection.selected;
    if (selectedTestPersons.length === 0) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'persons',
      personIds: selectedTestPersons.map(person => person.id)
    });
  }

  protected deleteFilteredPersons(): void {
    this.confirmAndStartDelete({
      scope: 'filteredPersons',
      searchText: this.getCurrentSearchText()
    });
  }

  protected deleteSelectedGroups(): void {
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

  protected openResponseCleanupDialog(): void {
    if (this.isDeleteJobRunning()) {
      return;
    }

    const dialogRef = this.dialog.open(TestResultsResponseCleanupDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(
      (request: TestResultsResponseCleanupRequestDto | false | undefined) => {
        if (request) {
          this.confirmAndStartResponseCleanup(request);
        }
      }
    );
  }

  protected isDeleteJobRunning(): boolean {
    return this.activeDeleteTask()?.status === 'pending' ||
      this.activeDeleteTask()?.status === 'processing' ||
      this.isDeletingTestPersons();
  }

  private confirmAndStartDelete(request: TestResultsDeleteRequestDto): void {
    if (this.isDeleteJobRunning()) {
      return;
    }

    this.isDeletingTestPersons.set(true);

    this.testResultService
      .previewDeleteTestResults(this.appService.selectedWorkspaceId, request).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          this.isDeletingTestPersons.set(false);
          if (!preview) {
            this.snackBar.open(
              'Die Löschvorschau konnte nicht berechnet werden.',
              'Fehler',
              { duration: 4000 }
            );
            return;
          }

          this.openDeletePreviewDialog(request, preview);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.snackBar.open(
            'Die Löschvorschau konnte nicht berechnet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  private confirmAndStartResponseCleanup(
    request: TestResultsResponseCleanupRequestDto
  ): void {
    if (this.isDeleteJobRunning()) {
      return;
    }

    this.isDeletingTestPersons.set(true);

    this.testResultService
      .previewDeleteTestResultResponses(
        this.appService.selectedWorkspaceId,
        request
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: preview => {
          this.isDeletingTestPersons.set(false);
          if (!preview) {
            this.snackBar.open(
              'Die Löschvorschau konnte nicht berechnet werden.',
              'Fehler',
              { duration: 4000 }
            );
            return;
          }

          this.openResponseCleanupPreviewDialog(request, preview);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.snackBar.open(
            'Die Löschvorschau konnte nicht berechnet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  private openDeletePreviewDialog(
    request: TestResultsDeleteRequestDto,
    preview: TestResultsDeletePreviewDto
  ): void {
    const dialogRef = this.dialog.open(TestResultsDeletePreviewDialogComponent, {
      width: '680px',
      maxWidth: '95vw',
      data: {
        preview
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed) {
        this.startDeleteJob(request);
      }
    });
  }

  private openResponseCleanupPreviewDialog(
    request: TestResultsResponseCleanupRequestDto,
    preview: TestResultsDeletePreviewDto
  ): void {
    const dialogRef = this.dialog.open(TestResultsDeletePreviewDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
      data: {
        preview
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed) {
        this.startResponseCleanupJob(request);
      }
    });
  }

  private startDeleteJob(request: TestResultsDeleteRequestDto): void {
    this.resetSelectedResultDetails();
    this.isDeletingTestPersons.set(true);
    this.deleteProgress.set(0);
    this.deleteProgressMessage.set('Löschung wird gestartet...');

    this.testResultService
      .createDeleteTestResultsJob(this.appService.selectedWorkspaceId, request).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: task => {
          this.activeDeleteTask.set(task);
          this.pollDeleteTask(task.id);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Die Löschung konnte nicht gestartet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  private startResponseCleanupJob(
    request: TestResultsResponseCleanupRequestDto
  ): void {
    this.resetSelectedResultDetails();
    this.isDeletingTestPersons.set(true);
    this.deleteProgress.set(0);
    this.deleteProgressMessage.set('Antwort-Löschung wird gestartet...');

    this.testResultService
      .createDeleteTestResultResponsesJob(
        this.appService.selectedWorkspaceId,
        request
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: task => {
          this.activeDeleteTask.set(task);
          this.pollDeleteTask(task.id);
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Die Löschung konnte nicht gestartet werden.',
            'Fehler',
            { duration: 4000 }
          );
        }
      });
  }

  private pollDeleteTask(taskId: number): void {
    if (this.deleteTaskSubscription) {
      this.deleteTaskSubscription.unsubscribe();
    }

    this.deleteTaskSubscription = rxjsTimer(0, 1000)
      .pipe(
        switchMap(() => this.validationService.getValidationTask(
          this.appService.selectedWorkspaceId,
          taskId
        )),
        takeWhile(
          task => task.status === 'pending' || task.status === 'processing',
          true
        )
      )
      .subscribe({
        next: task => {
          this.activeDeleteTask.set(task);
          this.deleteProgress.set(task.progress || 0);
          this.deleteProgressMessage.set(task.progress_message || 'Löschung läuft...');

          if (task.status === 'completed') {
            this.finishDeleteTask(task.id);
          } else if (task.status === 'failed') {
            this.isDeletingTestPersons.set(false);
            this.activeDeleteTask.set(null);
            this.snackBar.open(
              task.error || 'Die Löschung ist fehlgeschlagen.',
              'Fehler',
              { duration: 5000 }
            );
          }
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Der Fortschritt der Löschung konnte nicht gelesen werden.',
            'Fehler',
            { duration: 5000 }
          );
        }
      });
  }

  private finishDeleteTask(taskId: number): void {
    this.validationService
      .getValidationResults(this.appService.selectedWorkspaceId, taskId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          const deleteResult = result as TestResultsDeleteResultDto;
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.deleteProgress.set(100);
          this.selection.clear();
          this.testResultService.invalidateCache(
            this.appService.selectedWorkspaceId
          );
          this.validationTaskStateService.invalidateWorkspace(
            this.appService.selectedWorkspaceId
          );
          this.loadWorkspaceOverview();
          this.refreshCodingFreshnessStatusAfterChange();
          this.testPersonCodingService.notifyTestResultsChanged();
          this.createTestResultsList(
            this.pageIndex(),
            this.pageSize(),
            this.getCurrentSearchText()
          );
          this.snackBar.open(
            `Löschung abgeschlossen: ${deleteResult.deletedTargetCount} Datensätze verarbeitet. Betroffene Kodierungen wurden mit entfernt.`,
            'OK',
            { duration: 4000 }
          );
        },
        error: () => {
          this.isDeletingTestPersons.set(false);
          this.activeDeleteTask.set(null);
          this.snackBar.open(
            'Die Löschung wurde abgeschlossen, das Ergebnis konnte aber nicht geladen werden.',
            'Info',
            { duration: 5000 }
          );
          this.loadWorkspaceOverview();
          this.refreshCodingFreshnessStatusAfterChange();
          this.testPersonCodingService.notifyTestResultsChanged();
          this.createTestResultsList(
            this.pageIndex(),
            this.pageSize(),
            this.getCurrentSearchText()
          );
        }
      });
  }

  private resetSelectedResultDetails(): void {
    this.selectedResultRequestsCancelled.next();
    this.isLoadingBooklets.set(false);
    this.booklets.set([]);
    this.responses.set([]);
    this.logs.set([]);
    this.bookletLogs.set([]);
    this.selectedUnit.set(undefined);
    this.selectedBooklet.set('');
    this.unitTagsMap.set(new Map());
    this.unitNotesMap.set(new Map());
  }

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
    if (!item.personId || !this.appService.selectedWorkspaceId) {
      this.snackBar.open(
        'Dieser Treffer kann nicht im Ergebnisbrowser geöffnet werden.',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    this.isTableView.set(false);
    this.testPerson.set({
      id: item.personId,
      code: item.personCode || '',
      group: item.personGroup || '',
      login: item.personLogin || '',
      uploaded_at: new Date()
    });
    this.resetSelectedResultDetails();
    this.isLoadingBooklets.set(true);

    this.testResultService
      .getPersonTestResults(this.appService.selectedWorkspaceId, item.personId).pipe(
        takeUntil(this.selectedResultRequestsCancelled), takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef), finalize(() => { if (!this.destroyRef.destroyed) this.isLoadingBooklets.set(false); })
      )
      .subscribe({
        next: (booklets: PersonTestResult[]) => {
          this.booklets.set(booklets as unknown as Booklet[]);
          this.sortBooklets();
          this.sortBookletUnits();
          this.loadAllUnitTags();
          this.loadAllUnitNotes();
          this.isLoadingBooklets.set(false);

          const targetBooklet = this.findQuickSearchBooklet(item);
          if (!targetBooklet) {
            return;
          }
          this.setSelectedBooklet(targetBooklet);

          const targetUnit = this.findQuickSearchUnit(targetBooklet, item);
          if (!targetUnit) {
            return;
          }
          this.onUnitClick(targetUnit, targetBooklet);

          if (item.kind === 'response' && item.variableId) {
            this.responses.set(this.responses().map(response => ({
              ...response,
              expanded: response.variableid === item.variableId
            })));
          }
        },
        error: () => {
          this.isLoadingBooklets.set(false);
          this.snackBar.open(
            'Fehler beim Öffnen des Treffers im Ergebnisbrowser',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  private findQuickSearchBooklet(
    item: QuickSearchResultItem
  ): Booklet | undefined {
    if (!this.booklets() || (!item.bookletId && !item.bookletName)) {
      return undefined;
    }

    return this.booklets().find(booklet => {
      if (item.bookletId && booklet.id === item.bookletId) {
        return true;
      }
      return item.bookletName ? booklet.name === item.bookletName : false;
    });
  }

  private findQuickSearchUnit(
    booklet: Booklet,
    item: QuickSearchResultItem
  ): Unit | undefined {
    if (!booklet.units || (!item.unitId && !item.unitName && !item.unitAlias)) {
      return undefined;
    }

    return booklet.units.find(unit => {
      if (item.unitId && unit.id === item.unitId) {
        return true;
      }
      return (
        (!!item.unitName && unit.name === item.unitName) ||
        (!!item.unitAlias && unit.alias === item.unitAlias)
      );
    });
  }

  deleteUnit(unit: Unit, booklet: Booklet): void {
    if (!unit.id) {
      this.snackBar.open(
        'Diese Unit kann nicht gelöscht werden, da sie keine ID hat.',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: 'Unit löschen',
        content: `Möchten Sie die Unit "${
          unit.alias || 'Unbenannte Einheit'
        }" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed) {
        this.unitService
          .deleteUnit(this.appService.selectedWorkspaceId, unit.id as number).pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: result => {
              if (result.success) {
                this.booklets.update(booklets => booklets.map(current => (
                  current.id === booklet.id ? {
                    ...current, units: current.units.filter(candidate => candidate.id !== unit.id)
                  } : current
                )));

                if (this.selectedUnit()?.id === unit.id) {
                  this.selectedUnit.set(undefined);
                  this.responses.set([]);
                  this.logs.set([]);
                }

                this.snackBar.open(
                  `Unit "${
                    unit.alias || 'Unbenannte Einheit'
                  }" wurde erfolgreich gelöscht. Betroffene Kodierungen wurden mit entfernt.`,
                  'Erfolg',
                  { duration: 3000 }
                );
                this.loadWorkspaceOverview();
                this.refreshCodingFreshnessStatusAfterChange();
                this.testPersonCodingService.notifyTestResultsChanged();
              } else {
                this.snackBar.open(
                  `Fehler beim Löschen der Unit: ${result.report.warnings.join(
                    ', '
                  )}`,
                  'Fehler',
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                'Fehler beim Löschen der Unit. Bitte versuchen Sie es später erneut.',
                'Fehler',
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

  deleteResponse(response: Response): void {
    if (!response.id) {
      this.snackBar.open(
        'Diese Antwort kann nicht gelöscht werden, da sie keine ID hat.',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: 'Antwort löschen',
        content: `Möchten Sie die Antwort für Variable "${response.variableid}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(confirmed => {
      if (confirmed) {
        this.responseService
          .deleteResponse(
            this.appService.selectedWorkspaceId,
            response.id as number
          ).pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: result => {
              if (result.success) {
                const responseIndex = this.responses().findIndex(
                  r => r.id === response.id
                );
                if (responseIndex !== -1) {
                  this.responses.update(value => {
                    const next = [...value];
                    next.splice(responseIndex, 1);
                    return next;
                  });
                }

                this.snackBar.open(
                  `Antwort für Variable "${response.variableid}" wurde gelöscht. Kodierstatus wurde aktualisiert.`,
                  'Erfolg',
                  { duration: 3000 }
                );
                this.loadWorkspaceOverview();
                this.refreshCodingFreshnessStatusAfterChange();
                this.testPersonCodingService.notifyTestResultsChanged();
              } else {
                this.snackBar.open(
                  `Fehler beim Löschen der Antwort: ${result.report.warnings.join(
                    ', '
                  )}`,
                  'Fehler',
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                'Fehler beim Löschen der Antwort. Bitte versuchen Sie es später erneut.',
                'Fehler',
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

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
      .getAllJobs(this.appService.selectedWorkspaceId).pipe(takeUntilDestroyed(this.destroyRef))
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

  protected openExportDialog(): void {
    const dialogRef = this.dialog.open(TestResultsExportDialogComponent, {
      width: '500px',
      data: {
        isExporting: this.isExporting(),
        exportTypeInProgress: this.exportTypeInProgress(),
        exportJobStatus: this.exportJobStatus(),
        exportJobProgress: this.exportJobProgress(),
        exportJobId: this.exportJobId()
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        if (result.type === 'download' && result.jobId) {
          this.downloadExportResult(result.jobId);
        } else if (result.type === 'cancel') {
          this.cancelExportJob(result.jobId);
        } else if (result.type === 'results' || result.type === 'logs') {
          this.startExportJob(result.type);
        }
      }
    });
  }

  private startExportJob(exportType: 'results' | 'logs'): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const dialogRef = this.dialog.open(ExportOptionsDialogComponent, {
      width: '800px',
      data: {
        workspaceId: this.appService.selectedWorkspaceId,
        exportType
      }
    });

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe((result: ExportOptions | undefined) => {
      if (result) {
        const filters = {
          groupNames:
            result.groupNames && result.groupNames.length > 0 ?
              result.groupNames :
              undefined,
          bookletNames:
            result.bookletNames && result.bookletNames.length > 0 ?
              result.bookletNames :
              undefined,
          unitNames:
            result.unitNames && result.unitNames.length > 0 ?
              result.unitNames :
              undefined,
          personIds:
            result.personIds && result.personIds.length > 0 ?
              result.personIds :
              undefined,
          includeLogAnomalies:
            exportType === 'results' && result.includeLogAnomalies ?
              true :
              undefined
        };

        this.isExporting.set(true);
        this.exportTypeInProgress.set(exportType === 'results' ? 'test-results' : 'test-logs');
        const exportMethod =
          exportType === 'results' ?
            this.testResultBackendService.startExportTestResultsJob(
              this.appService.selectedWorkspaceId,
              filters
            ) :
            this.testResultBackendService.startExportTestLogsJob(
              this.appService.selectedWorkspaceId,
              filters
            );

        exportMethod.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: response => {
            this.exportJobId.set(response.jobId);
            this.exportJobStatus.set('active');
            this.snackBar.open(
              'Export gestartet. Sie werden benachrichtigt, wenn der Download bereitsteht.',
              'OK',
              { duration: 3000 }
            );
            this.pollExportJobStatus(response.jobId);
          },
          error: () => {
            this.isExporting.set(false);
            this.exportTypeInProgress.set(null);
            this.snackBar.open('Fehler beim Starten des Exports', 'Fehler', {
              duration: 3000
            });
          }
        });
      }
    });
  }

  private checkExistingExportJobs(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    this.testResultBackendService
      .getExportTestResultsJobs(this.appService.selectedWorkspaceId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (jobs: TestResultExportJob[]) => {
          const relevantJobs = jobs.filter(
            (j: TestResultExportJob) => j.exportType === 'test-results' ||
              j.exportType === 'test-logs'
          );
          // Find the most recent active job only (not completed jobs)
          const activeJob = relevantJobs.find(
            (j: TestResultExportJob) => j.status === 'active' ||
              j.status === 'waiting' ||
              j.status === 'delayed'
          );
          if (activeJob) {
            this.exportJobId.set(activeJob.jobId);
            this.isExporting.set(true);
            this.exportTypeInProgress.set(activeJob.exportType as 'test-results' | 'test-logs');
            this.pollExportJobStatus(activeJob.jobId);
          }
        }
      });
  }

  private pollExportJobStatus(jobId: string): void {
    const pollingInterval = 2000;
    this.stopExportStatusPolling();
    this.exportStatusInterval = window.setInterval(() => {
      if (!this.appService.selectedWorkspaceId) {
        this.stopExportStatusPolling();
        return;
      }
      this.testResultBackendService
        .getExportTestResultsJobs(this.appService.selectedWorkspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (jobs: TestResultExportJob[]) => {
            const job = jobs.find(j => j.jobId === jobId);
            if (job) {
              this.exportJobStatus.set(job.status);
              this.exportJobProgress.set(job.progress);

              if (job.status === 'completed') {
                this.stopExportStatusPolling();
                this.isExporting.set(false);
                const snackBarRef = this.snackBar.open(
                  'Export abgeschlossen',
                  'Herunterladen',
                  { duration: 10000 }
                );
                snackBarRef.onAction().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
                  this.downloadExportResult(jobId);
                });
              } else if (job.status === 'failed') {
                this.stopExportStatusPolling();
                this.isExporting.set(false);
                this.snackBar.open('Export fehlgeschlagen', 'Fehler', {
                  duration: 5000
                });
              } else if (job.status === 'cancelled') {
                this.resetExportState();
                this.snackBar.open('Export abgebrochen', 'OK', {
                  duration: 3000
                });
              }
            } else {
              this.resetExportState();
            }
          },
          error: () => {
            this.resetExportState();
          }
        });
    }, pollingInterval);
  }

  private cancelExportJob(jobId?: string | null): void {
    if (!this.appService.selectedWorkspaceId || !jobId) {
      return;
    }

    this.testResultBackendService
      .cancelTestResultExportJob(this.appService.selectedWorkspaceId, jobId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          if (response.success) {
            this.resetExportState();
            this.snackBar.open('Export abgebrochen', 'OK', {
              duration: 3000
            });
            return;
          }

          this.snackBar.open('Export konnte nicht abgebrochen werden', 'Fehler', {
            duration: 5000
          });
        },
        error: () => {
          this.snackBar.open('Export konnte nicht abgebrochen werden', 'Fehler', {
            duration: 5000
          });
        }
      });
  }

  private resetExportState(): void {
    this.stopExportStatusPolling();
    this.isExporting.set(false);
    this.exportJobStatus.set(null);
    this.exportJobProgress.set(0);
    this.exportJobId.set(null);
    this.exportTypeInProgress.set(null);
  }

  private stopExportStatusPolling(): void {
    if (this.exportStatusInterval !== null) {
      window.clearInterval(this.exportStatusInterval);
      this.exportStatusInterval = null;
    }
  }

  downloadExportResult(jobId: string): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    this.testResultBackendService
      .downloadExportTestResultsJob(this.appService.selectedWorkspaceId, jobId).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: blob => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const datePart = new Date().toISOString().split('T')[0];
          const suffix =
            this.exportTypeInProgress() === 'test-logs' ? 'logs' : 'results';
          link.download = `workspace-${this.appService.selectedWorkspaceId}-${suffix}-${datePart}.csv`;
          link.click();
          window.URL.revokeObjectURL(url);

          // Hide the download button after successful download
          this.resetExportState();

          // Delete the job from the server
          this.testResultBackendService
            .deleteTestResultExportJob(
              this.appService.selectedWorkspaceId,
              jobId
            ).pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe();
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Herunterladen der Ergebnisse',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }
}
