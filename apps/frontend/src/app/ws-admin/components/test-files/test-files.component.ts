import {
  Component, OnDestroy, OnInit, ViewChild, inject
} from '@angular/core';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { UntypedFormGroup, FormsModule } from '@angular/forms';
import { MatSort } from '@angular/material/sort';
import {
  MatCell, MatCellDef, MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef,
  MatRow, MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton } from '@angular/material/button';
import { DatePipe } from '@angular/common';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { forkJoin, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { MatPaginator } from '@angular/material/paginator';
import { FilesValidationDialogComponent } from '../files-validation-result/files-validation.component';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { ResourcePackagesDialogComponent } from '../resource-packages-dialog/resource-packages-dialog.component';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { FileSizePipe } from '../../../shared/pipes/filesize.pipe';
import { FilesInListDto } from '../../../../../../../api-dto/files/files-in-list.dto';
import { FileValidationResultDto } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../../../api-dto/files/file-download.dto';

@Component({
  selector: 'coding-box-test-files',
  templateUrl: './test-files.component.html',
  styleUrls: ['./test-files.component.scss'],
  imports: [
    TranslateModule,
    DatePipe,
    HasSelectionValuePipe,
    IsAllSelectedPipe,
    IsSelectedPipe,
    SearchFilterComponent,
    FileSizePipe,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatCheckbox,
    MatTable,
    MatAnchor,
    MatButton,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    FormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatPaginator
  ]
})
export class TestFilesComponent implements OnInit, OnDestroy {
  appService = inject(AppService);
  backendService = inject(BackendService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);

  displayedColumns: string[] = ['selectCheckbox', 'filename', 'file_size', 'file_type', 'created_at'];
  dataSource!: MatTableDataSource<FilesInListDto>;
  tableCheckboxSelection = new SelectionModel<FilesInListDto>(true, []);
  isLoading = false;
  isValidating = false;
  selectedFileType: string = '';
  selectedFileSize: string = '';
  fileTypes: string[] = [];
  fileSizeRanges: { value: string, display: string }[] = [
    { value: '', display: 'Alle Größen' },
    { value: '0-10KB', display: '< 10KB' },
    { value: '10KB-100KB', display: '10KB - 100KB' },
    { value: '100KB-1MB', display: '100KB - 1MB' },
    { value: '1MB-10MB', display: '1MB - 10MB' },
    { value: '10MB+', display: '> 10MB' }
  ];

  // Flag to track if resource packages have been modified
  resourcePackagesModified = false;

  textFilterValue: string = '';
  @ViewChild(MatSort) sort!: MatSort;

  private textFilterChanged: Subject<string> = new Subject<string>();
  private textFilterSubscription: Subscription | undefined;

  // Pagination variables
  page: number = 1;
  limit: number = 100;
  total: number = 0;

  ngOnInit(): void {
    this.loadTestFiles(false);
    this.textFilterSubscription = this.textFilterChanged
      .pipe(debounceTime(300)) // Debounce für 300ms
      .subscribe(() => {
        this.applyFilters();
      });
  }

  ngOnDestroy(): void {
    if (this.textFilterSubscription) {
      this.textFilterSubscription.unsubscribe();
    }
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
    this.isAllSelected() ?
      this.tableCheckboxSelection.clear() :
      this.dataSource?.data.forEach(row => this.tableCheckboxSelection.select(row));
  }

  /** Loads test files and updates the data source */
  loadTestFiles(forceReload: boolean): void {
    this.isLoading = true;
    this.isValidating = false;
    this.backendService.getFilesList(
      this.appService.selectedWorkspaceId,
      this.page,
      this.limit,
      this.selectedFileType,
      this.selectedFileSize,
      this.textFilterValue
    ).subscribe(response => {
      this.total = response.total;
      this.page = response.page;
      this.limit = response.limit;
      this.updateTable(response);
    });
  }

  /** Updates the table data source and stops spinner */
  private updateTable(files: { data: FilesInListDto[] }): void {
    this.dataSource = new MatTableDataSource(files.data);
    this.extractFileTypes(files.data);
    this.isLoading = false;
  }

  /** Extracts unique file types from the data */
  private extractFileTypes(files: FilesInListDto[]): void {
    const types = new Set<string>();
    files.forEach(file => {
      if (file.file_type) {
        types.add(file.file_type);
      }
    });
    this.fileTypes = Array.from(types).sort();
    this.fileTypes.unshift('');
  }

  /** Applies all filters */
  applyFilters(): void {
    this.page = 1;
    this.loadTestFiles(true);
  }

  /** Handles text filter changes */
  onTextFilterChange(value: string): void {
    this.textFilterValue = value.trim();
    this.textFilterChanged.next(this.textFilterValue);
  }

  /** Clears all filters */
  clearFilters(): void {
    this.textFilterValue = '';
    this.selectedFileType = '';
    this.selectedFileSize = '';
    this.applyFilters();
  }

  /** Handles file selection for upload */
  onFileSelected(target: EventTarget | null, uploadType: string): void { // Added uploadType parameter
    if (!target) return;
    const inputElement = target as HTMLInputElement;
    const files = inputElement.files;
    if (files && files.length) {
      this.isLoading = true;
      this.isValidating = true; // This is used to show "Validierung wird durchgeführt..."

      this.backendService.uploadTestFiles(this.appService.selectedWorkspaceId, files)
        .subscribe(response => {
          this.isLoading = false;
          this.isValidating = false;
          if (typeof response === 'boolean' && response === false) {
            this.snackBar.open(
              this.translate.instant('ws-admin.upload-or-validation-failed'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
            this.loadTestFiles(true);
          } else if (typeof response === 'object' && response !== null && 'bookletValidationResults' in response) {
            const dialogRef = this.dialog.open(FilesValidationDialogComponent, {
              width: '600px',
              data: response as FileValidationResultDto
            });
            dialogRef.afterClosed().subscribe(result => {
              if (result && result.action === 'deleteBooklet') {
                this.backendService.deleteBooklet(this.appService.selectedWorkspaceId, result.payload)
                  .subscribe(success => {
                    if (success) {
                      this.snackBar.open(this.translate.instant('ws-admin.files-deleted'), '', { duration: 3000 });
                    } else {
                      this.snackBar.open(this.translate.instant('ws-admin.files-not-deleted'), this.translate.instant('error'), { duration: 3000 });
                    }
                    this.loadTestFiles(true);
                  });
              } else if (result && result.action === 'deleteBooklets') {
                const bookletIds = result.payload as string[];
                if (bookletIds && bookletIds.length > 0) {
                  const deleteObservables = bookletIds.map(id => this.backendService.deleteBooklet(this.appService.selectedWorkspaceId, id)
                  );
                  forkJoin(deleteObservables).subscribe(results => {
                    const allSucceeded = results.every(r => r);
                    if (allSucceeded) {
                      this.snackBar.open(this.translate.instant('ws-admin.files-deleted'), '', { duration: 3000 });
                    } else {
                      this.snackBar.open(this.translate.instant('ws-admin.some-files-not-deleted'), this.translate.instant('error'), { duration: 3000 });
                    }
                    this.loadTestFiles(true);
                  });
                }
              } else {
                this.loadTestFiles(true);
              }
            });
          } else {
            this.snackBar.open(
              this.translate.instant('ws-admin.unexpected-server-response'),
              this.translate.instant('error'),
              { duration: 3000 }
            );
            this.loadTestFiles(true);
          }
          // Reset the file input to allow re-uploading the same file if needed
          inputElement.value = '';
        });
    }
  }

  testCenterImport(): void {
    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '800px',
      minHeight: '800px',
      data: {
        importType: 'testFiles'
      }
    });
    dialogRef.afterClosed().subscribe((result: boolean | UntypedFormGroup) => {
      // Reload files if dialog returns a positive result
      if (result instanceof UntypedFormGroup || result) {
        this.loadTestFiles(true);
      }
    });
  }

  deleteFiles(): void {
    const fileIds = this.tableCheckboxSelection.selected.map(file => file.id);
    this.backendService.deleteFiles(this.appService.selectedWorkspaceId, fileIds)
      .subscribe(respOk => {
        this.handleDeleteResponse(respOk);
      });
  }

  downloadFile(row: FilesInListDto): void {
    this.backendService.downloadFile(this.appService.selectedWorkspaceId, row.id).subscribe({
      next: (res: FileDownloadDto) => {
        const decodedString = atob(res.base64Data);
        const blob = new Blob([decodedString], { type: 'application/xml' });
        const url = window.URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = row.filename || 'download';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.URL.revokeObjectURL(url);
      }
    });
  }

  validateFiles(): void {
    this.isLoading = true;
    this.isValidating = true;
    this.backendService.validateFiles(this.appService.selectedWorkspaceId)
      .subscribe(respOk => {
        this.handleValidationResponse(respOk as FileValidationResultDto | false);
      });
  }

  private handleDeleteResponse(success: boolean): void {
    this.snackBar.open(
      success ? this.translate.instant('ws-admin.files-deleted') : this.translate.instant('ws-admin.files-not-deleted'),
      success ? '' : this.translate.instant('error'),
      { duration: 1000 }
    );
    if (success) {
      this.loadTestFiles(true);
    }
  }

  private handleValidationResponse(res: FileValidationResultDto | false): void {
    this.isLoading = false;
    this.isValidating = false;
    if (res === false) {
      this.snackBar.open(
        this.translate.instant('ws-admin.validation-failed'),
        this.translate.instant('error'),
        { duration: 3000 }
      );
    } else {
      const dialogRef = this.dialog.open(FilesValidationDialogComponent, {
        width: '600px',
        data: res
      });
      dialogRef.afterClosed().subscribe(result => {
        if (result && result.action === 'deleteBooklet') {
          this.backendService.deleteBooklet(this.appService.selectedWorkspaceId, result.payload)
            .subscribe(success => {
              if (success) {
                this.snackBar.open(this.translate.instant('ws-admin.files-deleted'), '', { duration: 3000 });
                this.loadTestFiles(true);
              } else {
                this.snackBar.open(this.translate.instant('ws-admin.files-not-deleted'), this.translate.instant('error'), { duration: 3000 });
              }
            });
        } else if (result && result.action === 'deleteBooklets') {
          const bookletIds = result.payload as string[];
          if (bookletIds && bookletIds.length > 0) {
            const deleteObservables = bookletIds.map(id => this.backendService.deleteBooklet(this.appService.selectedWorkspaceId, id)
            );
            forkJoin(deleteObservables).subscribe(results => {
              const allSucceeded = results.every(r => r);
              if (allSucceeded) {
                this.snackBar.open(this.translate.instant('ws-admin.files-deleted'), '', { duration: 3000 });
              } else {
                this.snackBar.open(this.translate.instant('ws-admin.some-files-not-deleted'), this.translate.instant('error'), { duration: 3000 });
              }
              this.loadTestFiles(true);
            });
          }
        }
      });
    }
  }

  /**
   * Returns the appropriate icon based on file type
   */
  getFileIcon(fileType: string): string {
    const type = fileType.toLowerCase();
    if (type.includes('xml')) {
      return 'code';
    }
    if (type.includes('zip')) {
      return 'folder_zip';
    }
    if (type.includes('html')) {
      return 'html';
    }
    if (type.includes('csv')) {
      return 'table_chart';
    }
    if (type.includes('voud') || type.includes('vocs')) {
      return 'description';
    }
    return 'insert_drive_file';
  }

  // Resource Packages methods

  /**
   * Opens the resource packages dialog
   */
  openResourcePackagesDialog(): void {
    const dialogRef = this.dialog.open(ResourcePackagesDialogComponent, {
      width: '90%',
      maxWidth: '1200px',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      // If result is true, resource packages were modified (uploaded or deleted)
      if (result === true) {
        this.resourcePackagesModified = true;
        // Optionally reload test files if they include resource packages
        // this.loadTestFiles(true);
      }
    });
  }

  /** Wird vom MatPaginator aufgerufen */
  onPageChange(event: any): void {
    this.page = event.pageIndex + 1;
    this.limit = event.pageSize;
    this.loadTestFiles(true);
  }
}
