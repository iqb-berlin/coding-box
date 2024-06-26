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
  ViewChild, Component, OnInit
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
import { TestGroupsInListDto } from '../../../../../../api-dto/test-groups/testgroups-in-list.dto';

@Component({
  selector: 'coding-box-test-groups',
  templateUrl: './test-groups.component.html',
  styleUrls: ['./test-groups.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, SearchFilterComponent, JsonPipe, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe, MatProgressSpinner, DatePipe, FileSizePipe, MatAnchor, MatIcon]
})
export class TestGroupsComponent implements OnInit {
  testGroupsObjectsDatasource = new MatTableDataSource<TestGroupsInListDto>();
  displayedColumns = ['selectCheckbox', 'test_group', 'created_at'];
  tableSelectionRow = new SelectionModel<TestGroupsInListDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<TestGroupsInListDto>(true, []);
  testGroups :TestGroupsInListDto[] = [];
  dataSource!: MatTableDataSource<TestGroupsInListDto>;
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
    this.createTestGroupsList();
  }

  private setObjectsDatasource(testGroups: TestGroupsInListDto[]): void {
    this.testGroupsObjectsDatasource = new MatTableDataSource(testGroups);
    this.testGroupsObjectsDatasource
      .filterPredicate = (TestGroupsList: TestGroupsInListDto, filter) => [
        'name'
      ].some(column => (TestGroupsList[column as keyof TestGroupsInListDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.testGroupsObjectsDatasource.sort = this.sort;
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
    this.backendService.deleteTestGroups(
      this.appService.selectedWorkspaceId,
      selectedTestGroups.map(testGroup => testGroup.test_group))
      .subscribe(respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('ws-admin.test-group-deleted'),
            '',
            { duration: 1000 });
          this.isLoading = false;
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
    if (this.appService.workspaceData?.testGroups.length === 0) {
      this.backendService.getTestGroups(this.appService.selectedWorkspaceId)
        .subscribe(groups => {
          this.dataSource = new MatTableDataSource(groups || []);
          this.appService.workspaceData.testGroups = groups;
          this.isLoading = false;
        });
    } else {
      this.dataSource = new MatTableDataSource(this.appService.workspaceData.testGroups || []);
      this.isLoading = false;
    }
  }
}
