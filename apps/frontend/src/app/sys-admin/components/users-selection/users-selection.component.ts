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
  Component, OnInit, SimpleChanges, DestroyRef, inject, input, output, signal, viewChild, effect, untracked, ChangeDetectionStrategy, OnChanges
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { UserDirectoryStatusComponent } from '../../../shared/components/user-directory-status/user-directory-status.component';
import { UserDirectoryFacade } from '../../../shared/services/user/user-directory.facade';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { UserFullDto } from '../../../../../../../api-dto/user/user-full-dto';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { UserBackendService } from '../../../shared/services/user/user-backend.service';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [UserDirectoryFacade],
  selector: 'coding-box-users-selection',
  templateUrl: './users-selection.component.html',
  styleUrls: ['./users-selection.component.scss'],
  imports: [UserDirectoryStatusComponent, MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, FormsModule, TranslateModule, HasSelectionValuePipe, IsSelectedPipe, IsAllSelectedPipe, SearchFilterComponent]
})
export class UsersSelectionComponent implements OnInit, OnChanges {
  private readonly directory = inject(UserDirectoryFacade);
  protected readonly usersStatus = this.directory.status;
  private readonly synchronizeUsers = effect(() => {
    const users = this.directory.users();
    const loaded = this.directory.status() === 'loaded';
    untracked(() => {
      this.setObjectsDatasource(users);
      this.tableSelectionCheckboxes.clear();
      this.tableSelectionRow.clear();
      if (loaded) this.setCheckboxes();
    });
  });

  private userBackendService = inject(UserBackendService);
  private workspaceBackendService = inject(WorkspaceBackendService);

  private destroyRef = inject(DestroyRef);

  private readonly datasourceState = signal(new MatTableDataSource<UserFullDto>());
  protected get userObjectsDatasource() { return this.datasourceState(); }
  protected displayedUserColumns = ['selectCheckbox', 'username', 'displayName'];
  tableSelectionRow = new SelectionModel<UserFullDto>(false, []);
  protected tableSelectionCheckboxes = new SelectionModel<UserFullDto>(true, []);
  readonly userWorkspaces = signal<WorkspaceInListDto[]>([]);
  readonly filteredUserWorkspaces = signal<WorkspaceInListDto[]>([]);

  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    this.userObjectsDatasource.sort = this.sort() ?? null;
  });

  readonly userSelectionChanged = output<UserFullDto[]>();
  readonly selectedUserIds = input.required<number[]>();
  readonly refreshVersion = input(0);

  ngOnChanges(changes: SimpleChanges) {
    if (changes.refreshVersion && !changes.refreshVersion.firstChange) this.updateUserList();
    if (changes.selectedUserIds) {
      this.setCheckboxes();
    }
  }

  ngOnInit(): void {
    this.createWorkspaceList();
    this.updateUserList();
  }

  private setObjectsDatasource(users: UserFullDto[]): void {
    this.datasourceState.set(new MatTableDataSource(users));
    this.userObjectsDatasource
      .filterPredicate = (userList: UserFullDto, filter) => [
        'username', 'displayName'
      ].some(column => (userList[column as keyof UserFullDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.userObjectsDatasource.sort = this.sort() ?? null;
  }

  updateUserList(): void {
    this.directory.load(() => this.userBackendService.getUsersFull());
  }

  createWorkspaceList(): void {
    this.workspaceBackendService.getAllWorkspacesList()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(workspaces => {
        if (workspaces.data.length > 0) { this.userWorkspaces.set(workspaces.data); }
      });
  }

  setCheckboxes(): void {
    const foundUserIds: UserFullDto[] = [];
    this.selectedUserIds()?.forEach(userId => {
      const foundUserId = this.userObjectsDatasource.data.find(user => user.id === userId);
      if (foundUserId) {
        foundUserIds.push(foundUserId);
      }
      if (foundUserIds) {
        this.tableSelectionCheckboxes.select(...foundUserIds);
      }
    });
  }

  protected checkboxToggle(row: UserFullDto): void {
    this.tableSelectionCheckboxes.toggle(row);
    this.updateUserWorkspacesList(row.id);
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  updateUserWorkspacesList(userId: number): void {
    if (this.tableSelectionCheckboxes.selected.length === 1) {
      this.userBackendService.getWorkspacesByUserList(userId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(workspaces => {
          this.filteredUserWorkspaces.set(this.userWorkspaces().filter(workspace => workspaces.includes(workspace.id)));
        });
    }
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.userObjectsDatasource ? this.userObjectsDatasource.data.length : 0;
    return numSelected === numRows;
  }

  protected masterToggle(): void {
    this.isAllSelected() || !this.userObjectsDatasource ?
      this.tableSelectionCheckboxes.clear() :
      this.userObjectsDatasource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
    this.userSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }
}
