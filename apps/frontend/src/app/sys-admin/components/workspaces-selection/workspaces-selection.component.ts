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
  Component, OnInit, OnChanges, SimpleChanges, inject, DestroyRef, input, output, signal, viewChild, effect, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { TranslateModule } from '@ngx-translate/core';
import { MatCheckbox } from '@angular/material/checkbox';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedIdPipe } from '../../../shared/pipes/isSelectedId.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { WorkspaceInListDto } from '../../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { WorkspaceBackendService } from '../../../workspace/services/workspace-backend.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-workspaces-selection',
  templateUrl: './workspaces-selection.component.html',
  styleUrls: ['./workspaces-selection.component.scss'],
  // eslint-disable-next-line max-len
  imports: [SearchFilterComponent, MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, FormsModule, TranslateModule, IsAllSelectedPipe, HasSelectionValuePipe, IsSelectedIdPipe]
})
export class WorkspacesSelectionComponent implements OnInit, OnChanges {
  private workspaceBackendService = inject(WorkspaceBackendService);
  private destroyRef = inject(DestroyRef);

  protected readonly objectsDatasource = signal(new MatTableDataSource<WorkspaceInListDto>());
  protected displayedColumns = ['selectCheckbox', 'name'];
  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  protected readonly selectedWorkspaceId = signal(0);
  private workspaceListLoaded = false;
  readonly workspaceListReady = output<boolean>();

  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    this.objectsDatasource().sort = this.sort() ?? null;
  });

  readonly selectedWorkspacesIds = input.required<number[]>();
  readonly selectionDisabled = input(false);
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
    this.selectedWorkspaceId.set(0);
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
        },
        error: () => {
          this.workspacesUpdated.emit(this.workspacesChanged());
          this.workspaceListReady.emit(false);
        }
      });
  }

  private applySelectedWorkspaceIds(): void {
    if (!this.workspaceListLoaded) return;
    this.tableSelectionCheckboxes.clear();
    this.tableSelectionCheckboxes.select(...this.objectsDatasource().data
      .filter(workspace => this.selectedWorkspacesIds().includes(workspace.id)));
    this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  private setObjectsDatasource(groups: WorkspaceInListDto[]): void {
    this.objectsDatasource.set(new MatTableDataSource(groups));
    this.objectsDatasource()
      .filterPredicate = (groupList: WorkspaceInListDto, filter) => [
        'name'
      ].some(column => (groupList[column as keyof WorkspaceInListDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.objectsDatasource().sort = this.sort() ?? null;
  }

  protected selectCheckbox(row: WorkspaceInListDto): void {
    if (this.selectionDisabled()) return;
    this.tableSelectionCheckboxes.toggle(row);
    this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.objectsDatasource() ? this.objectsDatasource().data.length : 0;
    return numSelected === numRows;
  }

  protected masterToggle(): void {
    if (this.selectionDisabled()) return;
    this.isAllSelected() || !this.objectsDatasource() ?
      this.tableSelectionCheckboxes.clear() :
      this.objectsDatasource().data.forEach(row => this.tableSelectionCheckboxes.select(row));
    this.workspaceSelectionChanged.emit(this.tableSelectionCheckboxes.selected);
  }

  protected toggleRowSelection(row: WorkspaceInListDto): void {
    this.tableSelectionRow.toggle(row);
  }
}
