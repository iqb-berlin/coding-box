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
  ChangeDetectorRef, Component, OnInit, SimpleChanges, ViewChild, inject,
  DestroyRef, input,
  output
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  private destroyRef = inject(DestroyRef);
  private changeDetectorRef = inject(ChangeDetectorRef);

  objectsDatasource = new MatTableDataSource<WorkspaceInListDto>();
  displayedColumns = ['selectCheckbox', 'name'];
  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  selectedWorkspaceId = 0;
  private workspaceListLoaded = false;
  readonly workspaceListReady = output<boolean>();

  @ViewChild(MatSort) sort = new MatSort();
  readonly selectedWorkspacesIds = input.required<number[]>();
  readonly workspaceSelectionChanged = output<WorkspaceInListDto[]>();
  readonly selectionChanged = output<WorkspaceInListDto[]>();
  readonly workspacesUpdated = output<boolean>();
  readonly workspacesChanged = input.required<boolean>();

  ngOnChanges(changes: SimpleChanges) {
    if (changes.workspacesChanged?.currentValue === true &&
      !changes.workspacesChanged.firstChange) {
      this.updateWorkspaceList();
    } else if (changes.selectedWorkspacesIds &&
      !changes.selectedWorkspacesIds.firstChange) {
      this.applySelectedWorkspaceIds();
    }
  }

  ngOnInit(): void {
    this.updateWorkspaceList();
  }

  private updateWorkspaceList(): void {
    this.selectedWorkspaceId = 0;
    this.workspaceListLoaded = false;
    this.workspaceListReady.emit(false);
    this.workspaceBackendService.getAllWorkspacesListOrFail()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: workspaces => {
          this.workspacesUpdated.emit(this.workspacesChanged());
          this.setObjectsDatasource(workspaces.data);
          this.workspaceListLoaded = true;
          this.tableSelectionRow.clear();
          this.applySelectedWorkspaceIds();
          this.workspaceListReady.emit(true);
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.workspaceListReady.emit(false);
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  private applySelectedWorkspaceIds(): void {
    if (!this.workspaceListLoaded) return;
    this.tableSelectionCheckboxes.clear();
    this.tableSelectionCheckboxes.select(...this.objectsDatasource.data
      .filter(workspace => this.selectedWorkspacesIds().includes(workspace.id)));
    this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
    this.changeDetectorRef.markForCheck();
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
    this.changeDetectorRef.markForCheck();
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
    this.changeDetectorRef.markForCheck();
  }

  toggleRowSelection(row: WorkspaceInListDto): void {
    this.tableSelectionRow.toggle(row);
  }
}
