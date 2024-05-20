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
  Component, Input, OnInit, ViewChild
} from '@angular/core';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { NgFor, NgIf } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { HasSelectionValuePipe } from '../../pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../pipes/isSelected.pipe';
import { IsSelectedIdPipe } from '../../pipes/isSelectedId.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { WorkspaceInListDto } from '../../../../../api-dto/workspaces/workspace-in-list-dto';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { WrappedIconComponent } from '../../../shared/wrapped-icon/wrapped-icon.component';


@Component({
  selector: 'coding-box-workspaces-selection',
  templateUrl: './workspaces-selection.component.html',
  styleUrls: ['./workspaces-selection.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [NgIf, SearchFilterComponent, MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, NgFor, FormsModule, TranslateModule, IsSelectedPipe, IsAllSelectedPipe, HasSelectionValuePipe, IsSelectedIdPipe]
})
export class WorkspacesSelectionComponent implements OnInit {
  objectsDatasource = new MatTableDataSource<WorkspaceInListDto>();
  displayedColumns = ['selectCheckbox', 'name'];
  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  selectedWorkspaceId = 0;
  userWorkspaces: WorkspaceInListDto[] = [];

  @ViewChild(MatSort) sort = new MatSort();
  @Input() selectedWorkspacesIds!: number[];

  constructor(
    private appService: AppService,
    private backendService: BackendService
  ) {
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.updateWorkspaceList();
    });
  }

  private updateWorkspaceList(): void {
    this.selectedWorkspaceId = 0;
    this.appService.dataLoading = true;
    this.backendService.getAllWorkspacesList().subscribe(workspaces => {
      this.setObjectsDatasource(workspaces);
      this.tableSelectionCheckboxes.clear();
      this.tableSelectionRow.clear();
      this.appService.dataLoading = false;
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

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.objectsDatasource ? this.objectsDatasource.data.length : 0;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() || !this.objectsDatasource ?
      this.tableSelectionCheckboxes.clear() :
      this.objectsDatasource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
  }

  toggleRowSelection(row: WorkspaceInListDto): void {
    this.tableSelectionRow.toggle(row);
  }
}
