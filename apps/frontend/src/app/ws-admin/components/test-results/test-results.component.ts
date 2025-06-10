import {
  MatTable,
  MatHeaderCellDef,
  MatCellDef,
  MatHeaderRowDef,
  MatRowDef,
  MatTableDataSource, MatCell, MatColumnDef, MatHeaderCell, MatHeaderRow, MatRow
} from '@angular/material/table';
import { Component, OnInit, ViewChild } from '@angular/core';
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
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatTooltip } from '@angular/material/tooltip';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';
import { CreateUnitTagDto } from '../../../../../../../api-dto/unit-tags/create-unit-tag.dto';
import { UpdateUnitTagDto } from '../../../../../../../api-dto/unit-tags/update-unit-tag.dto';

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
    MatFormField,
    MatLabel,
    MatTooltip]
})
export class TestResultsComponent implements OnInit {
  selection = new SelectionModel<P>(true, []);
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  dataSource !: MatTableDataSource<P>;
  displayedColumns: string[] = ['select', 'code', 'group', 'login', 'uploaded_at'];
  data: P[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  booklets: { id: number; title: string, name:string, units:any }[] = [];
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
  selectedBooklet: { id: number; title: string; name: string; units: unknown } | undefined;
  isLoading: boolean = true;
  isUploadingResults: boolean = false;
  unitTags: UnitTagDto[] = [];
  newTagText: string = '';
  // Map to store tags for each unit
  unitTagsMap: Map<number, UnitTagDto[]> = new Map();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private dialog: MatDialog,
    private backendService: BackendService,
    private appService: AppService,
    private router: Router,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
    this.selectedBooklet = undefined;
  }

  ngOnInit(): void {
    this.createTestResultsList();
  }

  onRowClick(row: P): void {
    this.testPerson = row;
    this.responses = [];
    this.logs = [];
    this.bookletLogs = [];
    this.selectedUnit = undefined;
    this.selectedBooklet = undefined;
    this.unitTagsMap.clear(); // Clear the unit tags map
    this.backendService.getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe(booklets => {
        this.booklets = booklets;
        this.sortBookletUnits(); // Sort units alphabetically
        this.loadAllUnitTags(); // Load tags for all units
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

  replayBooklet(booklet: { id: number; title: string; name: string; units: unknown }) {
    this.selectedBooklet = booklet;
  }

  replayUnit() {
    this.backendService
      .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
      .subscribe(token => {
        const queryParams = {
          auth: token
        };
          // const page = this.replayComponent.responses?.unit_state?.CURRENT_PAGE_ID;

        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${this.testPerson.group}@${this.testPerson.code}@${this.selectedBooklet?.id}/${this.selectedUnit?.alias}/0`],
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

  /**
   * Opens a dialog to display unit logs
   */
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUnitClick(unit: any): void {
    // Initialize responses with expanded property set to false
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.responses = unit.results.map((response: any) => ({
      ...response,
      expanded: false
    }));

    // Sort responses: first by status (VALUE_CHANGED first), then alphabetically by variableid
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

    // Load tags for the selected unit
    this.loadUnitTags();
  }

  /**
   * Load tags for the selected unit
   */
  loadUnitTags(): void {
    if (this.selectedUnit && this.selectedUnit['id']) {
      this.backendService.getUnitTags(
        this.appService.selectedWorkspaceId,
        this.selectedUnit['id'] as number
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

    if (this.selectedUnit && this.selectedUnit['id']) {
      this.addTagToUnit(this.selectedUnit['id'] as number, this.newTagText.trim());
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
        if (this.selectedUnit && this.selectedUnit['id'] === unitId) {
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
    if (this.selectedUnit && this.selectedUnit['id']) {
      this.deleteTagFromUnit(tagId, this.selectedUnit['id'] as number);
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
          if (this.selectedUnit && this.selectedUnit['id'] === unitId) {
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

  // Check if any response value for a unit starts with "UEsD"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hasGeogebraResponse(unit: any): boolean {
    if (!unit || !unit.results || !Array.isArray(unit.results)) {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return unit.results.some((response:any) => response.value && typeof response.value === 'string' && response.value.startsWith('UEsD'));
  }

  /**
   * Determines the appropriate text color (black or white) based on the background color
   * @param backgroundColor The background color in any valid CSS format (hex, rgb, etc.)
   * @returns Either 'black' or 'white' depending on the background brightness
   */
  getContrastColor(backgroundColor?: string): string {
    // If no color is provided, return black (for default light backgrounds)
    if (!backgroundColor) {
      return '#000000';
    }

    // Convert the color to RGB
    let r = 0;
    let g = 0;
    let b = 0;

    // Handle hex colors
    if (backgroundColor.startsWith('#')) {
      const hex = backgroundColor.slice(1);

      // Handle shorthand hex (#RGB)
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
      } else if (hex.length === 6) {
        // Handle full hex (#RRGGBB)
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
      } else {
        // Invalid hex, return black
        return '#000000';
      }
    } else if (backgroundColor.startsWith('rgb')) {
      // Handle rgb/rgba colors
      const rgbMatch = backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
      if (rgbMatch) {
        r = parseInt(rgbMatch[1], 10);
        g = parseInt(rgbMatch[2], 10);
        b = parseInt(rgbMatch[3], 10);
      } else {
        // Invalid rgb format, return black
        return '#000000';
      }
    } else {
      // Unsupported color format, return black
      return '#000000';
    }

    // Calculate brightness using the YIQ formula
    // This formula gives more weight to colors that the human eye is more sensitive to
    const brightness = (r * 299 + g * 587 + b * 114) / 1000;

    // Return white for dark backgrounds, black for light backgrounds
    return brightness >= 128 ? '#000000' : '#ffffff';
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
