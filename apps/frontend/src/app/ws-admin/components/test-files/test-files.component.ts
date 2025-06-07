import {
  Component, OnInit, ViewChild
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
import { DatePipe, NgIf, NgFor } from '@angular/common';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { FilesValidationDialogComponent } from '../files-validation-result/files-validation.component';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { FileSizePipe } from '../../../shared/pipes/filesize.pipe';
import { FilesInListDto } from '../../../../../../../api-dto/files/files-in-list.dto';
import { FilesValidationDto } from '../../../../../../../api-dto/files/files-validation.dto';
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
    NgIf,
    NgFor,
    FormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption
  ]
})
export class TestFilesComponent implements OnInit {
  displayedColumns: string[] = ['selectCheckbox', 'filename', 'file_size', 'file_type', 'created_at'];
  dataSource!: MatTableDataSource<FilesInListDto>;
  tableCheckboxSelection = new SelectionModel<FilesInListDto>(true, []);
  isLoading = false;

  // Filter properties
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

  // Original filter value for text search
  textFilterValue: string = '';

  // Sort functionality
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    public appService: AppService,
    public backendService: BackendService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
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
    this.isAllSelected() ?
      this.tableCheckboxSelection.clear() :
      this.dataSource?.data.forEach(row => this.tableCheckboxSelection.select(row));
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
    this.extractFileTypes(files);
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
    // Add 'All' option at the beginning
    this.fileTypes.unshift('');
  }

  /** Sets up custom filter predicate for the data source */
  private setupFilterPredicate(): void {
    this.dataSource.filterPredicate = (data: FilesInListDto, filter: string) => {
      // Parse the filter string to get individual filters
      const filterObj = JSON.parse(filter || '{}');

      // Text filter
      const textMatch = !filterObj.text ||
        data.filename.toLowerCase().includes(filterObj.text) ||
        (data.file_type && data.file_type.toLowerCase().includes(filterObj.text)) ||
        (data.file_size && data.file_size.toLowerCase().includes(filterObj.text));

      // File type filter
      const typeMatch = !filterObj.fileType ||
        (data.file_type && data.file_type === filterObj.fileType);

      // File size filter
      const sizeMatch = !filterObj.fileSize ||
        this.isFileSizeInRange(data.file_size, filterObj.fileSize);
      return (textMatch && typeMatch && sizeMatch) as boolean;
    };
  }

  /** Checks if a file size is within the selected range */
  private isFileSizeInRange(fileSize: string | undefined, range: string): boolean {
    if (!fileSize || !range) return true;

    // Convert file size to KB for easier comparison
    const sizeInKB = this.convertToKB(fileSize);
    if (sizeInKB === null) return true; // If conversion fails, don't filter out

    // Check against the selected range
    switch (range) {
      case '0-10KB':
        return sizeInKB < 10;
      case '10KB-100KB':
        return sizeInKB >= 10 && sizeInKB < 100;
      case '100KB-1MB':
        return sizeInKB >= 100 && sizeInKB < 1024;
      case '1MB-10MB':
        return sizeInKB >= 1024 && sizeInKB < 10240;
      case '10MB+':
        return sizeInKB >= 10240;
      default:
        return true;
    }
  }

  /** Converts file size string to KB */
  private convertToKB(fileSizeStr: string): number | null {
    try {
      const sizeStr = fileSizeStr.toLowerCase();
      if (sizeStr.includes('kb')) {
        return parseFloat(sizeStr);
      }
      if (sizeStr.includes('mb')) {
        return parseFloat(sizeStr) * 1024;
      }
      if (sizeStr.includes('gb')) {
        return parseFloat(sizeStr) * 1024 * 1024;
      }
      if (sizeStr.includes('b')) {
        return parseFloat(sizeStr) / 1024;
      }
      return parseFloat(sizeStr); // Assume KB if no unit
    } catch (e) {
      return null;
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
    this.textFilterValue = value.trim().toLowerCase();
    this.applyFilters();
  }

  /** Clears all filters */
  clearFilters(): void {
    this.textFilterValue = '';
    this.selectedFileType = '';
    this.selectedFileSize = '';
    this.applyFilters();
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

  private onUploadSuccess(): void {
    setTimeout(() => {
      this.loadTestFiles(true);
    }, 1000); // Optional timeout to simulate processing delay
    this.isLoading = false;
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
    this.backendService.validateFiles(this.appService.selectedWorkspaceId)
      .subscribe(respOk => {
        this.handleValidationResponse(respOk);
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

  private handleValidationResponse(res: boolean | FilesValidationDto[]): void {
    this.isLoading = false;
    if (res === false) {
      this.snackBar.open(
        this.translate.instant('ws-admin.validation-failed'),
        this.translate.instant('error'),
        { duration: 3000 }
      );
    } else if (typeof res !== 'boolean') {
      this.dialog.open(FilesValidationDialogComponent, {
        width: '600px',
        data: res
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
}
