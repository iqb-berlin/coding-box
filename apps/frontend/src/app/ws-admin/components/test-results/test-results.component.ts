import {
  MatTable,
  MatHeaderCellDef,
  MatCellDef,
  MatHeaderRowDef,
  MatRowDef,
  MatTableDataSource, MatCell, MatColumnDef, MatHeaderCell, MatHeaderRow, MatRow
} from '@angular/material/table';
import {
  Component, OnInit, ViewChild, inject
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
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
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { TagDialogComponent } from '../tag-dialog/tag-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../../api-dto/unit-tags/update-unit-tag.dto';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';

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
export class TestResultsComponent implements OnInit {
  private dialog = inject(MatDialog);
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);

  selection = new SelectionModel<P>(true, []);
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  dataSource !: MatTableDataSource<P>;
  displayedColumns: string[] = ['select', 'code', 'group', 'login', 'uploaded_at'];
  data: P[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booklets: { id: number; title: string, name:string, units:any, logs?: any[], sessions?: any[] }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results: { [key: string]: any }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responses: any = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logs: any = [];
  bookletLogs: { [key: string]: unknown }[] = [];
  totalRecords: number = 0;
  pageSize: number = 50;
  pageIndex: number = 0;
  selectedUnit: { alias: string; [key: string]: unknown } | undefined;
  testPerson!: P;
  selectedBooklet: any;
  isLoading: boolean = true;
  isUploadingResults: boolean = false;
  unitTags: UnitTagDto[] = [];
  newTagText: string = '';
  unitTagsMap: Map<number, UnitTagDto[]> = new Map();
  unitNotes: UnitNoteDto[] = [];
  unitNotesMap: Map<number, UnitNoteDto[]> = new Map();
  readonly SHORT_PROCESSING_TIME_THRESHOLD_MS: number = 60000; // 1 minute in milliseconds

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.createTestResultsList();
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
        this.booklets = booklets;
        this.sortBookletUnits();
        this.loadAllUnitTags();
      });
  }

  /**
   * Sort units in each booklet alphabetically by alias
   */
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

  /**
   * Get tags for a specific unit
   * @param unitId The ID of the unit
   * @returns An array of tags for the unit, or an empty array if no tags are found
   */
  getUnitTags(unitId: number): UnitTagDto[] {
    return this.unitTagsMap.get(unitId) || [];
  }

  /**
   * Load tags for all units in all booklets
   */
  loadAllUnitTags(): void {
    if (!this.booklets || this.booklets.length === 0) {
      return;
    }

    // Collect all unit IDs
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

    unitIds.forEach(unitId => {
      this.backendService.getUnitTags(
        this.appService.selectedWorkspaceId,
        unitId
      ).subscribe({
        next: tags => {
          this.unitTagsMap.set(unitId, tags);
        }
      });
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
    this.dataSource.filter = filterValue.trim().toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openBookletLogsDialog(booklet: any) {
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

    this.dialog.open(LogDialogComponent, {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUnitClick(unit: any): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.responses = unit.results.map((response: any) => ({
      ...response,
      expanded: false
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.responses.sort((a: any, b: any) => {
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

  /**
   * Load tags for the selected unit
   */
  loadUnitTags(): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      this.backendService.getUnitTags(
        this.appService.selectedWorkspaceId,
        this.selectedUnit.id as number
      ).subscribe({
        next: tags => {
          this.unitTags = tags;

          // Update the unitTagsMap
          // @ts-expect-error - Property 'id' may not exist on type '{ alias: string; }'
          this.unitTagsMap.set(this.selectedUnit.id as number, tags);
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Tags',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
    } else {
      this.unitTags = [];
    }
  }

  /**
   * Load notes for the selected unit
   */
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

  /**
   * Add a new tag to the selected unit
   */
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

  /**
   * Add a new tag to a specific unit
   * @param unitId The ID of the unit
   * @param tagText The text for the new tag
   */
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

  /**
   * Update an existing tag
   * @param tagId The ID of the tag to update
   * @param newText The new text for the tag
   */
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
        // Update the tag in the array
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

  /**
   * Delete a tag from the selected unit
   * @param tagId The ID of the tag to delete
   */
  deleteUnitTag(tagId: number): void {
    if (this.selectedUnit && this.selectedUnit.id) {
      this.deleteTagFromUnit(tagId, this.selectedUnit.id as number);
    }
  }

  /**
   * Delete a tag from a specific unit
   * @param tagId The ID of the tag to delete
   * @param unitId The ID of the unit the tag belongs to
   */
  deleteTagFromUnit(tagId: number, unitId: number): void {
    this.backendService.deleteUnitTag(
      this.appService.selectedWorkspaceId,
      tagId
    ).subscribe({
      next: success => {
        if (success) {
          // If this is the selected unit, update the unitTags array
          if (this.selectedUnit && this.selectedUnit.id === unitId) {
            this.unitTags = this.unitTags.filter(tag => tag.id !== tagId);
          }

          // Update the unitTagsMap
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onBookletClick(booklet: any): void {
    this.bookletLogs = booklet.logs;
    // this.logs = this.createUnitHistory(unit);
    this.selectedUnit = booklet;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSelectedBooklet(booklet:any) {
    this.selectedBooklet = booklet;
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(Number(timestamp));
    return date.toLocaleString();
  }

  /**
   * Calculates the processing time for a booklet based on its logs
   * @param booklet The booklet to calculate processing time for
   * @returns The processing time in milliseconds, or null if it cannot be calculated
   */
  calculateBookletProcessingTime(booklet: any): number | null {
    if (!booklet.logs || !Array.isArray(booklet.logs) || booklet.logs.length === 0) {
      return null;
    }

    const pollingLog = booklet.logs.find((log: any) => log.key === 'CONTROLLER' && log.parameter === 'RUNNING');
    const terminatedLog = booklet.logs.find((log: any) => log.key === 'CONTROLLER' && log.parameter === 'TERMINATED');
    if (pollingLog && terminatedLog) {
      const pollingTime = Number(pollingLog.ts);
      const terminatedTime = Number(terminatedLog.ts);

      if (!Number.isNaN(pollingTime) && !Number.isNaN(terminatedTime)) {
        return terminatedTime - pollingTime;
      }
    }

    return null;
  }

  /**
   * Formats a duration in milliseconds to a readable format (minutes:seconds)
   * @param durationMs The duration in milliseconds
   * @returns A formatted string in the format MM:SS
   */
  formatDuration(durationMs: number | null): string {
    if (durationMs === null || durationMs < 0) return '00:00';

    // Convert to seconds
    const totalSeconds = Math.floor(durationMs / 1000);

    // Calculate minutes and remaining seconds
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    // Format as MM:SS
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  isBookletComplete(booklet: any): boolean {
    if (!booklet.logs || !Array.isArray(booklet.logs) || booklet.logs.length === 0) {
      return true;
    }

    if (!booklet.units || !Array.isArray(booklet.units) || booklet.units.length === 0) {
      return false;
    }
    const unitIdLogs = booklet.logs.filter((log: any) => log.key === 'CURRENT_UNIT_ID');
    const unitAliases = booklet.units
      .map((unit: any) => unit.alias)
      .filter((alias: string | null) => alias !== null) as string[];

    const allUnitsVisited = unitAliases.every(
      (alias: string) => unitIdLogs.some((log: any) => log.parameter === alias)
    );

    return allUnitsVisited && unitAliases.length > 0;
  }

  hasShortProcessingTime(booklet: any): boolean {
    if (!booklet.logs || !Array.isArray(booklet.logs) || booklet.logs.length === 0) {
      return false;
    }

    const processingTime = this.calculateBookletProcessingTime(booklet);
    return processingTime === null || processingTime < this.SHORT_PROCESSING_TIME_THRESHOLD_MS;
  }

  // Check if any response value for a unit starts with "UEsD"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hasGeogebraResponse(unit: any): boolean {
    if (!unit || !unit.results || !Array.isArray(unit.results)) {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return unit.results.some((response:any) => response.value && typeof response.value === 'string' && response.value.startsWith('UEsD'));
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

  onPaginatorChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    this.createTestResultsList(this.pageIndex, this.pageSize);
  }

  createTestResultsList(page: number = 0, limit: number = 50): void {
    const validPage = Math.max(0, page);
    this.backendService.getTestResults(this.appService.selectedWorkspaceId, validPage, limit)
      .subscribe(response => {
        this.isLoading = false;
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private updateTable(data: any[], total: number): void {
    this.data = data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mappedResults = data.map((result: any) => ({
      id: result.id,
      code: result.code,
      group: result.group,
      login: result.login,
      uploaded_at: result.uploaded_at
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
        this.createTestResultsList(this.pageIndex, this.pageSize);
      }
    });
  }

  onFileSelected(targetElement: EventTarget | null, resultType:'logs' | 'responses') {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.isLoading = true;
        this.isUploadingResults = true;
        this.backendService.uploadTestResults(
          this.appService.selectedWorkspaceId,
          inputElement.files,
          resultType
        ).subscribe(() => {
          setTimeout(() => {
            this.createTestResultsList(this.pageIndex, this.pageSize);
          }, 1000);
          this.isLoading = false;
          this.isUploadingResults = false;
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
        this.createTestResultsList(this.pageIndex, this.pageSize);
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
        this.createTestResultsList(this.pageIndex, this.pageSize);
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
}
