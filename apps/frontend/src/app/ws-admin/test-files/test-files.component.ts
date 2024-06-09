import {
  Component, OnInit, ViewChild
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Subscription } from 'rxjs';
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
import { DatePipe, JsonPipe } from '@angular/common';
import { MatTooltip } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { AppService } from '../../services/app.service';
import { BackendService } from '../../services/backend.service';
import { HasSelectionValuePipe } from '../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../shared/pipes/isSelected.pipe';
import { SearchFilterComponent } from '../../shared/search-filter/search-filter.component';
import { FileSizePipe } from '../../shared/pipes/filesize.pipe';
import { WrappedIconComponent } from '../../shared/wrapped-icon/wrapped-icon.component';
import { FilesInListDto } from '../../../../../../api-dto/files/files-in-list.dto';

@Component({
  selector: 'coding-box-test-files',
  templateUrl: './test-files.component.html',
  styleUrls: ['./test-files.component.scss'],
  standalone: true,
  // eslint-disable-next-line max-len
  imports: [MatAnchor, RouterLink, TranslateModule, MatIcon, TestCenterImportComponent, MatProgressSpinner, MatTable, MatColumnDef, MatHeaderCellDef, MatCellDef, MatHeaderRowDef, MatRowDef, MatHeaderCell, MatCell, MatSort, MatHeaderRow, MatRow, HasSelectionValuePipe, IsAllSelectedPipe, IsSelectedPipe, MatCheckbox, SearchFilterComponent, MatSortHeader, DatePipe, FileSizePipe, MatButton, WrappedIconComponent, MatTooltip, JsonPipe]
})
export class TestFilesComponent implements OnInit {
  private uploadSubscription: Subscription | null = null;

  constructor(public appService: AppService,
              public backendService: BackendService,
              private TestCenterImportDialog: MatDialog,
              private snackBar: MatSnackBar,
              private translateService: TranslateService,
              private route: ActivatedRoute
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
    this.createTestFilesList();
  }

  updateTestFilesList(): void {
    // this.setObjectsDatasource(this.testGroups);
    this.tableSelectionCheckboxes.clear();
    this.tableSelectionRow.clear();
    this.appService.dataLoading = false;
  }

  private setObjectsDatasource(files: FilesInListDto[]): void {
    this.dataSource = new MatTableDataSource(files);
    this.dataSource
      .filterPredicate = (filesList: FilesInListDto, filter) => [
        'name'
      ].some(column => (filesList[column as keyof FilesInListDto] as string || '')
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

  onFileSelected(targetElement: EventTarget | null) {
    if (targetElement) {
      const inputElement = targetElement as HTMLInputElement;
      if (inputElement.files && inputElement.files.length > 0) {
        this.appService.dataLoading = true;
        this.uploadSubscription = this.backendService.uploadTestFiles(
          this.appService.selectedWorkspaceId,
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

  createTestFilesList(): void {
    this.isLoading = true;
    if (this.appService.workspaceData?.testGroups.length === 0) {
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
          this.createTestFilesList();
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
          this.snackBar.open(
            this.translateService.instant('ws-admin.files-deleted'),
            '',
            { duration: 1000 });
          this.createTestFilesList();
        } else {
          this.snackBar.open(
            this.translateService.instant('ws-admin.files-not-deleted'),
            this.translateService.instant('error'),
            { duration: 1000 });
          this.appService.dataLoading = false;
        }
      }
    );
  }
}
