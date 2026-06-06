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
  Component,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';

import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  MatPaginator,
  MatPaginatorModule,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import {
  BehaviorSubject,
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  finalize,
  firstValueFrom,
  switchMap,
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
import { MatDialog } from '@angular/material/dialog';
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
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
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
import { TestResultsUploadJobDto } from '../../../../../../../api-dto/files/test-results-upload-job.dto';
import { TestResultsUploadResultDialogComponent } from './test-results-upload-result-dialog.component';
import {
  TestResultsImportProgressDialogComponent,
  TestResultsImportProgressHandle,
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
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private deleteTaskSubscription: Subscription | null = null;
  private flatFilterRequestSubscription: Subscription | null = null;
  private readonly SEARCH_DEBOUNCE_TIME = 800;
  selection = new SelectionModel<P>(true, []);
  dataSource!: MatTableDataSource<P>;
  displayedColumns: string[] = [
    'select',
    'code',
    'group',
    'login',
    'uploaded_at'
  ];

  isTableView: boolean = false;
  quickSearchTableFilters: Partial<FlatResponseFilters> | null = null;
  forceShowLogAnomalyTableColumn = false;
  data: P[] = [];
  booklets!: Booklet[];
  results: { [key: string]: unknown }[] = [];
  responses: Response[] = [];
  logs: UnitLog[] = [];
  bookletLogs: { [key: string]: unknown }[] = [];
  totalRecords: number = 0;
  pageSize: number = 50;
  pageIndex: number = 0;
  selectedUnit: Unit | undefined;
  testPerson!: P;
  selectedBooklet!: Booklet | string;
  isLoading: boolean = true;
  isUploadingResults: boolean = false;
  isSearching: boolean = false;
  isLoadingBooklets: boolean = false;
  isDeletingTestPersons: boolean = false;
  activeDeleteTask: ValidationTaskDto | null = null;
  deleteProgress: number = 0;
  deleteProgressMessage: string = '';
  unitTags: UnitTagDto[] = [];
  unitTagsMap: Map<number, UnitTagDto[]> = new Map();
  unitNotes: UnitNoteDto[] = [];
  unitNotesMap: Map<number, UnitNoteDto[]> = new Map();
  isVariableValidationRunning: boolean = false;
  variableValidationResult: VariableValidationDto | null = null;
  readonly SHORT_PROCESSING_TIME_THRESHOLD_MS: number = 60000;
  private validationStatusInterval: number | null = null;
  private isInitialized: boolean = false;

  overview: TestResultsOverviewResponse | null = null;
  isLoadingOverview: boolean = false;
  showTestResultsLogAnomalies: boolean = false;
  logAnomalySummary: LogAnomalyDashboardSummary | null = null;
  isLoadingLogAnomalySummary: boolean = false;
  logAnomalySummaryLoadFailed: boolean = false;
  logAnomalySummaryRequested: boolean = false;
  codingFreshnessSummary: CodingFreshnessSummaryDto | null = null;
  manualAppliedResultsOverview: AppliedResultsOverview | null = null;
  manualAppliedResultsOverviewLoadFailed: boolean = false;
  isLoadingManualAppliedResultsOverview: boolean = false;

  exportJobId: string | null = null;
  isExporting: boolean = false;
  exportJobStatus: string | null = null;
  exportJobProgress: number = 0;
  exportTypeInProgress: 'test-results' | 'test-logs' | null = null;
  uploadingMessage = 'Ergebnisse werden hochgeladen...';

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild('hiddenResponsesFileInput')
    hiddenResponsesFileInput!: ElementRef<HTMLInputElement>;

  @ViewChild('hiddenLogsFileInput')
    hiddenLogsFileInput!: ElementRef<HTMLInputElement>;

  ngOnInit(): void {
    this.searchSubscription = this.searchSubject
      .pipe(debounceTime(this.SEARCH_DEBOUNCE_TIME), distinctUntilChanged())
      .subscribe(searchText => {
        this.createTestResultsList(0, this.pageSize, searchText);
      });

    // Sync with upload state service
    this.uploadStateService.uploadingBatches$.subscribe(
      (batches: PendingUploadBatch[]) => {
        const myBatch = batches.find(
          (b: PendingUploadBatch) => b.workspaceId === this.appService.selectedWorkspaceId
        );
        if (myBatch) {
          this.isUploadingResults = true;
          this.uploadingMessage = `Verarbeite... ${myBatch.progress}% (${myBatch.completedCount}/${myBatch.totalJobs} Dateien)`;
          this.isLoading = true;
        } else {
          this.isUploadingResults = false;
        }
      }
    );

    this.uploadStateService.uploadsFinished$.subscribe((wsId: number) => {
      if (wsId === this.appService.selectedWorkspaceId) {
        this.loadWorkspaceOverview();
        this.reloadLogAnomalySummaryIfRequested();
        this.loadCodingFreshnessStatus();
        this.createTestResultsList(
          this.pageIndex,
          this.pageSize,
          this.getCurrentSearchText()
        );
        this.isLoading = false;
        this.isUploadingResults = false;
      }
    });

    this.flatFilterRequestSubscription =
      this.testResultService.flatResponseFilterRequests$.subscribe(request => {
        if (request.workspaceId !== this.appService.selectedWorkspaceId) {
          return;
        }
        this.quickSearchTableFilters = { ...(request.filters || {}) };
        this.forceShowLogAnomalyTableColumn =
          this.showTestResultsLogAnomalies && !!request.forceShowLogAnomalies;
        this.isTableView = true;
        this.isLoading = false;
        this.isUploadingResults = false;
      });

    this.loadTestResultsLogAnomalySetting();
    this.createTestResultsList(0, this.pageSize);
    this.loadWorkspaceOverview();
    this.loadCodingFreshnessStatus();
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
  }

  toggleTableView(): void {
    this.isTableView = !this.isTableView;
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
          .getValidationTask(this.appService.selectedWorkspaceId, task.id)
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

  isAnyValidationRunning(): boolean {
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
    this.testPerson = row;
    this.responses = [];
    this.logs = [];
    this.bookletLogs = [];
    this.selectedUnit = undefined;
    this.unitTagsMap.clear();
    this.unitNotesMap.clear();
    this.isLoadingBooklets = true;
    this.testResultService
      .getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe({
        next: (booklets: PersonTestResult[]) => {
          this.selectedBooklet = '';
          this.booklets = booklets as unknown as Booklet[];
          this.sortBooklets();
          this.sortBookletUnits();
          this.loadAllUnitTags();
          this.loadAllUnitNotes();
          this.isLoadingBooklets = false;
        },
        error: () => {
          this.isLoadingBooklets = false;
        }
      });
  }

  sortBooklets(): void {
    if (!this.booklets || this.booklets.length === 0) {
      return;
    }
    this.booklets.sort((a, b) => {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    });
  }

  sortBookletUnits(): void {
    if (!this.booklets || this.booklets.length === 0) {
      return;
    }

    this.booklets.forEach(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        booklet.units.sort((a, b) => {
          const aliasA = a.alias || a.name || '';
          const aliasB = b.alias || b.name || '';
          return aliasA.localeCompare(aliasB);
        });
      }
    });
  }

  getUnitTags(unitId: number): UnitTagDto[] {
    return this.unitTagsMap.get(unitId) || [];
  }

  loadAllUnitTags(): void {
    if (!this.booklets || this.booklets.length === 0) {
      return;
    }
    this.unitTagsMap.clear();
    this.booklets.forEach(booklet => {
      if (booklet.units && Array.isArray(booklet.units)) {
        booklet.units.forEach(unit => {
          if (unit.id && unit.tags) {
            this.unitTagsMap.set(unit.id, unit.tags);
          }
        });
      }
    });
  }

  loadAllUnitNotes(): void {
    if (!this.booklets || this.booklets.length === 0) {
      return;
    }
    this.unitNotesMap.clear();
    const unitIds: number[] = [];
    this.booklets.forEach(booklet => {
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

    this.unitNoteService
      .getNotesForMultipleUnits(this.appService.selectedWorkspaceId, unitIds)
      .subscribe({
        next: notesByUnitId => {
          Object.entries(notesByUnitId).forEach(([unitId, notes]) => {
            this.unitNotesMap.set(Number(unitId), notes as UnitNoteDto[]);
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
      )
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

          this.appService
            .createOwnToken(this.appService.selectedWorkspaceId, 1)
            .subscribe(token => {
              const queryParams = {
                auth: token,
                mode: 'booklet-view',
                unitsData: serializedBooklet
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
            });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open('Fehler beim Laden des Testhefts', 'Fehler', {
            duration: 3000
          });
        }
      });
  }

  canReplayBooklet(): boolean {
    return !!this.testPerson?.login?.trim();
  }

  private buildReplayTestPerson(bookletName: string): string | null {
    const login = this.testPerson?.login?.trim();
    if (!login) {
      return null;
    }

    return [
      login,
      this.testPerson?.code ?? '',
      this.testPerson?.group ?? '',
      bookletName
    ].join('@');
  }

  replayUnit() {
    if (
      !this.selectedUnit ||
      !this.testPerson ||
      !this.appService.selectedWorkspaceId
    ) {
      this.snackBar.open(
        'Keine gültige Unit oder Testperson ausgewählt',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    if (!this.responses || this.responses.length === 0) {
      this.snackBar.open('Keine Antworten für diese Unit vorhanden', 'Info', {
        duration: 3000
      });
      return;
    }

    const firstResponse = this.responses[0];

    this.appService
      .createOwnToken(this.appService.selectedWorkspaceId, 1)
      .subscribe({
        next: token => {
          if (!token) {
            this.snackBar.open(
              'Fehler beim Erzeugen des Authentifizierungs-Tokens',
              'Fehler',
              { duration: 3000 }
            );
            return;
          }

          this.statisticsService
            .getReplayUrl(
              this.appService.selectedWorkspaceId,
              firstResponse.id,
              token
            )
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
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Erzeugen des Authentifizierungs-Tokens',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.isSearching = true;
    this.searchSubject.next(filterValue);
  }

  openBookletLogsDialog(booklet: Booklet) {
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

  openUnitLogsDialog() {
    if (!this.selectedUnit || !this.logs || this.logs.length === 0) {
      this.snackBar.open('Keine Logs für diese Unit vorhanden', 'Info', {
        duration: 3000
      });
      return;
    }

    this.dialog.open(UnitLogsDialogComponent, {
      width: '700px',
      data: {
        logs: this.logs,
        title: `Logs für Unit: ${
          this.selectedUnit.alias || 'Unbenannte Einheit'
        }`
      }
    });
  }

  openTagsDialog() {
    if (!this.selectedUnit || !this.selectedUnit.id) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(TagDialogComponent, {
      width: '500px',
      data: {
        unitId: this.selectedUnit.id as number,
        tags: this.unitTags,
        title: `Tags für Unit: ${
          this.selectedUnit.alias || 'Unbenannte Einheit'
        }`
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.unitTags = result;
        this.unitTagsMap.set(this.selectedUnit?.id as number, result);
      }
    });
  }

  openNotesDialog() {
    if (!this.selectedUnit || !this.selectedUnit.id) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const dialogRef = this.dialog.open(NoteDialogComponent, {
      width: '600px',
      data: {
        unitId: this.selectedUnit.id as number,
        notes: this.unitNotes,
        title: `Notizen für Unit: ${
          this.selectedUnit.alias || 'Unbenannte Einheit'
        }`
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.unitNotes = result;
        this.unitNotesMap.set(this.selectedUnit?.id as number, result);
      }
    });
  }

  onUnitClick(unit: Unit, booklet: Booklet): void {
    const mappedResponses = unit.results.map((response: UnitResult) => ({
      ...response,
      status: response.status,
      expanded: false
    }));
    this.responses = Array.from(mappedResponses);
    this.selectedBooklet = booklet.name;

    this.responses.sort((a: Response, b: Response) => {
      if (a.status === 'VALUE_CHANGED' && b.status !== 'VALUE_CHANGED') {
        return -1;
      }
      if (a.status !== 'VALUE_CHANGED' && b.status === 'VALUE_CHANGED') {
        return 1;
      }
      return a.variableid.localeCompare(b.variableid);
    });

    this.logs = unit.logs;
    this.selectedUnit = unit;

    this.loadUnitTags();
    this.loadUnitNotes();
  }

  loadUnitTags(): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      this.unitTags =
        this.unitTagsMap.get(this.selectedUnit.id as number) || [];
    } else {
      this.unitTags = [];
    }
  }

  loadUnitNotes(): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      const unitId = this.selectedUnit.id as number;
      if (this.unitNotesMap.has(unitId)) {
        this.unitNotes = this.unitNotesMap.get(unitId) || [];
      } else {
        this.unitNoteService
          .getUnitNotes(this.appService.selectedWorkspaceId, unitId)
          .subscribe({
            next: notes => {
              this.unitNotes = notes;
              this.unitNotesMap.set(unitId, notes);
            },
            error: () => {
              this.snackBar.open('Fehler beim Laden der Notizen', 'Fehler', {
                duration: 3000
              });
            }
          });
      }
    } else {
      this.unitNotes = [];
    }
  }

  hasUnitNotes(unitId: number): boolean {
    if (!unitId || !this.unitNotesMap.has(unitId)) {
      return false;
    }
    const notes = this.unitNotesMap.get(unitId) || [];
    return notes.length > 0;
  }

  setSelectedBooklet(booklet: Booklet) {
    this.selectedBooklet = booklet.name;
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

  isBookletComplete(booklet: Booklet): boolean {
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

  hasShortProcessingTime(booklet: Booklet): boolean {
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

  hasGeogebraResponse(unit: Unit): boolean {
    if (!unit || !unit.results || !Array.isArray(unit.results)) {
      return false;
    }

    return unit.results.some(
      (response: UnitResult) => response.value && response.value.startsWith('UEsD')
    );
  }

  getColor(status: string): string {
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

  clearSearch(): void {
    const searchInput = document.querySelector(
      '.search-input'
    ) as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
      this.createTestResultsList(0, this.pageSize);
    }
  }

  onPaginatorChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.createTestResultsList(
      this.pageIndex,
      this.pageSize,
      this.getCurrentSearchText()
    );
  }

  createTestResultsList(
    page: number = 0,
    limit: number = 50,
    searchText: string = ''
  ): void {
    this.isLoading = true;
    this.testResultService
      .getTestResults(
        this.appService.selectedWorkspaceId,
        page,
        limit,
        searchText
      )
      .subscribe({
        next: response => {
          this.isLoading = false;
          this.isSearching = false;
          const { data, total } = response;
          this.updateTable(data, total);
        },
        error: () => {
          this.isLoading = false;
        }
      });
  }

  private loadWorkspaceOverview(): void {
    this.isLoadingOverview = true;
    this.testResultService
      .getWorkspaceOverview(this.appService.selectedWorkspaceId)
      .subscribe({
        next: result => {
          if (result) {
            this.overview = result;
          }
          this.isLoadingOverview = false;
        },
        error: () => {
          this.isLoadingOverview = false;
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
      .getShowTestResultsLogAnomalies(workspaceId)
      .subscribe(enabled => {
        this.setShowTestResultsLogAnomalies(enabled);
      });
  }

  private setShowTestResultsLogAnomalies(enabled: boolean): void {
    this.showTestResultsLogAnomalies = enabled;

    if (!enabled) {
      this.logAnomalySummary = null;
      this.logAnomalySummaryLoadFailed = false;
      this.isLoadingLogAnomalySummary = false;
      this.logAnomalySummaryRequested = false;
    }
  }

  private loadLogAnomalySummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId || !this.showTestResultsLogAnomalies) {
      this.logAnomalySummary = null;
      this.logAnomalySummaryLoadFailed = false;
      this.isLoadingLogAnomalySummary = false;
      this.logAnomalySummaryRequested = false;
      return;
    }

    const getLogAnomalySummary =
      (this.testResultService as Partial<TestResultService>).getLogAnomalySummary;
    if (!getLogAnomalySummary) {
      return;
    }

    this.logAnomalySummaryRequested = true;
    this.isLoadingLogAnomalySummary = true;
    this.logAnomalySummaryLoadFailed = false;
    getLogAnomalySummary.call(this.testResultService, workspaceId)
      .pipe(finalize(() => {
        this.isLoadingLogAnomalySummary = false;
      }))
      .subscribe({
        next: summary => {
          this.logAnomalySummary = summary;
        },
        error: () => {
          this.logAnomalySummary = null;
          this.logAnomalySummaryLoadFailed = true;
        }
      });
  }

  loadLogAnomalySummaryOnDemand(): void {
    this.loadLogAnomalySummary();
  }

  private reloadLogAnomalySummaryIfRequested(): void {
    if (this.showTestResultsLogAnomalies && this.logAnomalySummaryRequested) {
      this.loadLogAnomalySummary();
    }
  }

  get hasLogAnomalySummary(): boolean {
    return !!this.logAnomalySummary;
  }

  get logAnomalyAffectedPercent(): number {
    const total = Number(this.logAnomalySummary?.totalBooklets || 0);
    if (total <= 0) {
      return 0;
    }
    return Math.round(
      (Number(this.logAnomalySummary?.affectedBooklets || 0) / total) * 1000
    ) / 10;
  }

  get logAnomalyTopCodes(): Array<{ code: string; label: string; count: number }> {
    const byCode = this.logAnomalySummary?.byCode || {};
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
    this.quickSearchTableFilters = { logAnomalies: 'any' };
    this.forceShowLogAnomalyTableColumn = this.showTestResultsLogAnomalies;
    this.isTableView = true;
    this.isLoading = false;
    this.isUploadingResults = false;
  }

  openLogAnomalyDetailsDialog(): void {
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

    getLogAnomalyDetails.call(this.testResultService, workspaceId)
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
                this.logAnomalySummary?.affectedBooklets || details.total,
              rows: details.data,
              truncated: details.total > details.data.length
            }
          });

          dialogRef.afterClosed().subscribe(result => {
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

  private loadCodingFreshnessStatus(): void {
    this.loadCodingFreshnessSummary();
    this.loadManualAppliedResultsOverview();
  }

  private loadCodingFreshnessSummary(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.codingFreshnessSummary = null;
      return;
    }

    const getCodingFreshness =
      (this.statisticsService as Partial<CodingStatisticsService>).getCodingFreshness;
    if (!getCodingFreshness) {
      return;
    }

    getCodingFreshness.call(this.statisticsService, workspaceId)
      .subscribe({
        next: summary => {
          this.codingFreshnessSummary = summary;
        },
        error: () => {
          this.codingFreshnessSummary = null;
        }
      });
  }

  private loadManualAppliedResultsOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.manualAppliedResultsOverview = null;
      this.manualAppliedResultsOverviewLoadFailed = false;
      this.isLoadingManualAppliedResultsOverview = false;
      return;
    }

    this.isLoadingManualAppliedResultsOverview = true;
    this.manualAppliedResultsOverviewLoadFailed = false;
    this.testPersonCodingService.getAppliedResultsOverview(workspaceId)
      .pipe(finalize(() => {
        this.isLoadingManualAppliedResultsOverview = false;
      }))
      .subscribe({
        next: overview => {
          this.manualAppliedResultsOverview = overview;
          this.manualAppliedResultsOverviewLoadFailed = overview === null;
        },
        error: () => {
          this.manualAppliedResultsOverview = null;
          this.manualAppliedResultsOverviewLoadFailed = true;
        }
      });
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

  get overviewResponseStatusTotal(): number {
    return Object.values(this.overview?.responseStatusCounts || {})
      .reduce((sum, count) => sum + (Number(count) || 0), 0);
  }

  get overviewStatusCounts(): Array<{ status: string; count: number; percent: number }> {
    const map = (this.overview?.responseStatusCounts || {}) as Record<
    string,
    number
    >;
    const total = this.overviewResponseStatusTotal;
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

  private get allCodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return (this.codingFreshnessSummary?.items || [])
      .filter(isCodingFreshnessOpenWarning)
      .sort((a, b) => a.version.localeCompare(b.version) || a.state.localeCompare(b.state));
  }

  get codingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return this.allCodingFreshnessWarnings
      .filter(item => !(item.version === 'v3' && (
        this.isSecondAutocodingManualStatusPending ||
        this.isSecondAutocodingWaitingForManualCoding
      )));
  }

  get hasCodingFreshnessWarning(): boolean {
    return this.codingFreshnessWarnings.length > 0 ||
      this.shouldShowSecondAutocodingWaitingState;
  }

  get codingFreshnessDisplayWarnings(): CodingFreshnessSummaryItemDto[] {
    if (this.codingFreshnessWarnings.length > 0) {
      return this.codingFreshnessWarnings;
    }

    if (this.shouldShowSecondAutocodingWaitingState) {
      return this.secondAutocodingFreshnessWarnings;
    }

    return [];
  }

  get autoCodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return getCodingFreshnessAutoCodingWarnings(this.codingFreshnessWarnings);
  }

  get manualCodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return getCodingFreshnessManualReviewWarnings(this.codingFreshnessWarnings);
  }

  get hasOnlyManualCodingFreshnessWarnings(): boolean {
    return hasOnlyManualCodingFreshnessWarnings(this.codingFreshnessWarnings);
  }

  get codingFreshnessAffectedUnitVersions(): number {
    return getCodingFreshnessAffectedTaskResultCount(this.codingFreshnessWarnings);
  }

  get codingFreshnessAffectedResponses(): number {
    return getCodingFreshnessAffectedResponseCount(this.codingFreshnessWarnings);
  }

  get codingFreshnessSummaryText(): string {
    if (this.shouldShowSecondAutocodingWaitingState) {
      return this.getSecondAutocodingWaitingSummaryText();
    }

    return getCodingFreshnessSummaryText(this.codingFreshnessWarnings);
  }

  get codingFreshnessExplanationText(): string {
    if (this.shouldShowSecondAutocodingWaitingState) {
      return this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.help,
        { taskResultHelp: CODING_FRESHNESS_TASK_RESULT_HELP }
      );
    }

    const guidanceText = getCodingFreshnessManualReviewGuidanceText(
      this.codingFreshnessWarnings
    );
    if (guidanceText) {
      return `${guidanceText} ${CODING_FRESHNESS_TASK_RESULT_HELP}`;
    }

    return CODING_FRESHNESS_TASK_RESULT_HELP;
  }

  get codingFreshnessBannerTitle(): string {
    if (this.shouldShowSecondAutocodingWaitingState) {
      return this.translateService.instant(SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.title);
    }

    return getCodingFreshnessAttentionTitle(this.codingFreshnessWarnings);
  }

  get codingFreshnessActionLabel(): string {
    if (this.shouldShowSecondAutocodingWaitingState || this.hasOnlyManualCodingFreshnessWarnings) {
      return 'Manuelle Kodierung öffnen';
    }

    return this.autoCodingFreshnessWarnings.length > 0 ?
      'Auto-Coding öffnen' :
      'Kodierung öffnen';
  }

  get codingFreshnessActionIcon(): string {
    return (this.shouldShowSecondAutocodingWaitingState || this.hasOnlyManualCodingFreshnessWarnings) ?
      'keyboard' :
      'rule';
  }

  getCodingFreshnessVersionLabel(version: CodingFreshnessVersion): string {
    return getCodingFreshnessVersionLabel(version);
  }

  getCodingFreshnessStateLabel(state: CodingFreshnessState): string {
    return getCodingFreshnessStateLabel(state);
  }

  getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
    if (item.version === 'v3' && this.isSecondAutocodingWaitingForManualCoding) {
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

  private get secondAutocodingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return getSecondAutocodingFreshnessWarnings(this.allCodingFreshnessWarnings);
  }

  private get isSecondAutocodingWaitingForManualCoding(): boolean {
    return isSecondAutocodingWaitingForManualCoding(
      this.allCodingFreshnessWarnings,
      this.manualAppliedResultsOverview,
      this.manualAppliedResultsOverviewLoadFailed
    );
  }

  private get isSecondAutocodingManualStatusPending(): boolean {
    return this.secondAutocodingFreshnessWarnings.length > 0 &&
      this.isLoadingManualAppliedResultsOverview &&
      !this.manualAppliedResultsOverviewLoadFailed;
  }

  private get shouldShowSecondAutocodingWaitingState(): boolean {
    if (this.isSecondAutocodingManualStatusPending) {
      return false;
    }

    return this.isSecondAutocodingWaitingForManualCoding &&
      this.codingFreshnessWarnings.length === 0;
  }

  private getSecondAutocodingWaitingSummaryText(): string {
    if (this.manualAppliedResultsOverviewLoadFailed) {
      return this.translateService.instant(SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.loadFailed);
    }

    const remaining = this.manualAppliedResultsOverview?.remainingResponses || 0;
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

  openCodingFreshnessTarget(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    const target = (this.shouldShowSecondAutocodingWaitingState || this.hasOnlyManualCodingFreshnessWarnings) ?
      'manual' :
      'management';
    this.router.navigate([`/workspace-admin/${workspaceId}/coding/${target}`]);
  }

  onFlatTableResponseDeleted(): void {
    this.testResultService.invalidateCache(this.appService.selectedWorkspaceId);
    this.loadWorkspaceOverview();
    this.reloadLogAnomalySummaryIfRequested();
    this.loadCodingFreshnessStatus();
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
    return this.toSortedCountList(this.overview?.sessionBrowserCounts);
  }

  get overviewOsCounts(): Array<{ key: string; count: number }> {
    return this.toSortedCountList(this.overview?.sessionOsCounts);
  }

  get overviewScreenCounts(): Array<{ key: string; count: number }> {
    return this.toSortedCountList(this.overview?.sessionScreenCounts);
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

  openSessionDistributionsDialog(): void {
    if (!this.overview) {
      return;
    }

    this.dialog.open(SessionDistributionsDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: {
        browserCounts: this.overview.sessionBrowserCounts || {},
        osCounts: this.overview.sessionOsCounts || {},
        screenCounts: this.overview.sessionScreenCounts || {}
      }
    });
  }

  openResponseStatusInTable(status: string): void {
    this.quickSearchTableFilters = { responseStatus: status };
    this.forceShowLogAnomalyTableColumn = false;
    this.isTableView = true;
    this.isLoading = false;
    this.isUploadingResults = false;
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

  isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource?.data.length ?? 0;
    return numSelected === numRows;
  }

  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource?.data.forEach(row => this.selection.select(row));
    }
  }

  toggleRowSelection(row: P): void {
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
    this.totalRecords = total;
    this.dataSource.sort = this.sort;
  }

  openImportDialog(): void {
    const dialogRef = this.dialog.open(TestResultsImportDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result) {
        switch (result.type) {
          case 'testcenter':
            await this.testCenterImport();
            break;
          case 'responses':
            this.hiddenResponsesFileInput.nativeElement.click();
            break;
          case 'logs':
            this.hiddenLogsFileInput.nativeElement.click();
            break;
          default:
            break;
        }
      }
    });
  }

  async testCenterImport(): Promise<void> {
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

    const workspaceId = this.appService.selectedWorkspaceId;
    let loadedBeforeOverview: TestResultsOverviewResponse | null = null;
    if (workspaceId) {
      try {
        loadedBeforeOverview = await firstValueFrom(
          this.testResultService.getWorkspaceOverview(workspaceId)
        );
      } catch {
        loadedBeforeOverview = null;
      }
    }
    const beforeOverview =
      loadedBeforeOverview || this.overview || fallbackOverview;

    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '1200px',
      maxWidth: '95vw',
      minHeight: '800px',
      disableClose: true,
      data: {
        importType: 'testResults'
      }
    });

    const sleep = (ms: number) => new Promise<void>(resolve => {
      window.setTimeout(() => resolve(), ms);
    });

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
            overview: this.overview || fallbackOverview,
            loaded: false,
            changed: false
          };
        }

        // A loaded overview is the reliable result. It may legitimately be unchanged
        // when an import only confirms already existing data.
        for (let i = 0; i < 12; i += 1) {
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
              this.testResultService.getWorkspaceOverview(workspaceId)
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
            this.testResultService.getWorkspaceOverview(workspaceId)
          );
        } catch {
          finalOverview = null;
        }
        return {
          overview: finalOverview || this.overview || beforeOverview,
          loaded: !!finalOverview,
          changed: !!finalOverview && hasOverviewChanged(finalOverview)
        };
      };

    dialogRef.afterClosed().subscribe(result => {
      const maybePayload = result as
        | {
          didImport?: boolean;
          resultType?: 'logs' | 'responses';
        }
        | boolean
        | UntypedFormGroup
        | undefined;

      if (
        maybePayload &&
        typeof maybePayload === 'object' &&
        'didImport' in maybePayload &&
        (maybePayload as { didImport?: boolean }).didImport
      ) {
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

          let overviewResult: {
            overview: TestResultsOverviewResponse;
            loaded: boolean;
            changed: boolean;
          } = {
            overview: this.overview || beforeOverview,
            loaded: false,
            changed: false
          };

          try {
            if (workspaceId) {
              this.testResultService.invalidateCache(workspaceId);
            }

            overviewResult = await pollOverviewAfterImport(progressState$);

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
            progressDialogRef.close();
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
          if (codingFreshness) {
            this.codingFreshnessSummary = codingFreshness;
          }
          const manualOverviewResult = workspaceId ?
            await this.fetchManualAppliedResultsOverview(workspaceId) :
            {
              overview: this.manualAppliedResultsOverview,
              loadFailed: this.manualAppliedResultsOverviewLoadFailed
            };
          this.manualAppliedResultsOverview = manualOverviewResult.overview;
          this.manualAppliedResultsOverviewLoadFailed = manualOverviewResult.loadFailed;

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
        })();
      }

      if (result instanceof UntypedFormGroup || result) {
        if (workspaceId) {
          this.testResultService.invalidateCache(workspaceId);
        }
        this.loadWorkspaceOverview();
        this.loadCodingFreshnessStatus();
        this.createTestResultsList(
          this.pageIndex,
          this.pageSize,
          this.getCurrentSearchText()
        );
      }
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
          .afterClosed()
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
              const uploadTitle =
                resultType === 'logs' ?
                  'Upload-Ergebnis (Logs)' :
                  'Upload-Ergebnis (Antworten)';
              const uploadIcon = resultType === 'logs' ? 'article' : 'upload_file';
              const progressState$ = new BehaviorSubject<TestResultsImportProgressState>({
                title: uploadTitle,
                icon: uploadIcon,
                phase: 'uploading',
                phaseLabel: 'Datei wird hochgeladen',
                message: resultType === 'logs' ?
                  'Die Log-Datei wird in Teilen übertragen.' :
                  'Die Antwortdatei wird in Teilen übertragen.',
                percent: 0,
                mode: 'determinate'
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
              const progressHandle: TestResultsImportProgressHandle = {
                dialogRef: progressDialogRef,
                state$: progressState$
              };

              this.isLoading = true;
              this.isUploadingResults = true;

              if (resultType === 'responses') {
                this.uploadingMessage = 'Importiere Antworten... (0%)';
              } else if (resultType === 'logs') {
                this.uploadingMessage = 'Importiere Logs... (0%)';
              } else {
                this.uploadingMessage = 'Ergebnisse werden hochgeladen... (0%)';
              }

              const file = inputElement.files![0];
              this.fileService
                .uploadTestResultsChunked(
                  this.appService.selectedWorkspaceId,
                  file,
                  resultType,
                  {
                    overwriteExisting,
                    overwriteMode,
                    scope,
                    filters
                  },
                  (percent: number) => {
                    if (resultType === 'responses') {
                      this.uploadingMessage = `Importiere Antworten... (${percent}%)`;
                    } else if (resultType === 'logs') {
                      this.uploadingMessage = `Importiere Logs... (${percent}%)`;
                    } else {
                      this.uploadingMessage = `Ergebnisse werden hochgeladen... (${percent}%)`;
                    }
                    progressState$.next({
                      title: uploadTitle,
                      icon: uploadIcon,
                      phase: 'uploading',
                      phaseLabel: 'Datei wird hochgeladen',
                      message: resultType === 'logs' ?
                        'Die Log-Datei wird in Teilen übertragen.' :
                        'Die Antwortdatei wird in Teilen übertragen.',
                      percent,
                      mode: 'determinate'
                    });
                  }
                )
                .subscribe({
                  next: (jobs: TestResultsUploadJobDto[]) => {
                    progressState$.next({
                      title: uploadTitle,
                      icon: uploadIcon,
                      phase: 'processing',
                      phaseLabel: 'Verarbeitung läuft',
                      message: 'Upload abgeschlossen. Der Server verarbeitet die Datei.',
                      percent: 0,
                      completed: 0,
                      total: jobs.length,
                      mode: 'determinate'
                    });

                    const beforeOverview = this.overview || {
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

                    this.uploadStateService.registerBatch({
                      workspaceId: this.appService.selectedWorkspaceId,
                      jobIds: jobs.map(j => j.jobId),
                      resultType,
                      beforeOverview,
                      initialIssues: [],
                      progress: 0,
                      completedCount: 0,
                      totalJobs: jobs.length
                    }, progressHandle);
                  },
                  error: err => {
                    progressDialogRef.close();
                    progressState$.complete();
                    this.isLoading = false;
                    this.isUploadingResults = false;
                    this.snackBar.open(
                      `Fehler beim Upload-Start: ${err.message}`,
                      'Fehler',
                      { duration: 5000 }
                    );
                  }
                });
            }
          );
      }
    }
  }

  deleteSelectedPersons(): void {
    const selectedTestPersons = this.selection.selected;
    if (selectedTestPersons.length === 0) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'persons',
      personIds: selectedTestPersons.map(person => person.id)
    });
  }

  deleteFilteredPersons(): void {
    this.confirmAndStartDelete({
      scope: 'filteredPersons',
      searchText: this.getCurrentSearchText()
    });
  }

  deleteSelectedGroups(): void {
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

  deleteBookletsByName(bookletName: string): void {
    if (!bookletName) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'booklets',
      bookletNames: [bookletName]
    });
  }

  deleteUnitsByName(unit: Unit): void {
    const unitName = unit.alias || unit.name;
    if (!unitName) {
      return;
    }

    this.confirmAndStartDelete({
      scope: 'units',
      unitNames: [unitName]
    });
  }

  openResponseCleanupDialog(): void {
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

    dialogRef.afterClosed().subscribe(
      (request: TestResultsResponseCleanupRequestDto | false | undefined) => {
        if (request) {
          this.confirmAndStartResponseCleanup(request);
        }
      }
    );
  }

  isDeleteJobRunning(): boolean {
    return this.activeDeleteTask?.status === 'pending' ||
      this.activeDeleteTask?.status === 'processing' ||
      this.isDeletingTestPersons;
  }

  private confirmAndStartDelete(request: TestResultsDeleteRequestDto): void {
    if (this.isDeleteJobRunning()) {
      return;
    }

    this.isDeletingTestPersons = true;

    this.testResultService
      .previewDeleteTestResults(this.appService.selectedWorkspaceId, request)
      .subscribe({
        next: preview => {
          this.isDeletingTestPersons = false;
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
          this.isDeletingTestPersons = false;
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

    this.isDeletingTestPersons = true;

    this.testResultService
      .previewDeleteTestResultResponses(
        this.appService.selectedWorkspaceId,
        request
      )
      .subscribe({
        next: preview => {
          this.isDeletingTestPersons = false;
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
          this.isDeletingTestPersons = false;
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

    dialogRef.afterClosed().subscribe(confirmed => {
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

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.startResponseCleanupJob(request);
      }
    });
  }

  private startDeleteJob(request: TestResultsDeleteRequestDto): void {
    this.resetSelectedResultDetails();
    this.isDeletingTestPersons = true;
    this.deleteProgress = 0;
    this.deleteProgressMessage = 'Löschung wird gestartet...';

    this.testResultService
      .createDeleteTestResultsJob(this.appService.selectedWorkspaceId, request)
      .subscribe({
        next: task => {
          this.activeDeleteTask = task;
          this.pollDeleteTask(task.id);
        },
        error: () => {
          this.isDeletingTestPersons = false;
          this.activeDeleteTask = null;
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
    this.isDeletingTestPersons = true;
    this.deleteProgress = 0;
    this.deleteProgressMessage = 'Antwort-Löschung wird gestartet...';

    this.testResultService
      .createDeleteTestResultResponsesJob(
        this.appService.selectedWorkspaceId,
        request
      )
      .subscribe({
        next: task => {
          this.activeDeleteTask = task;
          this.pollDeleteTask(task.id);
        },
        error: () => {
          this.isDeletingTestPersons = false;
          this.activeDeleteTask = null;
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
          this.activeDeleteTask = task;
          this.deleteProgress = task.progress || 0;
          this.deleteProgressMessage =
            task.progress_message || 'Löschung läuft...';

          if (task.status === 'completed') {
            this.finishDeleteTask(task.id);
          } else if (task.status === 'failed') {
            this.isDeletingTestPersons = false;
            this.activeDeleteTask = null;
            this.snackBar.open(
              task.error || 'Die Löschung ist fehlgeschlagen.',
              'Fehler',
              { duration: 5000 }
            );
          }
        },
        error: () => {
          this.isDeletingTestPersons = false;
          this.activeDeleteTask = null;
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
      .getValidationResults(this.appService.selectedWorkspaceId, taskId)
      .subscribe({
        next: result => {
          const deleteResult = result as TestResultsDeleteResultDto;
          this.isDeletingTestPersons = false;
          this.activeDeleteTask = null;
          this.deleteProgress = 100;
          this.selection.clear();
          this.testResultService.invalidateCache(
            this.appService.selectedWorkspaceId
          );
          this.validationTaskStateService.invalidateWorkspace(
            this.appService.selectedWorkspaceId
          );
          this.loadWorkspaceOverview();
          this.loadCodingFreshnessStatus();
          this.testPersonCodingService.notifyTestResultsChanged();
          this.createTestResultsList(
            this.pageIndex,
            this.pageSize,
            this.getCurrentSearchText()
          );
          this.snackBar.open(
            `Löschung abgeschlossen: ${deleteResult.deletedTargetCount} Datensätze verarbeitet. Betroffene Kodierungen wurden mit entfernt.`,
            'OK',
            { duration: 4000 }
          );
        },
        error: () => {
          this.isDeletingTestPersons = false;
          this.activeDeleteTask = null;
          this.snackBar.open(
            'Die Löschung wurde abgeschlossen, das Ergebnis konnte aber nicht geladen werden.',
            'Info',
            { duration: 5000 }
          );
          this.loadWorkspaceOverview();
          this.loadCodingFreshnessStatus();
          this.testPersonCodingService.notifyTestResultsChanged();
          this.createTestResultsList(
            this.pageIndex,
            this.pageSize,
            this.getCurrentSearchText()
          );
        }
      });
  }

  private resetSelectedResultDetails(): void {
    this.booklets = [];
    this.responses = [];
    this.logs = [];
    this.bookletLogs = [];
    this.selectedUnit = undefined;
    this.selectedBooklet = '';
    this.unitTagsMap.clear();
    this.unitNotesMap.clear();
  }

  openTestResultsSearchDialog(): void {
    const dialogRef = this.dialog.open(TestResultsSearchComponent, {
      width: '1200px',
      data: {
        title: 'Testergebnisse schnell finden'
      }
    });

    dialogRef.afterClosed().subscribe((result?: QuickSearchDialogResult) => {
      if (!result) {
        return;
      }

      if (result.action === 'table') {
        this.quickSearchTableFilters = result.filters || null;
        this.forceShowLogAnomalyTableColumn = false;
        this.isTableView = true;
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

    this.isTableView = false;
    this.testPerson = {
      id: item.personId,
      code: item.personCode || '',
      group: item.personGroup || '',
      login: item.personLogin || '',
      uploaded_at: new Date()
    };
    this.resetSelectedResultDetails();
    this.isLoadingBooklets = true;

    this.testResultService
      .getPersonTestResults(this.appService.selectedWorkspaceId, item.personId)
      .subscribe({
        next: (booklets: PersonTestResult[]) => {
          this.booklets = booklets as unknown as Booklet[];
          this.sortBooklets();
          this.sortBookletUnits();
          this.loadAllUnitTags();
          this.loadAllUnitNotes();
          this.isLoadingBooklets = false;

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
            this.responses = this.responses.map(response => ({
              ...response,
              expanded: response.variableid === item.variableId
            }));
          }
        },
        error: () => {
          this.isLoadingBooklets = false;
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
    if (!this.booklets || (!item.bookletId && !item.bookletName)) {
      return undefined;
    }

    return this.booklets.find(booklet => {
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

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.unitService
          .deleteUnit(this.appService.selectedWorkspaceId, unit.id as number)
          .subscribe({
            next: result => {
              if (result.success) {
                const unitIndex = booklet.units.findIndex(
                  u => u.id === unit.id
                );
                if (unitIndex !== -1) {
                  booklet.units.splice(unitIndex, 1);
                }

                if (this.selectedUnit && this.selectedUnit.id === unit.id) {
                  this.selectedUnit = undefined;
                  this.responses = [];
                  this.logs = [];
                }

                this.snackBar.open(
                  `Unit "${
                    unit.alias || 'Unbenannte Einheit'
                  }" wurde erfolgreich gelöscht. Betroffene Kodierungen wurden mit entfernt.`,
                  'Erfolg',
                  { duration: 3000 }
                );
                this.loadWorkspaceOverview();
                this.loadCodingFreshnessStatus();
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

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.responseService
          .deleteResponse(
            this.appService.selectedWorkspaceId,
            response.id as number
          )
          .subscribe({
            next: result => {
              if (result.success) {
                const responseIndex = this.responses.findIndex(
                  r => r.id === response.id
                );
                if (responseIndex !== -1) {
                  this.responses.splice(responseIndex, 1);
                }

                this.snackBar.open(
                  `Antwort für Variable "${response.variableid}" wurde gelöscht. Kodierstatus wurde aktualisiert.`,
                  'Erfolg',
                  { duration: 3000 }
                );
                this.loadWorkspaceOverview();
                this.loadCodingFreshnessStatus();
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

  openValidationDialog(): void {
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

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        if (result.variableValidationResult) {
          this.variableValidationResult = result.variableValidationResult;
          this.isVariableValidationRunning = false;
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

  openVariableAnalysisDialog(): void {
    const loadingSnackBar = this.snackBar.open('Lade Analyse-Aufträge...', '', {
      duration: 3000
    });

    this.variableAnalysisService
      .getAllJobs(this.appService.selectedWorkspaceId)
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
              unitId: this.selectedUnit?.id,
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
    const loadingSnackBar = this.snackBar.open(
      'Lade Booklet-Informationen...',
      '',
      { duration: 3000 }
    );

    this.fileService
      .getBookletInfo(this.appService.selectedWorkspaceId, bookletName)
      .subscribe({
        next: (bookletInfo: BookletInfoDto) => {
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
    if (!this.selectedUnit || !this.selectedUnit.name) {
      this.snackBar.open('Keine Unit ausgewählt', 'Info', { duration: 3000 });
      return;
    }

    const unitFileId = String(this.selectedUnit.name || '')
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
      .getUnitInfo(this.appService.selectedWorkspaceId, unitFileId)
      .subscribe({
        next: (unitInfo: UnitInfoDto) => {
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
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Unit-Informationen',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  openExportDialog(): void {
    const dialogRef = this.dialog.open(TestResultsExportDialogComponent, {
      width: '500px',
      data: {
        isExporting: this.isExporting,
        exportTypeInProgress: this.exportTypeInProgress,
        exportJobStatus: this.exportJobStatus,
        exportJobProgress: this.exportJobProgress,
        exportJobId: this.exportJobId
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        if (result.type === 'download') {
          this.downloadExportResult(result.jobId);
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

    dialogRef.afterClosed().subscribe((result: ExportOptions | undefined) => {
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

        this.isExporting = true;
        this.exportTypeInProgress =
          exportType === 'results' ? 'test-results' : 'test-logs';
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

        exportMethod.subscribe({
          next: response => {
            this.exportJobId = response.jobId;
            this.exportJobStatus = 'active';
            this.snackBar.open(
              'Export gestartet. Sie werden benachrichtigt, wenn der Download bereitsteht.',
              'OK',
              { duration: 3000 }
            );
            this.pollExportJobStatus(response.jobId);
          },
          error: () => {
            this.isExporting = false;
            this.exportTypeInProgress = null;
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
      .getExportTestResultsJobs(this.appService.selectedWorkspaceId)
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
            this.exportJobId = activeJob.jobId;
            this.isExporting = true;
            this.exportTypeInProgress = activeJob.exportType as
              | 'test-results'
              | 'test-logs';
            this.pollExportJobStatus(activeJob.jobId);
          }
        }
      });
  }

  private pollExportJobStatus(jobId: string): void {
    const pollingInterval = 2000;
    const timer = setInterval(() => {
      if (!this.appService.selectedWorkspaceId) {
        clearInterval(timer);
        return;
      }
      this.testResultBackendService
        .getExportTestResultsJobs(this.appService.selectedWorkspaceId)
        .subscribe({
          next: (jobs: TestResultExportJob[]) => {
            const job = jobs.find(j => j.jobId === jobId);
            if (job) {
              this.exportJobStatus = job.status;
              this.exportJobProgress = job.progress;

              if (job.status === 'completed') {
                clearInterval(timer);
                this.isExporting = false;
                const snackBarRef = this.snackBar.open(
                  'Export abgeschlossen',
                  'Herunterladen',
                  { duration: 10000 }
                );
                snackBarRef.onAction().subscribe(() => {
                  this.downloadExportResult(jobId);
                });
              } else if (job.status === 'failed') {
                clearInterval(timer);
                this.isExporting = false;
                this.snackBar.open('Export fehlgeschlagen', 'Fehler', {
                  duration: 5000
                });
              }
            } else {
              clearInterval(timer);
              this.isExporting = false;
            }
          },
          error: () => {
            clearInterval(timer);
            this.isExporting = false;
          }
        });
    }, pollingInterval);
  }

  downloadExportResult(jobId: string): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    this.testResultBackendService
      .downloadExportTestResultsJob(this.appService.selectedWorkspaceId, jobId)
      .subscribe({
        next: blob => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const datePart = new Date().toISOString().split('T')[0];
          const suffix =
            this.exportTypeInProgress === 'test-logs' ? 'logs' : 'results';
          link.download = `workspace-${this.appService.selectedWorkspaceId}-${suffix}-${datePart}.csv`;
          link.click();
          window.URL.revokeObjectURL(url);

          // Hide the download button after successful download
          this.exportJobStatus = null;
          this.exportJobId = null;
          this.exportTypeInProgress = null;

          // Delete the job from the server
          this.testResultBackendService
            .deleteTestResultExportJob(
              this.appService.selectedWorkspaceId,
              jobId
            )
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
