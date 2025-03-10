import {
  Component, OnInit, ViewChild
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog';
import { UntypedFormGroup } from '@angular/forms';
import { MatSort, MatSortHeader } from '@angular/material/sort';
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
import { DatePipe } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { FileSizePipe } from '../../../shared/pipes/filesize.pipe';
import { FilesInListDto } from '../../../../../../../api-dto/files/files-in-list.dto';

@Component({
  selector: 'coding-box-test-files',
  templateUrl: './test-files.component.html',
  styleUrls: ['./test-files.component.scss'],
  // eslint-disable-next-line max-len
  imports: [MatAnchor, TranslateModule, MatIcon, MatProgressSpinner, MatTable, MatColumnDef, MatHeaderCellDef, MatCellDef, MatHeaderRowDef, MatRowDef, MatHeaderCell, MatCell, MatSort, MatHeaderRow, MatRow, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe, MatCheckbox, SearchFilterComponent, MatSortHeader, DatePipe, FileSizePipe]
})
export class TestFilesComponent implements OnInit {
  constructor(public appService: AppService,
              public backendService: BackendService,
              private TestCenterImportDialog: MatDialog,
              private snackBar: MatSnackBar,
              private translateService: TranslateService
  ) {
  }

  selectedRows!: FilesInListDto[];
  tableSelectionCheckboxes = new SelectionModel<FilesInListDto>(true, []);
  tableSelectionRow = new SelectionModel<FilesInListDto>(false, []);
  @ViewChild(MatSort) sort = new MatSort();
  displayedColumns: string[] = ['selectCheckbox', 'filename', 'file_size', 'file_type', 'created_at'];
  dataSource!: MatTableDataSource<FilesInListDto>;
  isLoading = false;
  files = [];

  @ViewChild(MatSort) set matSort(sort: MatSort) {
    if (this.dataSource) {
      this.dataSource.sort = sort;
    }
  }

  ngOnInit(): void {
    this.createTestFilesList(false);
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

  onFileSelected(targetElement: EventTarget | null) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.isLoading = true;
        this.backendService.uploadTestFiles(
          this.appService.selectedWorkspaceId,
          inputElement.files
        ).subscribe(() => {
          setTimeout(() => {
            this.createTestFilesList(true);
          }, 1000);
          this.isLoading = false;
        });
      }
    }
  }

  createTestFilesList(dataChanged:boolean): void {
    this.isLoading = true;
    if (this.appService.workspaceData?.testFiles.length === 0 || dataChanged) {
      this.backendService.getFilesList(this.appService.selectedWorkspaceId)
        .subscribe((files: FilesInListDto[]) => {
          this.dataSource = new MatTableDataSource(files || []);
          this.appService.workspaceData.testFiles = files;
          this.isLoading = false;
        });
    } else {
      this.dataSource = new MatTableDataSource(this.appService.workspaceData.testFiles || []);
      this.isLoading = false;
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
          this.createTestFilesList(true);
          return true;
        }
      }
      return false;
    });
  }

  deleteFiles(): void {
    const fileIds = this.tableSelectionCheckboxes.selected.map(file => file.id);
    this.backendService.deleteFiles(this.appService.selectedWorkspaceId, fileIds).subscribe(
      respOk => {
        if (respOk) {
          const dataChanged = true;
          this.createTestFilesList(dataChanged);
          this.snackBar.open(
            this.translateService.instant('ws-admin.files-deleted'),
            '',
            { duration: 1000 });
        } else {
          this.snackBar.open(
            this.translateService.instant('ws-admin.files-not-deleted'),
            this.translateService.instant('error'),
            { duration: 1000 });
        }
      }
    );
  }
}
