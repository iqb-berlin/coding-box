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
import { Component, OnInit, ViewChild } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSort, MatSortHeader } from '@angular/material/sort';
import { FormsModule, UntypedFormGroup } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { DatePipe, NgFor, NgIf } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { HasSelectionValuePipe } from '../../pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../pipes/isSelected.pipe';
import { WrappedIconComponent } from '../../../wrapped-icon/wrapped-icon.component';
import { AppService } from '../../../../services/app.service';
import { BackendService } from '../../../../services/backend.service';
import { IsSelectedIdPipe } from '../../pipes/isSelectedId.pipe';
import { WorkspacesMenuComponent } from '../workspaces-menu/workspaces-menu.component';
import { WorkspaceInListDto } from '../../../../../../api-dto/workspaces/workspace-in-list-dto';
import { CreateWorkspaceDto } from '../../../../../../api-dto/workspaces/create-workspace-dto';

const datePipe = new DatePipe('de-DE');

@Component({
  selector: 'studio-lite-workspace-groups',
  templateUrl: './workspaces.component.html',
  styleUrls: ['./workspaces.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [WorkspacesMenuComponent, NgIf, SearchFilterComponent, MatTable, MatSort, MatColumnDef, MatHeaderCellDef, MatHeaderCell, MatCheckbox, MatCellDef, MatCell, MatSortHeader, MatHeaderRowDef, MatHeaderRow, MatRowDef, MatRow, MatButton, MatTooltip, WrappedIconComponent, NgFor, FormsModule, TranslateModule, IsSelectedPipe, IsAllSelectedPipe, HasSelectionValuePipe, IsSelectedIdPipe]
})
export class WorkspacesComponent implements OnInit {
  objectsDatasource = new MatTableDataSource<WorkspaceInListDto>();
  displayedColumns = ['selectCheckbox', 'name'];
  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  selectedWorkspaceGroupId = 0;

  @ViewChild(MatSort) sort = new MatSort();

  constructor(
    private appService: AppService,
    private backendService: BackendService,
    private snackBar: MatSnackBar,
    private translateService: TranslateService
  ) {
  }

  ngOnInit(): void {
    setTimeout(() => {
      this.updateWorkspaceList();
    });

  }

  addGroup(result: UntypedFormGroup): void {
    this.appService.dataLoading = true;
    this.backendService.addWorkspace(<CreateWorkspaceDto>{
      name: (<UntypedFormGroup>result).get('name')?.value,
      settings: {}
    }).subscribe(
      respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-created'),
            '',
            { duration: 1000 });
          this.updateWorkspaceList();
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-not-created'),
            this.translateService.instant('error'),
            { duration: 3000 });
        }
        this.appService.dataLoading = false;
      }
    );
  }

  editGroup(value: { selection: WorkspaceInListDto[], group: UntypedFormGroup }): void {
    this.appService.dataLoading = true;
    this.backendService.changeWorkspace({
      id: value.selection[0].id,
      name: value.group.get('name')?.value
    })
      .subscribe(
        respOk => {
          if (respOk) {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-edited'),
              '',
              { duration: 1000 });
            this.updateWorkspaceList();
          } else {
            this.snackBar.open(
              this.translateService.instant('admin.workspace-not-edited'),
              this.translateService.instant('error'),
              { duration: 3000 }
            );
          }
          this.appService.dataLoading = false;
        }
      );
  }

  deleteGroups(groups: WorkspaceInListDto[]): void {
    this.appService.dataLoading = true;
    const workspaceGroupsToDelete: number[] = [];
    groups.forEach(r => workspaceGroupsToDelete.push(r.id));
    this.backendService.deleteWorkspace(workspaceGroupsToDelete).subscribe(
      respOk => {
        if (respOk) {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-deleted'),
            '',
            { duration: 1000 });
          this.updateWorkspaceList();
        } else {
          this.snackBar.open(
            this.translateService.instant('admin.workspace-not-deleted'),
            this.translateService.instant('error'),
            { duration: 1000 });
          this.appService.dataLoading = false;
        }
      }
    );
  }

  private updateWorkspaceList(): void {
    this.selectedWorkspaceGroupId = 0;

    this.appService.dataLoading = true;
    this.backendService.getWorkspaceList().subscribe(groups => {
      this.setObjectsDatasource(groups);
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