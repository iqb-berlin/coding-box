import {
  Component, OnInit, ViewChild
} from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { UntypedFormGroup } from '@angular/forms';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SelectionModel } from '@angular/cdk/collections';
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
  imports: [
    HasSelectionValuePipe,
    IsAllSelectedPipe,
    IsSelectedPipe,
    SearchFilterComponent,
    FileSizePipe
  ]
})
export class TestFilesComponent implements OnInit {
  displayedColumns: string[] = ['selectCheckbox', 'filename', 'file_size', 'file_type', 'created_at'];
  dataSource!: MatTableDataSource<FilesInListDto>;
  tableCheckboxSelection = new SelectionModel<FilesInListDto>(true, []);
  isLoading = false;

  // Sort functionality
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    public appService: AppService,
    public backendService: BackendService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private translate: TranslateService // Alias for better clarity
  ) {}

  ngOnInit(): void {
    // Load the initial test files for the workspace
    this.loadTestFiles(false);
  }

  /** Getter for setting table sorting */
  get matSort(): MatSort {
    if (this.dataSource) {
      this.dataSource.sort = this.sort;
    }
    return this.sort;
  }

  /** Checks if all rows are selected */
  private isAllSelected(): boolean {
    const numSelected = this.tableCheckboxSelection.selected.length;
    const numRows = this.dataSource?.data.length || 0;
    return numSelected === numRows;
  }

  /** Toggles the selection of all rows */
  masterToggle(): void {
    this.isAllSelected() ? this.tableCheckboxSelection.clear() : this.dataSource?.data.forEach(row => this.tableCheckboxSelection.select(row));
  }

  /** Loads test files and updates the data source */
  loadTestFiles(forceReload: boolean): void {
    this.isLoading = true;

    // Check if files need to be reloaded or used from the cached data
    if (forceReload || !this.appService.workspaceData?.testFiles.length) {
      this.backendService.getFilesList(this.appService.selectedWorkspaceId)
        .subscribe(files => {
          this.updateTable(files);
        });
    } else {
      // Use cached data if reload is not required
      this.updateTable(this.appService.workspaceData.testFiles || []);
    }
  }

  /** Updates the table data source and stops spinner */
  private updateTable(files: FilesInListDto[]): void {
    this.dataSource = new MatTableDataSource(files);
    this.isLoading = false;
  }

  /** Handles file selection for upload */
  onFileSelected(target: EventTarget | null): void {
    if (!target) return;

    const inputElement = target as HTMLInputElement;
    const files = inputElement.files;

    if (files && files.length) {
      this.isLoading = true;

      this.backendService.uploadTestFiles(this.appService.selectedWorkspaceId, files)
        .subscribe(() => {
          this.onUploadSuccess();
        });
    }
  }

  /** Handles the file upload success logic */
  private onUploadSuccess(): void {
    setTimeout(() => {
      this.loadTestFiles(true);
    }, 1000); // Optional timeout to simulate processing delay
    this.isLoading = false;
  }

  /** Opens the Test Center Import dialog */
  testCenterImport(): void {
    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '600px',
      minHeight: '600px'
    });

    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      // Reload files if dialog returns a positive result
      if (result instanceof UntypedFormGroup || result) {
        this.loadTestFiles(true);
      }
    });
  }

  /** Deletes selected files from the server */
  deleteFiles(): void {
    const fileIds = this.tableCheckboxSelection.selected.map(file => file.id);

    this.backendService.deleteFiles(this.appService.selectedWorkspaceId, fileIds)
      .subscribe(respOk => {
        this.handleDeleteResponse(respOk);
      });
  }

  /** Handles the response from the file delete operation */
  private handleDeleteResponse(success: boolean): void {
    // Show appropriate snack bar message based on the result
    this.snackBar.open(
      success ? this.translate.instant('ws-admin.files-deleted') : this.translate.instant('ws-admin.files-not-deleted'),
      success ? '' : this.translate.instant('error'),
      { duration: 1000 }
    );

    if (success) {
      this.loadTestFiles(true);
    }
  }
}
