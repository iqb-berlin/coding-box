import { Component, OnInit, ViewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { UntypedFormGroup } from '@angular/forms';
import { MatSort } from '@angular/material/sort';
import {
  MatCell,
  MatCellDef,
  MatColumnDef, MatHeaderCell,
  MatHeaderCellDef, MatHeaderRow,
  MatHeaderRowDef, MatRow,
  MatRowDef,
  MatTable, MatTableDataSource
} from '@angular/material/table';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { SelectionModel } from '@angular/cdk/collections';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { AppService } from '../../services/app.service';
import { BackendService } from '../../services/backend.service';
import { HasSelectionValuePipe } from '../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../shared/pipes/isSelected.pipe';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';
import { FileSizePipe } from '../../shared/pipes/filesize.pipe';

@Component({
  selector: 'coding-box-file-upload',
  templateUrl: './file-upload.component.html',
  styleUrls: ['./file-upload.component.scss'],
  standalone: true,
  imports: [MatAnchor, RouterLink, TranslateModule, MatIcon, TestCenterImportComponent, MatProgressSpinner, MatTable, MatColumnDef, MatHeaderCellDef, MatCellDef, MatHeaderRowDef, MatRowDef, MatHeaderCell, MatCell, MatSort, MatHeaderRow, MatRow, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe, MatCheckbox, SearchFilterComponent]
})
export class FileUploadComponent implements OnInit{
  private uploadSubscription: Subscription | null = null;

  constructor(public appService: AppService,
              public backendService: BackendService,
              private TestCenterImportDialog: MatDialog,
              private route: ActivatedRoute
  ) {
  }

  tableSelectionCheckboxes = new SelectionModel<WorkspaceInListDto>(true, []);
  tableSelectionRow = new SelectionModel<WorkspaceInListDto>(false, []);
  @ViewChild(MatSort) sort = new MatSort();
  displayedColumns: string[] = ['filename', 'file_size', 'file_type', 'created_at'];
  dataSource!: MatTableDataSource<any>;
  isLoading = false;

  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (this.dataSource) {
      this.dataSource.sort = sort;
    }
  }

  ngOnInit(): void {
    this.appService.dataLoading = false;
    this.isLoading = true;
    this.backendService.getFilesList(2)
      .subscribe((files: any[]) => {
        this.dataSource = new MatTableDataSource(files);
        this.isLoading = false;
      });
  }

  private setObjectsDatasource(groups: WorkspaceInListDto[]): void {
    this.dataSource = new MatTableDataSource(groups);
    this.dataSource
      .filterPredicate = (groupList: WorkspaceInListDto, filter) => [
        'name'
      ].some(column => (groupList[column as keyof WorkspaceInListDto] as string || '')
        .toLowerCase()
        .includes(filter));
    this.dataSource.sort = this.sort;
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableSelectionCheckboxes.selected.length;
    const numRows = this.dataSource ? this.dataSource.data.length : 0;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() || !this.dataSource ?
      this.tableSelectionCheckboxes.clear() :
      this.dataSource.data.forEach(row => this.tableSelectionCheckboxes.select(row));
  }

  toggleRowSelection(row: WorkspaceInListDto): void {
    this.tableSelectionRow.toggle(row);
  }

  onFileSelected(targetElement: EventTarget | null) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.appService.dataLoading = true;
        console.log(inputElement, 'inputElement.files', inputElement.files);
        this.uploadSubscription = this.backendService.uploadTestFiles(
          1,
          inputElement.files
        ).subscribe(uploadStatus => {
          if (typeof uploadStatus === 'number') {
            if (uploadStatus < 0) {
              this.appService.dataLoading = false;
            } else {
              this.appService.dataLoading = uploadStatus;
            }
          } else {
            this.appService.dataLoading = false;
          }
        });
      }
    }
  }

  testCenterImport(): void {
    const dialogRef = this.TestCenterImportDialog.open(TestCenterImportComponent, {
      width: '600px',
      minHeight: '600px'
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      if (typeof result !== 'undefined') {
        if (result !== false) {
          return true;
        }
      }
      return false;
    });
  }
}
