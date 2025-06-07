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
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';

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
    MatDivider]
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
    this.backendService.getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe(booklets => {
        this.booklets = booklets;
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
        sessions: booklet.sessions
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
    this.logs = unit.logs;
    // this.logs = this.createUnitHistory(unit);
    this.selectedUnit = unit;
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
