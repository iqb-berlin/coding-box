import {
  MatTable,
  MatHeaderCellDef,
  MatCellDef,
  MatHeaderRowDef,
  MatRowDef,
  MatTableDataSource, MatCell, MatColumnDef, MatHeaderCell, MatHeaderRow, MatRow
} from '@angular/material/table';
import {
  Component, OnDestroy, OnInit, ViewChild, inject
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
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
  MatExpansionPanel, MatExpansionPanelHeader,
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
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { TagDialogComponent } from '../tag-dialog/tag-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { TestResultsSearchComponent } from '../test-results-search/test-results-search.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { ValidationDialogComponent } from '../validation-dialog/validation-dialog.component';
import { VariableValidationDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';
import { ValidationTaskStateService } from '../../../services/validation-task-state.service';
import { BookletReplay, BookletReplayService } from '../../../services/booklet-replay.service';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { UnitInfoDto } from '../../../../../../../api-dto/unit-info/unit-info.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';

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
  imports: [CommonModule,
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
    MatTooltipModule
  ]
})
export class TestResultsComponent implements OnInit, OnDestroy {
  private dialog = inject(MatDialog);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  private validationTaskStateService = inject(ValidationTaskStateService);
  private bookletReplayService = inject(BookletReplayService);
  private searchSubject = new Subject<string>();
  private searchSubscription: Subscription | null = null;
  private readonly SEARCH_DEBOUNCE_TIME = 800;

  selection = new SelectionModel<P>(true, []);
  dataSource !: MatTableDataSource<P>;
  displayedColumns: string[] = ['select', 'code', 'group', 'login', 'uploaded_at'];
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
  unitTags: UnitTagDto[] = [];
  unitTagsMap: Map<number, UnitTagDto[]> = new Map();
  unitNotes: UnitNoteDto[] = [];
  unitNotesMap: Map<number, UnitNoteDto[]> = new Map();
  isVariableValidationRunning: boolean = false;
  variableValidationResult: VariableValidationDto | null = null;
  readonly SHORT_PROCESSING_TIME_THRESHOLD_MS: number = 60000;
  private validationStatusInterval: number | null = null;
  private isInitialized: boolean = false;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.searchSubscription = this.searchSubject.pipe(
      debounceTime(this.SEARCH_DEBOUNCE_TIME),
      distinctUntilChanged()
    ).subscribe(searchText => {
      this.createTestResultsList(0, this.pageSize, searchText);
    });

    this.createTestResultsList(0, this.pageSize);
    this.startValidationStatusCheck();
    this.isInitialized = true;
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
      this.searchSubscription = null;
    }

    this.stopValidationStatusCheck();
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

    const taskIds = this.validationTaskStateService.getAllTaskIds(this.appService.selectedWorkspaceId);

    if (Object.keys(taskIds).length > 0) {
      for (const [type, taskId] of Object.entries(taskIds)) {
        this.backendService.getValidationTask(this.appService.selectedWorkspaceId, taskId)
          .subscribe({
            next: task => {
              if (task.status === 'completed' || task.status === 'failed') {
                this.validationTaskStateService.removeTaskId(
                  this.appService.selectedWorkspaceId,
                  type as 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses'
                );
              }
            },
            error: () => {
              this.validationTaskStateService.removeTaskId(
                this.appService.selectedWorkspaceId,
                type as 'variables' | 'variableTypes' | 'responseStatus' | 'testTakers' | 'groupResponses'
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

    const taskIds = this.validationTaskStateService.getAllTaskIds(this.appService.selectedWorkspaceId);
    return Object.keys(taskIds).length > 0;
  }

  getOverallValidationStatus(): 'running' | 'failed' | 'success' | 'not-run' {
    if (this.isAnyValidationRunning()) {
      return 'running';
    }

    if (this.appService.selectedWorkspaceId) {
      const results = this.validationTaskStateService.getAllValidationResults(this.appService.selectedWorkspaceId);

      if (Object.keys(results).length > 0) {
        const hasFailedValidation = Object.values(results).some(result => result.status === 'failed');
        if (hasFailedValidation) {
          return 'failed';
        }

        const validationTypes = ['variables', 'variableTypes', 'responseStatus', 'testTakers', 'groupResponses'];
        const hasAllValidations = validationTypes.every(type => results[type]);
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
    this.backendService.getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe({
        next: booklets => {
          this.selectedBooklet = row.group;
          this.booklets = this.filterUniqueBooklets(booklets);
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

  filterUniqueBooklets(booklets: Booklet[]): Booklet[] {
    const uniqueBookletsMap = new Map<string, Booklet>();

    booklets.forEach(booklet => {
      if (!uniqueBookletsMap.has(booklet.name)) {
        uniqueBookletsMap.set(booklet.name, booklet);
      }
    });

    return Array.from(uniqueBookletsMap.values());
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

    this.backendService.getNotesForMultipleUnits(
      this.appService.selectedWorkspaceId,
      unitIds
    ).subscribe({
      next: notesByUnitId => {
        Object.entries(notesByUnitId).forEach(([unitId, notes]) => {
          this.unitNotesMap.set(Number(unitId), notes);
        });
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Laden der Notizen',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  replayBooklet(booklet: Booklet) {
    if (!booklet || !booklet.name) {
      this.snackBar.open(
        'Ungültiges Testheft',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Testheft...',
      '',
      { duration: 3000 }
    );

    this.bookletReplayService.getBookletFromFileUpload(
      this.appService.selectedWorkspaceId,
      booklet.name
    ).subscribe({
      next: bookletReplay => {
        loadingSnackBar.dismiss();

        if (!bookletReplay || !bookletReplay.units || bookletReplay.units.length === 0) {
          this.snackBar.open(
            'Keine Units im Testheft vorhanden',
            'Info',
            { duration: 3000 }
          );
          return;
        }
        const serializedBooklet = this.serializeBookletData(bookletReplay);
        const firstUnit = bookletReplay.units[0];

        this.appService
          .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
          .subscribe(token => {
            const queryParams = {
              auth: token,
              mode: 'booklet',
              bookletData: serializedBooklet
            };

            const url = this.router
              .serializeUrl(
                this.router.createUrlTree(
                  [`replay/${this.testPerson.login}@${this.testPerson.code}@${booklet.name}/${firstUnit.name}/0/0`],
                  { queryParams: queryParams })
              );

            window.open(`#/${url}`, '_blank');
          });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden des Testhefts',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  replayUnit() {
    this.appService
      .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
      .subscribe(token => {
        const queryParams = {
          auth: token
        };
        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${this.testPerson.login}@${this.testPerson.code}@${this.selectedBooklet}/${this.selectedUnit?.alias}/0/0`],
              { queryParams: queryParams })
          );
        window.open(`#/${url}`, '_blank');
      });
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.isSearching = true;
    this.searchSubject.next(filterValue);
  }

  openBookletLogsDialog(booklet: Booklet) {
    if (!booklet.logs || booklet.logs.length === 0) {
      this.snackBar.open(
        'Keine Logs für dieses Testheft vorhanden',
        'Info',
        { duration: 3000 }
      );
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
      this.snackBar.open(
        'Keine Logs für diese Unit vorhanden',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    this.dialog.open(UnitLogsDialogComponent, {
      width: '700px',
      data: {
        logs: this.logs,
        title: `Logs für Unit: ${this.selectedUnit.alias || 'Unbenannte Einheit'}`
      }
    });
  }

  openTagsDialog() {
    if (!this.selectedUnit || !this.selectedUnit.id) {
      this.snackBar.open(
        'Keine Unit ausgewählt',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(TagDialogComponent, {
      width: '500px',
      data: {
        unitId: this.selectedUnit.id as number,
        tags: this.unitTags,
        title: `Tags für Unit: ${this.selectedUnit.alias || 'Unbenannte Einheit'}`
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
      this.snackBar.open(
        'Keine Unit ausgewählt',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(NoteDialogComponent, {
      width: '600px',
      data: {
        unitId: this.selectedUnit.id as number,
        notes: this.unitNotes,
        title: `Notizen für Unit: ${this.selectedUnit.alias || 'Unbenannte Einheit'}`
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
      expanded: false
    }));
    const getUniqueKey = (r: Response) => `${r.variableid}|${r.unitid}|${r.value}`;

    const uniqueMap = new Map<string, Response>();
    mappedResponses.forEach(response => {
      const key = getUniqueKey(response);
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, response);
      }
    });
    this.responses = Array.from(uniqueMap.values());
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
      this.unitTags = this.unitTagsMap.get(this.selectedUnit.id as number) || [];
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
        this.backendService.getUnitNotes(
          this.appService.selectedWorkspaceId,
          unitId
        ).subscribe({
          next: notes => {
            this.unitNotes = notes;
            this.unitNotesMap.set(unitId, notes);
          },
          error: () => {
            this.snackBar.open(
              'Fehler beim Laden der Notizen',
              'Fehler',
              { duration: 3000 }
            );
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
    if (!booklet.logs || !Array.isArray(booklet.logs) || booklet.logs.length === 0) {
      return null;
    }

    const pollingLog = booklet.logs.find((log: BookletLog) => log.key === 'CONTROLLER' && log.parameter === 'RUNNING');
    const terminatedLog = booklet.logs.find((log: BookletLog) => log.key === 'CONTROLLER' && log.parameter === 'TERMINATED');
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
    if (!booklet.logs || !Array.isArray(booklet.logs) || booklet.logs.length === 0) {
      return true;
    }

    if (!booklet.units || !Array.isArray(booklet.units) || booklet.units.length === 0) {
      return false;
    }
    const unitIdLogs = booklet.logs.filter((log: BookletLog) => log.key === 'CURRENT_UNIT_ID');
    const unitAliases = booklet.units
      .map((unit: Unit) => unit.alias)
      .filter((alias: string | null) => alias !== null) as string[];

    const allUnitsVisited = unitAliases.every(
      (alias: string) => unitIdLogs.some((log: BookletLog) => log.parameter === alias)
    );

    return allUnitsVisited && unitAliases.length > 0;
  }

  hasShortProcessingTime(booklet: Booklet): boolean {
    if (!booklet.logs || !Array.isArray(booklet.logs) || booklet.logs.length === 0) {
      return false;
    }

    const processingTime = this.calculateBookletProcessingTime(booklet);
    return processingTime === null || processingTime < this.SHORT_PROCESSING_TIME_THRESHOLD_MS;
  }

  hasGeogebraResponse(unit: Unit): boolean {
    if (!unit || !unit.results || !Array.isArray(unit.results)) {
      return false;
    }

    return unit.results.some((response: UnitResult) => response.value && response.value.startsWith('UEsD'));
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
    const searchInput = document.querySelector('.search-input') as HTMLInputElement;
    return searchInput ? searchInput.value : '';
  }

  clearSearch(): void {
    const searchInput = document.querySelector('.search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.value = '';
      this.createTestResultsList(0, this.pageSize);
    }
  }

  onPaginatorChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.createTestResultsList(this.pageIndex, this.pageSize, this.getCurrentSearchText());
  }

  createTestResultsList(page: number = 0, limit: number = 50, searchText: string = ''): void {
    const validPage = Math.max(0, page);
    this.isLoading = !this.isSearching;
    this.backendService.getTestResults(this.appService.selectedWorkspaceId, validPage, limit, searchText)
      .subscribe(response => {
        this.isLoading = false;
        this.isSearching = false;
        const { data, total } = response;
        this.updateTable(data, total);
      });
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

  testCenterImport(): void {
    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '800px',
      minHeight: '800px',
      data: {
        importType: 'testResults'
      }
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (result instanceof UntypedFormGroup || result) {
        this.createTestResultsList(this.pageIndex, this.pageSize, this.getCurrentSearchText());
      }
    });
  }

  onFileSelected(targetElement: EventTarget | null, resultType:'logs' | 'responses') {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          width: '400px',
          data: <ConfirmDialogData>{
            title: resultType === 'logs' ? 'Logs überschreiben' : 'Antworten überschreiben',
            content: resultType === 'logs' ?
              'Möchten Sie vorhandene Logs überschreiben, falls diese bereits existieren?' :
              'Möchten Sie vorhandene Antworten überschreiben, falls diese bereits existieren?',
            confirmButtonLabel: 'Überschreiben',
            showCancel: true
          }
        });

        dialogRef.afterClosed().subscribe(overwriteExisting => {
          if (overwriteExisting !== undefined) {
            this.isLoading = true;
            this.isUploadingResults = true;
            this.backendService.uploadTestResults(
              this.appService.selectedWorkspaceId,
              inputElement.files,
              resultType,
              overwriteExisting
            ).subscribe(() => {
              setTimeout(() => {
                this.createTestResultsList(this.pageIndex, this.pageSize, this.getCurrentSearchText());
              }, 1000);
              this.isLoading = false;
              this.isUploadingResults = false;
            });
          }
        });
      }
    }
  }

  deleteSelectedPersons(): void {
    this.isLoading = true;
    const selectedTestPersons = this.selection.selected;
    this.backendService.deleteTestPersons(
      this.appService.selectedWorkspaceId,
      selectedTestPersons.map(person => person.id)
    ).subscribe(respOk => {
      if (respOk) {
        this.snackBar.open(
          this.translateService.instant('ws-admin.test-group-deleted'),
          '',
          { duration: 1000 }
        );
        this.createTestResultsList(this.pageIndex, this.pageSize, this.getCurrentSearchText());
      } else {
        this.snackBar.open(
          this.translateService.instant('ws-admin.test-group-not-deleted'),
          this.translateService.instant('error'),
          { duration: 1000 }
        );
      }
      this.isLoading = false;
      this.selection.clear();
    });
  }

  codeSelectedPersons(): void {
    this.isLoading = true;
    const selectedTestPersons = this.selection.selected;
    const loadingSnackBar = this.snackBar.open(
      'Starte Kodierung...',
      '',
      { duration: 3000 }
    );

    this.backendService.codeTestPersons(
      this.appService.selectedWorkspaceId,
      selectedTestPersons.map(person => person.id)
    ).subscribe({
      next: result => {
        loadingSnackBar.dismiss();
        this.isLoading = false;
        this.selection.clear();

        if (result.jobId) {
          this.snackBar.open(
            `Kodierung gestartet (Job ID: ${result.jobId}). Sie werden benachrichtigt, wenn die Kodierung abgeschlossen ist.`,
            'OK',
            { duration: 5000 }
          );

          this.pollCodingJobStatus(result.jobId);
        } else if (result.totalResponses > 0) {
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-coded'),
            '',
            { duration: 1000 }
          );
          this.createTestResultsList(this.pageIndex, this.pageSize, this.getCurrentSearchText());
        } else {
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-not-coded'),
            this.translateService.instant('error'),
            { duration: 1000 }
          );
        }
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.isLoading = false;
        this.selection.clear();

        this.snackBar.open(
          'Fehler beim Starten der Kodierung',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  private pollCodingJobStatus(jobId: string): void {
    const pollingInterval = 5000;
    const timer = setInterval(() => {
      this.backendService.getCodingJobStatus(
        this.appService.selectedWorkspaceId,
        jobId
      ).subscribe({
        next: job => {
          if (job.status === 'completed') {
            clearInterval(timer);

            const snackBarRef = this.snackBar.open(
              'Kodierung abgeschlossen',
              'Ergebnisse anzeigen',
              { duration: 10000 }
            );

            snackBarRef.onAction().subscribe(() => {
              this.showCodingResults(job.result);
              this.createTestResultsList(this.pageIndex, this.pageSize, this.getCurrentSearchText());
            });
          } else if (job.status === 'failed') {
            clearInterval(timer);

            this.snackBar.open(
              `Fehler bei der Kodierung: ${job.error || 'Unbekannter Fehler'}`,
              'Fehler',
              { duration: 5000 }
            );
          }
        },
        error: () => {
          clearInterval(timer);

          this.snackBar.open(
            'Fehler beim Abrufen des Kodierungs-Status',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
    }, pollingInterval);
  }

  private showCodingResults(result?: { totalResponses: number; statusCounts: { [key: string]: number } }): void {
    if (!result) {
      this.snackBar.open(
        'Keine Kodierungsergebnisse verfügbar',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const statusMessages = Object.entries(result.statusCounts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');

    this.snackBar.open(
      `Kodierung abgeschlossen: ${result.totalResponses} Antworten verarbeitet (${statusMessages})`,
      'OK',
      { duration: 5000 }
    );
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
        content: `Möchten Sie die Unit "${unit.alias || 'Unbenannte Einheit'}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.backendService.deleteUnit(
          this.appService.selectedWorkspaceId,
          unit.id as number
        ).subscribe({
          next: result => {
            if (result.success) {
              const unitIndex = booklet.units.findIndex(u => u.id === unit.id);
              if (unitIndex !== -1) {
                booklet.units.splice(unitIndex, 1);
              }

              if (this.selectedUnit && this.selectedUnit.id === unit.id) {
                this.selectedUnit = undefined;
                this.responses = [];
                this.logs = [];
              }

              this.snackBar.open(
                `Unit "${unit.alias || 'Unbenannte Einheit'}" wurde erfolgreich gelöscht.`,
                'Erfolg',
                { duration: 3000 }
              );
            } else {
              this.snackBar.open(
                `Fehler beim Löschen der Unit: ${result.report.warnings.join(', ')}`,
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
        this.backendService.deleteResponse(
          this.appService.selectedWorkspaceId,
          response.id as number
        ).subscribe({
          next: result => {
            if (result.success) {
              const responseIndex = this.responses.findIndex(r => r.id === response.id);
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
                `Fehler beim Löschen der Antwort: ${result.report.warnings.join(', ')}`,
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
      width: '1000px',
      maxHeight: '90vh',
      autoFocus: false
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

  private serializeBookletData(booklet: BookletReplay): string {
    try {
      const jsonString = JSON.stringify(booklet);

      return btoa(jsonString);
    } catch (error) {
      return '';
    }
  }

  openVariableAnalysisDialog(): void {
    const loadingSnackBar = this.snackBar.open(
      'Lade Analyse-Aufträge...',
      '',
      { duration: 3000 }
    );

    this.backendService.getAllVariableAnalysisJobs(
      this.appService.selectedWorkspaceId
    ).subscribe({
      next: jobs => {
        loadingSnackBar.dismiss();

        const variableAnalysisJobs = jobs.filter(job => job.type === 'variable-analysis');

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

  openBookletInfoDialog(booklet: Booklet): void {
    const loadingSnackBar = this.snackBar.open(
      'Lade Booklet-Informationen...',
      '',
      { duration: 3000 }
    );

    this.backendService.getBookletInfo(
      this.appService.selectedWorkspaceId,
      booklet.name
    ).subscribe({
      next: (bookletInfo: BookletInfoDto) => {
        loadingSnackBar.dismiss();

        this.dialog.open(BookletInfoDialogComponent, {
          width: '800px',
          data: {
            bookletInfo,
            bookletId: booklet.name
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

  openUnitInfoDialog(): void {
    if (!this.selectedUnit || !this.selectedUnit.name) {
      this.snackBar.open(
        'Keine Unit ausgewählt',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Unit-Informationen...',
      '',
      { duration: 3000 }
    );

    this.backendService.getUnitInfo(
      this.appService.selectedWorkspaceId,
      this.selectedUnit.name
    ).subscribe({
      next: (unitInfo: UnitInfoDto) => {
        loadingSnackBar.dismiss();

        this.dialog.open(UnitInfoDialogComponent, {
          width: '800px',
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
}
