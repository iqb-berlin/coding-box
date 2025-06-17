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
import { Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
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
    MatOption
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
  // Definition der Größeneinheiten und ihrer Multiplikatoren in Bytes
  private readonly SIZES_UNITS = {
    bytes: 1,
    b: 1,
    kb: 1024,
    kib: 1024,
    mb: 1024 ** 2,
    mib: 1024 ** 2,
    gb: 1024 ** 3,
    gib: 1024 ** 3,
    tb: 1024 ** 4,
    tib: 1024 ** 4
  };

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
    if (forceReload || !this.appService.workspaceData?.testFiles.data.length) {
      this.backendService.getFilesList(this.appService.selectedWorkspaceId)
        .subscribe(files => {
          this.updateTable(files);
        });
    } else {
      this.updateTable(this.appService.workspaceData.testFiles || []);
    }
  }

  /** Updates the table data source and stops spinner */
  private updateTable(files: { data: FilesInListDto[] }): void {
    this.dataSource = new MatTableDataSource(files.data);
    this.extractFileTypes(files.data);
    this.setupFilterPredicate();
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

  /** Sets up custom filter predicate for the data source */
  private setupFilterPredicate(): void {
    this.dataSource.filterPredicate = (data: FilesInListDto, filter: string) => {
      const filterObj = JSON.parse(filter || '{}');
      // Text filter - check if any of the fields contain the search text
      const textMatch = !filterObj.text || (
        (data.filename && data.filename.toLowerCase().includes(filterObj.text.toLowerCase())) ||
        (data.file_type && data.file_type.toLowerCase().includes(filterObj.text.toLowerCase())) ||
        (data.created_at && new Date(data.created_at).toLocaleDateString().includes(filterObj.text.toLowerCase()))
      );
      // File type filter
      const typeMatch = !filterObj.fileType ||
        (data.file_type && data.file_type === filterObj.fileType);
      // File size filter
      const sizeMatch = this.isFileSizeInRange(data.file_size, filterObj.fileSize);
      return (textMatch && typeMatch && sizeMatch) as boolean;
    };
  }

  /** Parses a file size string (e.g., "10 KB", "1.5 MB") into bytes */
  private parseFileSizeToBytes(fileSizeStr: string | undefined | null): number | null {
    if (!fileSizeStr) return 0; // Interpret empty or null as 0 Bytes
    const str = String(fileSizeStr).trim().toLowerCase();
    if (str === '0' || str === '0 bytes' || str === '0b') return 0;
    const match = str.match(/^([\d.]+)\s*([a-z]+)?$/);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2] || 'bytes';
      if (Number.isNaN(value)) return null; // Invalid number part
      const multiplier = this.SIZES_UNITS[unit as keyof typeof this.SIZES_UNITS];
      if (multiplier !== undefined) {
        return value * multiplier;
      }
      if (match[2]) return null;
      return value; // Value is in bytes
    }
    const numericValue = parseFloat(str);
    if (!Number.isNaN(numericValue) && /^[\d.]+$/.test(str)) {
      return numericValue;
    }
    return null; // Unable to parse
  }

  /** Checks if a file size is within the selected range */
  private isFileSizeInRange(fileSize: string | undefined, range: string): boolean {
    const sizeInBytes = this.parseFileSizeToBytes(fileSize);
    if (sizeInBytes === null) {
      return range === '' || range === undefined;
    }
    const KB = 1024;
    const MB = 1024 * KB;
    switch (range) {
      case '0-10KB': // Less than 10KB
        return sizeInBytes < 10 * KB;
      case '10KB-100KB': // 10KB to 100KB (exclusive of 100KB)
        return sizeInBytes >= 10 * KB && sizeInBytes < 100 * KB;
      case '100KB-1MB': // 100KB to 1MB (exclusive of 1MB)
        return sizeInBytes >= 100 * KB && sizeInBytes < 1 * MB;
      case '1MB-10MB': // 1MB to 10MB (exclusive of 10MB)
        return sizeInBytes >= 1 * MB && sizeInBytes < 10 * MB;
      case '10MB+': // 10MB or more
        return sizeInBytes >= 10 * MB;
      default: // No range selected or unknown range, so it matches
        return true;
    }
  }

  /** Applies all filters */
  applyFilters(): void {
    const filterObj = {
      text: this.textFilterValue,
      fileType: this.selectedFileType,
      fileSize: this.selectedFileSize
    };
    this.dataSource.filter = JSON.stringify(filterObj);
    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
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
    // Direkt applyFilters aufrufen oder auch über den Subject, je nach gewünschtem Verhalten
    this.applyFilters();
    // Wenn clearFilters auch debounced werden soll:
    // this.textFilterChanged.next(this.textFilterValue);
  }

  /** Handles file selection for upload */
  onFileSelected(target: EventTarget | null, uploadType: string): void { // Added uploadType parameter
    if (!target) return;
    const inputElement = target as HTMLInputElement;
    const files = inputElement.files;
    if (files && files.length) {
      this.isLoading = true;
      this.isValidating = true; // This is used to show "Validierung wird durchgeführt..."

      // The backend service might be generic enough, or you might want specific endpoints later.
      // For now, assuming uploadTestFiles can handle different XMLs by their content.
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
          } else if (typeof response === 'object' && response !== null && 'validationDetails' in response) {
            this.dialog.open(FilesValidationDialogComponent, {
              width: '600px',
              data: response as FileValidationResultDto
            });
            this.loadTestFiles(true);
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
        this.handleValidationResponse(respOk as FileValidationResultDto | false); // Added type assertion for clarity
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
      this.dialog.open(FilesValidationDialogComponent, {
        width: '600px',
        data: res // Pass the whole FileValidationResultDto object
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
}
