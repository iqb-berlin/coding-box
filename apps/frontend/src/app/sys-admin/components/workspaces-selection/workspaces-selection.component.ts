import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import {
  Component, OnInit, SimpleChanges, ViewChild, inject,
  input,
  output
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { TranslateModule } from '@ngx-translate/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { IsSelectedIdPipe } from '../../../shared/pipes/isSelectedId.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';

@Component({
  selector: 'coding-box-workspaces-selection',
  templateUrl: './workspaces-selection.component.html',
  styleUrls: ['./workspaces-selection.component.scss'],
  // eslint-disable-next-line max-len
  imports: [SearchFilterComponent, MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, FormsModule, TranslateModule, IsSelectedPipe, IsAllSelectedPipe, HasSelectionValuePipe, IsSelectedIdPipe]
})
export class WorkspacesSelectionComponent implements OnInit {
  private workspaceBackendService = inject(WorkspaceBackendService);

  objectsDatasource = new MatTableDataSource<WorkspaceInListDto>();
  displayedColumns = ['selectCheckbox', 'name'];
  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  selectedWorkspaceId = 0;

  @ViewChild(MatSort) sort = new MatSort();
  readonly selectedWorkspacesIds = input.required<number[]>();
  readonly workspaceSelectionChanged = output<WorkspaceInListDto[]>();
  readonly selectionChanged = output<WorkspaceInListDto[]>();
  readonly workspacesUpdated = output<boolean>();
  readonly workspacesChanged = input.required<boolean>();

  ngOnChanges(changes: SimpleChanges) {
    if (changes) {
      this.updateWorkspaceList();
    }
  }

  ngOnInit(): void {
    this.updateWorkspaceList();
  }

  private updateWorkspaceList(): void {
    this.selectedWorkspaceId = 0;
    this.workspaceBackendService.getAllWorkspacesList().subscribe(workspaces => {
      this.workspacesUpdated.emit(this.workspacesChanged());
      this.setObjectsDatasource(workspaces.data);
      this.tableSelectionCheckboxes.clear();
      this.tableSelectionRow.clear();
      if (this.selectedWorkspacesIds()?.length > 0) {
        this.tableSelectionCheckboxes.select(...workspaces.data
          .filter(workspace => this.selectedWorkspacesIds().includes(workspace.id)));
        this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
      }
    });
  }

  private setObjectsDatasource(groups: WorkspaceInListDto[]): void {
    this.objectsDatasource = new MatTableDataSource(groups);
    this.objectsDatasource
      .filterPredicate = (groupList: WorkspaceInListDto, filter) => [
        'name'
      ].some(column => (groupList[column as keyof WorkspaceInListDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.objectsDatasource.sort = this.sort;
  }

  selectCheckbox(row: WorkspaceInListDto): void {
    this.tableSelectionCheckboxes.toggle(row);
    this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.objectsDatasource ? this.objectsDatasource.data.length : 0;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() || !this.objectsDatasource ?
      this.tableSelectionCheckboxes.clear() :
      this.objectsDatasource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
    this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  toggleRowSelection(row: WorkspaceInListDto): void {
    this.tableSelectionRow.toggle(row);
  }
}
