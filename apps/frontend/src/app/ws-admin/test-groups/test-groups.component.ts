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
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { JsonPipe } from '@angular/common';
import { UserFullDto } from '../../../../api-dto/user/user-full-dto';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { WrappedIconComponent } from '../../shared/wrapped-icon/wrapped-icon.component';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';
import { HasSelectionValuePipe } from '../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../shared/pipes/isSelected.pipe';
import { FileSizePipe } from '../../shared/pipes/filesize.pipe';

@Component({
  selector: 'coding-box-test-persons',
  templateUrl: './test-persons.component.html',
  styleUrls: ['./test-persons.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, SearchFilterComponent, JsonPipe, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe]
})
export class TestPersonsComponent implements OnInit {
  testPersonsObjectsDatasource = new MatTableDataSource<any>();
  displayedColumns = ['name'];
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  testPersons = [];
  dataSource!: MatTableDataSource<any>;

  @ViewChild(MatSort) sort = new MatSort();
  @Output() userSelectionChanged: EventEmitter< UserFullDto[]> = new EventEmitter< UserFullDto[]>();

  constructor(
    private backendService: BackendService,
    private appService: AppService
  ) {
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.createTestPersonsList();
      this.updateTestPersonsList();
    });
  }

  private setObjectsDatasource(testPersons: any[]): void {
    this.testPersonsObjectsDatasource = new MatTableDataSource(testPersons);
    this.testPersonsObjectsDatasource
      .filterPredicate = (userList: any, filter) => [
        'name'
      ].some(column => (userList[column as keyof UserFullDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.testPersonsObjectsDatasource.sort = this.sort;
  }

  updateTestPersonsList(): void {
    this.setObjectsDatasource(this.testPersons);
    this.tableSelectionCheckboxes.clear();
    this.tableSelectionRow.clear();
    this.appService.dataLoading = false;
  }

  createTestPersonsList(): void {
    this.backendService.getTestPersons(1, '').subscribe(testGroups => {
      this.dataSource = new MatTableDataSource(testGroups.map((testGroup: any) => ({ name: testGroup })));
      if (testGroups.length > 0) { this.testPersons = testGroups; }
      console.log('testPersons', testGroups);
    });
  }
}
