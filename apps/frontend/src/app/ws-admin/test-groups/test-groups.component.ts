import {
  MatTable,
  MatColumnDef,
  MatHeaderCellDef,
  MatHeaderCell,
  MatCellDef,
  MatCell,
  MatHeaderRowDef,
  MatHeaderRow,
  MatRowDef,
  MatRow,
  MatTableDataSource
} from '@angular/material/table';
import {
  ViewChild, Component, OnInit, Output, EventEmitter
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe, JsonPipe } from '@angular/common';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { WrappedIconComponent } from '../../shared/wrapped-icon/wrapped-icon.component';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';
import { HasSelectionValuePipe } from '../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../shared/pipes/isSelected.pipe';
import { FileSizePipe } from '../../shared/pipes/filesize.pipe';
import { TestGroupsInListDto } from '../../../../api-dto/test-groups/testgroups-in-list.dto';

@Component({
  selector: 'coding-box-test-groups',
  templateUrl: './test-groups.component.html',
  styleUrls: ['./test-groups.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, SearchFilterComponent, JsonPipe, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe, MatProgressSpinner, DatePipe, FileSizePipe, MatAnchor, MatIcon]
})
export class TestGroupsComponent implements OnInit {
  testPersonsObjectsDatasource = new MatTableDataSource<any>();
  displayedColumns = ['selectCheckbox', 'test_group', 'created_at'];
  tableSelectionRow = new SelectionModel<TestGroupsInListDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  testGroups = [];
  dataSource!: MatTableDataSource<any>;
  isLoading = false;

  @ViewChild(MatSort) sort = new MatSort();
  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (this.dataSource) {
      this.dataSource.sort = sort;
    }
  }

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  ngOnInit(): void {
    this.appService.dataLoading = false;
    this.isLoading = true;
    this.backendService.getTestPersons(1, '').subscribe(testGroups => {
      this.dataSource = new MatTableDataSource(testGroups);
      this.isLoading = false;
    });
    //this.updateTestGroupsList();
  }

  private setObjectsDatasource(testGroups: any[]): void {
    this.testPersonsObjectsDatasource = new MatTableDataSource(testGroups);
    this.testPersonsObjectsDatasource
      .filterPredicate = (userList: any, filter) => [
        'name'
      ].some(column => (userList[column as keyof TestGroupsInListDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.testPersonsObjectsDatasource.sort = this.sort;
  }

  updateTestGroupsList(): void {
    this.setObjectsDatasource(this.testGroups);
    this.tableSelectionCheckboxes.clear();
    this.tableSelectionRow.clear();
    this.appService.dataLoading = false;
  }

  deleteTestGroups(): void {
    this.isLoading = true;
    const selectedTestGroups = this.tableSelectionCheckboxes.selected;
    this.backendService.deleteTestGroups(selectedTestGroups.map(testGroup => testGroup.test_group)).subscribe(respOk => {
      if (respOk) {
        this.snackBar.open(
          this.translateService.instant('ws-admin.test-group-deleted'),
          '',
          { duration: 1000 });
        this.isLoading = false;
        this.createTestGroupsList();
      } else {
        this.snackBar.open(
          this.translateService.instant('ws-admin.test-group-not-deleted'),
          this.translateService.instant('error'),
          { duration: 1000 });
        this.isLoading = false;
      }
    });
  }

  createCodingTestGroups():void {
    this.isLoading = true;
    const selectedTestGroups = this.tableSelectionCheckboxes.selected;
    this.backendService.createCodingTestGroups(selectedTestGroups).subscribe(() => {
    });
  }

  masterToggle(): void {
    this.isAllSelected() || !this.dataSource ?
      this.tableSelectionCheckboxes.clear() :
      this.dataSource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.dataSource ? this.dataSource.data.length : 0;
    return numSelected === numRows;
  }

  createTestGroupsList(): void {
    this.isLoading = true;
    this.backendService.getTestPersons(1, '').subscribe(testGroups => {
      this.dataSource = new MatTableDataSource(testGroups);
      this.isLoading = false;
    });
  }
}
