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
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
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
import { UnitSearchDialogComponent } from '../unit-search-dialog/unit-search-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../../api-dto/unit-tags/update-unit-tag.dto';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import { ValidationDialogComponent } from '../validation-dialog/validation-dialog.component';
import { VariableValidationDto } from '../../../../../../../api-dto/files/variable-validation.dto';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';

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
  providers: [DatePipe],
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
    MatTooltipModule]
})
export class TestResultsComponent implements OnInit, OnDestroy {
  private dialog = inject(MatDialog);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
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
  unitTags: UnitTagDto[] = [];
  newTagText: string = '';
  unitTagsMap: Map<number, UnitTagDto[]> = new Map();
  unitNotes: UnitNoteDto[] = [];
  unitNotesMap: Map<number, UnitNoteDto[]> = new Map();
  isVariableValidationRunning: boolean = false;
  variableValidationResult: VariableValidationDto | null = null;
  readonly SHORT_PROCESSING_TIME_THRESHOLD_MS: number = 60000;

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
  }

  ngOnDestroy(): void {
    if (this.searchSubscription) {
      this.searchSubscription.unsubscribe();
      this.searchSubscription = null;
    }
  }

  onRowClick(row: P): void {
    this.testPerson = row;
    this.responses = [];
    this.logs = [];
    this.bookletLogs = [];
    this.selectedUnit = undefined;
    this.unitTagsMap.clear();
    this.backendService.getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe(booklets => {
        this.selectedBooklet = row.group;
        const uniqueBooklets = this.filterUniqueBooklets(booklets);
        this.booklets = uniqueBooklets;
        this.sortBooklets();
        this.sortBookletUnits();
        this.loadAllUnitTags();
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
        // Sort units by alias (or name if alias is not available)
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

  replayBooklet() {
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
        'Keine Logs für dieses Booklet vorhanden',
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

    const uniqueResponses = Array.from(uniqueMap.values());

    this.responses = uniqueResponses;
    this.selectedBooklet = booklet.name;

    this.responses.sort((a: Response, b: Response) => {
      // First prioritize VALUE_CHANGED status
      if (a.status === 'VALUE_CHANGED' && b.status !== 'VALUE_CHANGED') {
        return -1;
      }
      if (a.status !== 'VALUE_CHANGED' && b.status === 'VALUE_CHANGED') {
        return 1;
      }
      // Then sort alphabetically by variableid
      return a.variableid.localeCompare(b.variableid);
    });

    this.logs = unit.logs;
    // this.logs = this.createUnitHistory(unit);
    this.selectedUnit = unit;

    this.loadUnitTags();
    // this.loadUnitNotes();
  }

  loadUnitTags(): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      const tags = this.unitTagsMap.get(this.selectedUnit.id as number) || [];
      this.unitTags = tags;
    } else {
      this.unitTags = [];
    }
  }

  loadUnitNotes(): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      this.backendService.getUnitNotes(
        this.appService.selectedWorkspaceId,
        this.selectedUnit.id as number
      ).subscribe({
        next: notes => {
          this.unitNotes = notes;

          // Update the unitNotesMap
          // @ts-expect-error - Property 'id' may not exist on type '{ alias: string; }'
          this.unitNotesMap.set(this.selectedUnit.id as number, notes);
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Notizen',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
    } else {
      this.unitNotes = [];
    }
  }

  addUnitTag(): void {
    if (!this.newTagText.trim()) {
      this.snackBar.open(
        'Bitte geben Sie einen Tag-Text ein',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    if (this.selectedUnit && this.selectedUnit.id) {
      this.addTagToUnit(this.selectedUnit.id as number, this.newTagText.trim());
      this.newTagText = ''; // Clear the input field
    }
  }

  addTagToUnit(unitId: number, tagText: string): void {
    if (!tagText.trim()) {
      this.snackBar.open(
        'Bitte geben Sie einen Tag-Text ein',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    const createTagDto: CreateUnitTagDto = {
      unitId: unitId,
      tag: tagText.trim()
    };

    this.backendService.createUnitTag(
      this.appService.selectedWorkspaceId,
      createTagDto
    ).subscribe({
      next: tag => {
        // If this is the selected unit, update the unitTags array
        if (this.selectedUnit && this.selectedUnit.id === unitId) {
          this.unitTags.push(tag);
        }

        // Update the unitTagsMap
        const tags = this.unitTagsMap.get(unitId) || [];
        tags.push(tag);
        this.unitTagsMap.set(unitId, tags);

        this.snackBar.open(
          'Tag erfolgreich hinzugefügt',
          'Erfolg',
          { duration: 3000 }
        );
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Hinzufügen des Tags',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  updateUnitTag(tagId: number, newText: string): void {
    if (!newText.trim()) {
      this.snackBar.open(
        'Bitte geben Sie einen Tag-Text ein',
        'Fehler',
        { duration: 3000 }
      );
      return;
    }

    const updateTagDto: UpdateUnitTagDto = {
      tag: newText.trim()
    };

    this.backendService.updateUnitTag(
      this.appService.selectedWorkspaceId,
      tagId,
      updateTagDto
    ).subscribe({
      next: updatedTag => {
        const index = this.unitTags.findIndex(tag => tag.id === tagId);
        if (index !== -1) {
          this.unitTags[index] = updatedTag;
        }

        this.snackBar.open(
          'Tag erfolgreich aktualisiert',
          'Erfolg',
          { duration: 3000 }
        );
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Aktualisieren des Tags',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  deleteUnitTag(tagId: number): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      this.deleteTagFromUnit(tagId, this.selectedUnit.id as number);
    }
  }

  deleteTagFromUnit(tagId: number, unitId: number): void {
    this.backendService.deleteUnitTag(
      this.appService.selectedWorkspaceId,
      tagId
    ).subscribe({
      next: success => {
        if (success) {
          if (this.selectedUnit && this.selectedUnit.id === unitId) {
            this.unitTags = this.unitTags.filter(tag => tag.id !== tagId);
          }

          const tags = this.unitTagsMap.get(unitId) || [];
          this.unitTagsMap.set(unitId, tags.filter(tag => tag.id !== tagId));

          this.snackBar.open(
            'Tag erfolgreich gelöscht',
            'Erfolg',
            { duration: 3000 }
          );
        } else {
          this.snackBar.open(
            'Fehler beim Löschen des Tags',
            'Fehler',
            { duration: 3000 }
          );
        }
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Löschen des Tags',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  setSelectedBooklet(booklet: Booklet) {
    this.selectedBooklet = booklet.name;
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(Number(timestamp));
    return date.toLocaleString();
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

  formatDuration(durationMs: number | null): string {
    if (durationMs === null || durationMs < 0) return '00:00';
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.data = data as any;
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
              overwriteExisting // Pass the user's choice
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
    this.backendService.codeTestPersons(
      this.appService.selectedWorkspaceId,
      selectedTestPersons.map(person => person.id)
    ).subscribe(respOk => {
      if (respOk) {
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
      this.isLoading = false;
      this.selection.clear();
    });
  }

  /**
   * Opens a dialog to search for units by name across all test persons
   */
  openUnitSearchDialog(): void {
    this.dialog.open(UnitSearchDialogComponent, {
      width: '1200px',
      data: {
        title: 'Aufgaben suchen'
      }
    });
  }

  /**
   * Deletes a unit after confirmation
   * @param unit The unit to delete
   * @param booklet The booklet containing the unit
   */
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
              // Remove the unit from the booklet's units array
              const unitIndex = booklet.units.findIndex(u => u.id === unit.id);
              if (unitIndex !== -1) {
                booklet.units.splice(unitIndex, 1);
              }

              // If this was the selected unit, clear the selection
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

  /**
   * Deletes a response after confirmation
   * @param response The response to delete
   */
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
              // Remove the response from the responses array
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
      width: '800px'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result && result.variableValidationResult) {
        this.variableValidationResult = result.variableValidationResult;
        this.isVariableValidationRunning = false;
      }
    });
  }

  /**
   * Opens a dialog to analyze variable frequencies for the entire workspace
   */
  openVariableAnalysisDialog(): void {
    // Show loading indicator
    const loadingSnackBar = this.snackBar.open(
      'Starte Analyse...',
      '',
      { duration: 3000 }
    );

    // Create an asynchronous analysis job
    this.backendService.createVariableAnalysisJob(
      this.appService.selectedWorkspaceId,
      this.selectedUnit?.id // Optional unit ID, may be undefined
    ).subscribe({
      next: job => {
        loadingSnackBar.dismiss();

        // Show success message with job ID
        this.snackBar.open(
          `Analyse gestartet (Job ID: ${job.id}). Sie werden benachrichtigt, wenn die Analyse abgeschlossen ist.`,
          'OK',
          { duration: 5000 }
        );

        this.pollJobStatus(job.id);
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Starten der Analyse',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  /**
   * Poll for job status and show notification when complete
   * @param jobId The ID of the job to poll
   */
  private pollJobStatus(jobId: number): void {
    const pollingInterval = 5000;

    // Set up a timer to check job status
    const timer = setInterval(() => {
      this.backendService.getVariableAnalysisJob(
        this.appService.selectedWorkspaceId,
        jobId
      ).subscribe({
        next: job => {
          // Check if the job is completed or failed
          if (job.status === 'completed') {
            // Stop polling
            clearInterval(timer);

            // Show success notification
            const snackBarRef = this.snackBar.open(
              'Variablen-Analyse abgeschlossen',
              'Ergebnisse anzeigen',
              { duration: 10000 }
            );

            // Handle click on action button
            snackBarRef.onAction().subscribe(() => {
              this.showAnalysisResults(jobId);
            });
          } else if (job.status === 'failed') {
            // Stop polling
            clearInterval(timer);

            this.snackBar.open(
              `Fehler bei der Analyse: ${job.error || 'Unbekannter Fehler'}`,
              'Fehler',
              { duration: 5000 }
            );
          }
          // If status is 'pending' or 'processing', continue polling
        },
        error: () => {
          // Stop polling on error
          clearInterval(timer);

          this.snackBar.open(
            'Fehler beim Abrufen des Analyse-Status',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
    }, pollingInterval);
  }

  /**
   * Show analysis results for a completed job
   * @param jobId The ID of the completed job
   */
  private showAnalysisResults(jobId: number): void {
    const loadingSnackBar = this.snackBar.open(
      'Lade Analyse-Ergebnisse...',
      '',
      { duration: undefined }
    );

    this.backendService.getVariableAnalysisResults(
      this.appService.selectedWorkspaceId,
      jobId
    ).subscribe({
      next: results => {
        loadingSnackBar.dismiss();

        this.dialog.open(VariableAnalysisDialogComponent, {
          width: '800px',
          data: {
            unitId: this.selectedUnit?.id, // Optional unit ID, may be undefined
            title: `Item/Variablen Analyse für den gesamten Workspace (${results.variables.length} Variablen)`,
            analysisResults: results
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Analyse-Ergebnisse',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }
}
