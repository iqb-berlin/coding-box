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
  OnDestroy,
  OnInit,
  ViewChild,
  inject
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
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged
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
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDivider } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TestResultsImportDialogComponent } from './test-results-import-dialog.component';
import { TestResultsExportDialogComponent } from './test-results-export-dialog.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import {
  TestResultService,
  TestResultsOverviewResponse
} from '../../../services/test-result.service';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { TagDialogComponent } from '../tag-dialog/tag-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { TestResultsSearchComponent } from '../test-results-search/test-results-search.component';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { ValidationDialogComponent } from '../validation-dialog/validation-dialog.component';
import { VariableValidationDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';
import { ValidationTaskStateService } from '../../../services/validation-task-state.service';
import {
  UnitsReplay,
  UnitsReplayService
} from '../../../services/units-replay.service';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { UnitInfoDto } from '../../../../../../../api-dto/unit-info/unit-info.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import {
  ExportOptionsDialogComponent,
  ExportOptions
} from './export-options-dialog.component';
import { TestResultsUploadResultDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { TestResultsUploadResultDialogComponent } from './test-results-upload-result-dialog.component';
import { TestResultsFlatTableComponent } from './test-results-flat-table.component';
import {
  OverwriteMode,
  TestResultsUploadOptionsDialogComponent,
  TestResultsUploadOptionsDialogData,
  TestResultsUploadOptionsDialogResult
} from './test-results-upload-options-dialog.component';

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
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private testResultService = inject(TestResultService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private validationTaskStateService = inject(ValidationTaskStateService);
  private unitsReplayService = inject(UnitsReplayService);
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;
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

  exportJobId: string | null = null;
  isExporting: boolean = false;
  exportJobStatus: string | null = null;
  exportJobProgress: number = 0;
  exportTypeInProgress: 'test-results' | 'test-logs' | null = null;

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

    this.createTestResultsList(0, this.pageSize);
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

    this.stopValidationStatusCheck();
  }

  toggleTableView(): void {
    this.isTableView = !this.isTableView;
  }

  private startValidationStatusCheck(): void {
    this.checkValidationStatus();

    this.validationStatusInterval = window.setInterval(() => {
      this.checkValidationStatus();
    }, 5000);
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
      for (const [type, taskId] of Object.entries(taskIds)) {
        this.backendService
          .getValidationTask(this.appService.selectedWorkspaceId, taskId)
          .subscribe({
            next: task => {
              if (task.status === 'completed' || task.status === 'failed') {
                this.validationTaskStateService.removeTaskId(
                  this.appService.selectedWorkspaceId,
                  type as
                    | 'variables'
                    | 'variableTypes'
                    | 'responseStatus'
                    | 'testTakers'
                    | 'groupResponses'
                );
              }
            },
            error: () => {
              this.validationTaskStateService.removeTaskId(
                this.appService.selectedWorkspaceId,
                type as
                  | 'variables'
                  | 'variableTypes'
                  | 'responseStatus'
                  | 'testTakers'
                  | 'groupResponses'
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

  getOverallValidationStatus(): 'running' | 'failed' | 'success' | 'not-run' {
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
          'groupResponses'
        ];
        const hasAllValidations = validationTypes.every(
          type => results[type]
        );
        if (hasAllValidations) {
          return 'success';
        }

        return 'success';
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
    this.backendService
      .getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe({
        next: booklets => {
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

  exportLogs(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const dialogRef = this.dialog.open(ExportOptionsDialogComponent, {
      width: '800px',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
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
              undefined
        };

        this.isExporting = true;
        this.exportTypeInProgress = 'test-logs';
        this.backendService
          .startExportTestLogsJob(this.appService.selectedWorkspaceId, filters)
          .subscribe({
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

    this.backendService
      .getNotesForMultipleUnits(this.appService.selectedWorkspaceId, unitIds)
      .subscribe({
        next: notesByUnitId => {
          Object.entries(notesByUnitId).forEach(([unitId, notes]) => {
            this.unitNotesMap.set(Number(unitId), notes);
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

    const loadingSnackBar = this.snackBar.open('Lade Testheft...', '', {
      duration: 3000
    });

    this.unitsReplayService
      .getUnitsFromFileUpload(this.appService.selectedWorkspaceId, booklet.name)
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
            .createToken(
              this.appService.selectedWorkspaceId,
              this.appService.loggedUser?.sub || '',
              1
            )
            .subscribe(token => {
              const queryParams = {
                auth: token,
                mode: 'booklet',
                unitsData: serializedBooklet
              };

              const url = this.router.serializeUrl(
                this.router.createUrlTree(
                  [
                    `replay/${this.testPerson.login}@${this.testPerson.code}@${this.testPerson.group}@${booklet.name}/${firstUnit.name}/0/0`
                  ],
                  { queryParams: queryParams }
                )
              );

              window.open(`#/${url}`, '_blank');
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
      .createToken(
        this.appService.selectedWorkspaceId,
        this.appService.loggedUser?.sub || '',
        1
      )
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

          this.backendService
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
        this.backendService
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
    const validPage = Math.max(0, page);
    this.isLoading = !this.isSearching;
    this.testResultService
      .getTestResults(
        this.appService.selectedWorkspaceId,
        validPage,
        limit,
        searchText
      )
      .subscribe(response => {
        this.isLoading = false;
        this.isSearching = false;
        const { data, total } = response;
        this.updateTable(data, total);
      });
  }

  private loadWorkspaceOverview(): void {
    if (!this.appService.selectedWorkspaceId) {
      this.overview = null;
      return;
    }

    this.isLoadingOverview = true;
    this.testResultService
      .getWorkspaceOverview(this.appService.selectedWorkspaceId)
      .subscribe(result => {
        this.overview = result;
        this.isLoadingOverview = false;
      });
  }

  get overviewStatusCounts(): Array<{ status: string; count: number }> {
    const map = (this.overview?.responseStatusCounts || {}) as Record<
    string,
    number
    >;
    return Object.entries(map)
      .map(([status, count]) => ({ status, count: Number(count) }))
      .sort((a, b) => b.count - a.count);
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

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        switch (result.type) {
          case 'testcenter':
            this.testCenterImport();
            break;
          case 'responses':
            this.hiddenResponsesFileInput.nativeElement.click();
            break;
          case 'logs':
            this.hiddenLogsFileInput.nativeElement.click();
            break;
        }
      }
    });
  }

  testCenterImport(): void {
    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '1000px',
      maxWidth: '95vw',
      minHeight: '800px',
      data: {
        importType: 'testResults'
      }
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (result instanceof UntypedFormGroup || result) {
        if (this.appService.selectedWorkspaceId) {
          this.testResultService.invalidateCache(
            this.appService.selectedWorkspaceId
          );
        }
        this.loadWorkspaceOverview();
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

              // Backward compatibility: old behavior treated overwriteExisting=false as strict skip.
              const overwriteExisting = overwriteMode !== 'skip';

              this.isLoading = true;
              this.isUploadingResults = true;
              this.backendService
                .uploadTestResults(
                  this.appService.selectedWorkspaceId,
                  inputElement.files,
                  resultType,
                  overwriteExisting,
                  overwriteMode,
                  scope,
                  filters
                )
                .subscribe((uploadResult: TestResultsUploadResultDto) => {
                  if (this.appService.selectedWorkspaceId) {
                    this.testResultService.invalidateCache(
                      this.appService.selectedWorkspaceId
                    );
                  }

                  this.loadWorkspaceOverview();

                  this.snackBar.open(
                    `Upload abgeschlossen: Δ Testpersonen ${uploadResult.delta.testPersons}, Δ Responses ${uploadResult.delta.uniqueResponses}`,
                    'OK',
                    { duration: 5000 }
                  );

                  this.dialog.open(TestResultsUploadResultDialogComponent, {
                    width: '1000px',
                    maxWidth: '95vw',
                    data: {
                      resultType,
                      result: uploadResult
                    }
                  });

                  setTimeout(() => {
                    this.createTestResultsList(
                      this.pageIndex,
                      this.pageSize,
                      this.getCurrentSearchText()
                    );
                  }, 1000);
                  this.isLoading = false;
                  this.isUploadingResults = false;
                });
            }
          );
      }
    }
  }

  deleteSelectedPersons(): void {
    this.booklets = [];
    this.responses = [];
    this.logs = [];
    this.bookletLogs = [];
    this.selectedUnit = undefined;
    this.unitTagsMap.clear();
    this.unitNotesMap.clear();

    this.isDeletingTestPersons = true;
    const selectedTestPersons = this.selection.selected;
    this.backendService
      .deleteTestPersons(
        this.appService.selectedWorkspaceId,
        selectedTestPersons.map(person => person.id)
      )
      .subscribe(respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-deleted'),
            '',
            { duration: 1000 }
          );
          this.loadWorkspaceOverview();
          this.createTestResultsList(
            this.pageIndex,
            this.pageSize,
            this.getCurrentSearchText()
          );
        } else {
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-not-deleted'),
            this.translateService.instant('error'),
            { duration: 1000 }
          );
        }
        this.isDeletingTestPersons = false;
        this.selection.clear();
      });
  }

  openTestResultsSearchDialog(): void {
    this.dialog.open(TestResultsSearchComponent, {
      width: '1200px',
      data: {
        title: 'Testergebnisse suchen'
      }
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
        this.backendService
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
                  }" wurde erfolgreich gelöscht.`,
                  'Erfolg',
                  { duration: 3000 }
                );
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
        this.backendService
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
                  `Antwort für Variable "${response.variableid}" wurde erfolgreich gelöscht.`,
                  'Erfolg',
                  { duration: 3000 }
                );
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
    const dialogRef = this.dialog.open(ValidationDialogComponent, {
      width: '90vw',
      maxWidth: '1400px',
      height: '90vh',
      autoFocus: false,
      data: {
        autoStart: true
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

      return btoa(jsonString);
    } catch (error) {
      return '';
    }
  }

  openVariableAnalysisDialog(): void {
    const loadingSnackBar = this.snackBar.open('Lade Analyse-Aufträge...', '', {
      duration: 3000
    });

    this.backendService
      .getAllVariableAnalysisJobs(this.appService.selectedWorkspaceId)
      .subscribe({
        next: jobs => {
          loadingSnackBar.dismiss();

          const variableAnalysisJobs = jobs.filter(
            job => job.type === 'variable-analysis'
          );

          this.dialog.open(VariableAnalysisDialogComponent, {
            width: '900px',
            data: {
              unitId: this.selectedUnit?.id,
              title: 'Item/Variablen Analyse',
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

    this.backendService
      .getBookletInfo(this.appService.selectedWorkspaceId, bookletName)
      .subscribe({
        next: (bookletInfo: BookletInfoDto) => {
          loadingSnackBar.dismiss();

          this.dialog.open(BookletInfoDialogComponent, {
            width: '1200px',
            height: '80vh',
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

    const loadingSnackBar = this.snackBar.open(
      'Lade Unit-Informationen...',
      '',
      { duration: 3000 }
    );

    this.backendService
      .getUnitInfo(this.appService.selectedWorkspaceId, this.selectedUnit.name)
      .subscribe({
        next: (unitInfo: UnitInfoDto) => {
          loadingSnackBar.dismiss();

          this.dialog.open(UnitInfoDialogComponent, {
            width: '1200px',
            height: '80vh',
            data: {
              unitInfo,
              unitId: this.selectedUnit?.name
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
        workspaceId: this.appService.selectedWorkspaceId
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
              undefined
        };

        this.isExporting = true;
        this.exportTypeInProgress =
          exportType === 'results' ? 'test-results' : 'test-logs';
        const exportMethod =
          exportType === 'results' ?
            this.backendService.startExportTestResultsJob(
              this.appService.selectedWorkspaceId,
              filters
            ) :
            this.backendService.startExportTestLogsJob(
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

  exportResults(): void {
    this.startExportJob('results');
  }

  private checkExistingExportJobs(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    this.backendService
      .getExportTestResultsJobs(this.appService.selectedWorkspaceId)
      .subscribe({
        next: jobs => {
          const relevantJobs = jobs.filter(
            j => j.exportType === 'test-results' || j.exportType === 'test-logs'
          );
          // Find the most recent active job only (not completed jobs)
          const activeJob = relevantJobs.find(
            j => j.status === 'active' ||
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
      this.backendService
        .getExportTestResultsJobs(this.appService.selectedWorkspaceId)
        .subscribe({
          next: jobs => {
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
    this.backendService
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
          this.backendService
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
