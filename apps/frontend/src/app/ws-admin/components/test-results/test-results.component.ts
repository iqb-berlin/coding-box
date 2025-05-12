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
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { SelectionModel } from '@angular/cdk/collections';
import { MatLabel } from '@angular/material/form-field';
import {
  MatAccordion,
  MatExpansionPanel, MatExpansionPanelHeader,
  MatExpansionPanelTitle
} from '@angular/material/expansion';
import { MatList, MatListItem } from '@angular/material/list';
import { MatTooltip } from '@angular/material/tooltip';
import { MatInput } from '@angular/material/input';
import { CommonModule, DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { Router } from '@angular/router';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { TestGroupsInListDto } from '../../../../../../../api-dto/test-groups/testgroups-in-list.dto';

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
  // eslint-disable-next-line max-len
  imports: [CommonModule, FormsModule, MatExpansionPanelHeader, MatLabel, MatPaginatorModule, TranslateModule, MatTable, MatCellDef, MatHeaderCellDef, MatHeaderRowDef, MatRowDef, MatCell, MatColumnDef, MatHeaderCell, MatHeaderRow, MatRow, MatSort, MatSortHeader, MatAccordion, MatExpansionPanel, MatExpansionPanelTitle, MatList, MatListItem, MatTooltip, MatInput, MatIcon, MatProgressSpinner]
})
export class TestResultsComponent implements OnInit {
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  dataSource !: MatTableDataSource<P>;
  displayedColumns: string[] = ['code', 'group', 'login', 'uploaded_at'];
  data: any = [];
  booklets: any = [];
  results: any = [];
  responses: any = [];
  logs: any = [];
  totalRecords: number = 0;
  pageSize: number = 10;
  pageIndex: number = 0;
  selectedUnit: any;
  testPerson: any;
  selectedBooklet:any;
  isLoading: boolean = true;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private router: Router
  ) {
  }

  ngOnInit(): void {
    this.createTestResultsList();
  }

  onRowClick(row: P): void {
    this.testPerson = row;
    this.backendService.getPersonTestResults(this.appService.selectedWorkspaceId, row.id)
      .subscribe(response => {
        this.booklets = [response[0].booklet];
      });
  }

  replayBooklet(booklet:any) {
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
              [`replay/${this.testPerson.group}@${this.testPerson.code}@${this.selectedBooklet?.id}/${this.selectedUnit?.alias}/1`],
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

  onUnitClick(unit: any): void {
    this.responses = unit.results;
    // this.logs = this.createUnitHistory(unit);
    this.selectedUnit = unit;
  }

  setSelectedBooklet(booklet:any) {
    this.selectedBooklet = booklet;
  }

  // eslint-disable-next-line class-methods-use-this
  groupByPlayerLoading = (array: any[]) => {
    const grouped = [];
    let currentBlock: any[] = [];
    for (const item of array) {
      if (item.key === 'PLAYER' && item.parameter === 'LOADING') {
        if (currentBlock.length > 0) {
          grouped.push(currentBlock);
        }
        currentBlock = [];
      }
      currentBlock.push(item);
    }
    if (currentBlock.length > 0) {
      grouped.push(currentBlock);
    }

    return grouped;
  };

  createUnitHistory(unit: { logs: any[]; }): any {
    return this.groupByPlayerLoading(unit.logs);
  }

  // eslint-disable-next-line class-methods-use-this
  formatTimestamp(timestamp: string): string {
    const date = new Date(Number(timestamp));
    return date.toLocaleString();
  }

  // eslint-disable-next-line class-methods-use-this
  getColor(status: string): string {
    switch (status) {
      case 'VALUE_CHANGED':
        return 'green';
      case 'NOT_REACHED':
        return 'blue';
      default:
        return 'lightgrey';
    }
  }

  onPaginatorChange(event: PageEvent): void {
    // Update the number of items displayed per page
    this.pageSize = event.pageSize;

    // Update the current page index
    this.pageIndex = event.pageIndex;

    // Reload the test results list based on the new page index and size
    this.createTestResultsList(this.pageIndex, this.pageSize);
  }

  createTestResultsList(page: number = 0, limit: number = 20): void {
    const validPage = Math.max(0, page);
    this.backendService.getTestResults(this.appService.selectedWorkspaceId, validPage, limit)
      .subscribe(response => {
        this.isLoading = false;
        const { data, total } = response;
        this.updateTable(data, total);
      });
  }

  private updateTable(data: any[], total: number): void {
    this.data = data;
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
}
