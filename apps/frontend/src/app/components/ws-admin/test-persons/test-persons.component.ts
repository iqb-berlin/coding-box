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
import { FormsModule,  } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { JsonPipe } from '@angular/common';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { UserFullDto } from '../../../../../api-dto/user/user-full-dto';
import { WorkspaceInListDto } from '../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WrappedIconComponent } from '../../wrapped-icon/wrapped-icon.component';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';

@Component({
  selector: 'coding-box-test-persons',
  templateUrl: './test-persons.component.html',
  styleUrls: ['./test-persons.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, SearchFilterComponent, JsonPipe]
})
export class TestPersonsComponent implements OnInit {
  selectedPersons : number[] = [];
  testPersonsObjectsDatasource = new MatTableDataSource<any>();
  displayedTestPersonsColumns = ['name'];
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  testPersons = [];

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
    this.backendService.getTestPersons(1,'').subscribe(testPersons => {
      if (testPersons.length > 0) { this.testPersons = testPersons; }
      console.log('testPersons', testPersons);
    });
  }
}
