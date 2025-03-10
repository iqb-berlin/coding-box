import {
  // eslint-disable-next-line max-len
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
  ViewChild, Component, OnInit, Output, EventEmitter, Input, SimpleChanges
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
// eslint-disable-next-line import/no-cycle
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { BackendService } from '../../../services/backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';

@Component({
  selector: 'coding-box-users-selection',
  templateUrl: './users-selection.component.html',
  styleUrls: ['./users-selection.component.scss'],
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, FormsModule, TranslateModule, HasSelectionValuePipe, IsSelectedPipe, IsAllSelectedPipe, SearchFilterComponent]
})
export class UsersSelectionComponent implements OnInit {
  userObjectsDatasource = new MatTableDataSource<UserFullDto>();
  displayedUserColumns = ['selectCheckbox', 'username', 'displayName'];
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  userWorkspaces :WorkspaceInListDto[] = [];
  filteredUserWorkspaces: WorkspaceInListDto[] = [];

  @ViewChild(MatSort) sort = new MatSort();
  @Output() userSelectionChanged: EventEmitter< UserFullDto[]> = new EventEmitter< UserFullDto[]>();

  constructor(
    private backendService: BackendService) {}

  @Input() selectedUserIds!: number[];

  ngOnChanges(changes: SimpleChanges) {
    if (changes) {
      this.setCheckboxes();
    }
  }

  ngOnInit(): void {
    this.createWorkspaceList();
    this.updateUserList();
  }

  private setObjectsDatasource(users: UserFullDto[]): void {
    this.userObjectsDatasource = new MatTableDataSource(users);
    this.userObjectsDatasource
      .filterPredicate = (userList: UserFullDto, filter) => [
        'username'
      ].some(column => (userList[column as keyof UserFullDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.userObjectsDatasource.sort = this.sort;
  }

  updateUserList(): void {
    this.backendService.getUsersFull().subscribe(
      (users: UserFullDto[]) => {
        if (users.length > 0) {
          this.setObjectsDatasource(users);
          this.setCheckboxes();
        } else {
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
        }
      }
    );
  }

  createWorkspaceList(): void {
    this.backendService.getAllWorkspacesList().subscribe(workspaces => {
      if (workspaces.length > 0) { this.userWorkspaces = workspaces; }
    });
  }

  setCheckboxes(): void {
    const foundUserIds:UserFullDto[] = [];
    this.selectedUserIds?.forEach(userId => {
      const foundUserId = this.userObjectsDatasource.data.find(user => user.id === userId);
      if (foundUserId) {
        foundUserIds.push(foundUserId);
      }
      if (foundUserIds) {
        this.tableSelectionCheckboxes.select(...foundUserIds);
      }
    });
  }

  checkboxToggle(row: UserFullDto): void {
    this.tableSelectionCheckboxes.toggle(row);
    this.updateUserWorkspacesList(row.id);
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  updateUserWorkspacesList(userId: number): void {
    if (this.tableSelectionCheckboxes.selected.length === 1) {
      this.backendService.getWorkspacesByUserList(userId).subscribe(workspaces => {
        this.filteredUserWorkspaces = this.userWorkspaces.filter(workspace => workspaces.includes(workspace.id));
      });
    }
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.userObjectsDatasource ? this.userObjectsDatasource.data.length : 0;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() || !this.userObjectsDatasource ?
      this.tableSelectionCheckboxes.clear() :
      this.userObjectsDatasource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }
}
