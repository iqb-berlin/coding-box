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
import { ViewChild, Component, OnInit, Output, EventEmitter } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { JsonPipe } from '@angular/common';
import { UsersMenuComponent } from '../users-menu/users-menu.component';
import { UserFullDto } from '../../../../../../api-dto/user/user-full-dto';
import { BackendService } from '../../../../services/backend.service';
import { AppService } from '../../../../services/app.service';
import { AuthService } from '../../../../auth/service/auth.service';
import { CreateUserDto } from '../../../../../../api-dto/user/create-user-dto';
import { WrappedIconComponent } from '../../../wrapped-icon/wrapped-icon.component';
import { HasSelectionValuePipe } from '../../pipes/hasSelectionValue.pipe';
import { IsSelectedPipe } from '../../pipes/isSelected.pipe';
import { IsAllSelectedPipe } from '../../pipes/isAllSelected.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { WorkspaceInListDto } from '../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspacesComponent } from '../workspaces/workspaces.component';
import { IsSelectedIdPipe } from '../../pipes/isSelectedId.pipe';
import { WorkspacesSelectionComponent } from '../workspaces-selection/workspaces-selection.component';
import { emit } from '@angular-devkit/build-angular/src/tools/esbuild/angular/compilation/parallel-worker';

@Component({
  selector: 'coding-box-users-selection',
  templateUrl: './users-selection.component.html',
  styleUrls: ['./users-selection.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, FormsModule, TranslateModule, UsersMenuComponent, HasSelectionValuePipe, IsSelectedPipe, IsAllSelectedPipe, SearchFilterComponent, JsonPipe, WorkspacesComponent, IsSelectedIdPipe, WorkspacesSelectionComponent]
})
export class UsersSelectionComponent implements OnInit {
  selectedUsers : number[]= [];
  userObjectsDatasource = new MatTableDataSource<UserFullDto>();
  displayedUserColumns = ['selectCheckbox', 'name', 'displayName'];
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  userWorkspaces :WorkspaceInListDto[] = [];
  filteredUserWorkspaces: WorkspaceInListDto[] = [];

  @ViewChild(MatSort) sort = new MatSort();
  @Output() userSelectionChanged: EventEmitter< UserFullDto[]> = new EventEmitter< UserFullDto[]>();


    constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.createWorkspaceList();
      this.updateUserList();
    });
  }

  private setObjectsDatasource(users: UserFullDto[]): void {
    this.userObjectsDatasource = new MatTableDataSource(users);
    this.userObjectsDatasource
      .filterPredicate = (userList: UserFullDto, filter) => [
        'name', 'firstName', 'lastName'
      ].some(column => (userList[column as keyof UserFullDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.userObjectsDatasource.sort = this.sort;
  }

  updateUserList(): void {
    this.appService.dataLoading = true;
    this.backendService.getUsersFull().subscribe(
      (users: UserFullDto[]) => {
        if (users.length > 0) {
          this.setObjectsDatasource(users);
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
          this.appService.dataLoading = false;
        } else {
          this.tableSelectionCheckboxes.clear();
          this.tableSelectionRow.clear();
          this.appService.dataLoading = false;
        }
      }
    );
  }

  createWorkspaceList(): void {
    this.backendService.getAllWorkspacesList().subscribe(workspaces => {
      if (workspaces.length > 0) { this.userWorkspaces = workspaces; }
      console.log('Workspaces: ', this.userWorkspaces);
    });
  }

  checkboxToggle(row: UserFullDto): void {
    this.tableSelectionCheckboxes.toggle(row);
    console.log('Checkbox toggled: ', row);
    this.updateUserWorkspacesList(row.id);
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  updateUserWorkspacesList(userId: number): void {
    if (this.tableSelectionCheckboxes.selected.length === 1) {
      this.backendService.getWorkspacesByUserList(userId).subscribe(workspaces => {
        console.log(workspaces, 'workspaces')
        this.filteredUserWorkspaces = this.userWorkspaces.filter(workspace => {
          return workspaces.includes(workspace.id);
        });
      });
      console.log(this.userWorkspaces);
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
      this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected)
  }
}
