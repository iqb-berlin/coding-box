import {
  Component, OnDestroy, OnInit, ViewChild, inject
} from '@angular/core';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { UntypedFormGroup, FormsModule } from '@angular/forms';
import { MatSort } from '@angular/material/sort';
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
import { MatSnackBar } from '@angular/material/snack-bar';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatTooltip } from '@angular/material/tooltip';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { DatePipe } from '@angular/common';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, finalize } from 'rxjs/operators';
import {
  MatPaginator,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import { FilesValidationDialogComponent } from '../files-validation-result/files-validation.component';
import { TestCenterImportComponent } from '../test-center-import/test-center-import.component';
import { ResourcePackagesDialogComponent } from '../resource-packages-dialog/resource-packages-dialog.component';
import { SchemeEditorDialogComponent } from '../../../coding/components/scheme-editor-dialog/scheme-editor-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { FileService } from '../../../shared/services/file/file.service';
import { FileBackendService } from '../../../shared/services/file/file-backend.service';
import { HasSelectionValuePipe } from '../../../shared/pipes/hasSelectionValue.pipe';
import { IsAllSelectedPipe } from '../../../shared/pipes/isAllSelected.pipe';
import { IsSelectedPipe } from '../../../shared/pipes/isSelected.pipe';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { FileSizePipe } from '../../../shared/pipes/filesize.pipe';
import { FilesInListDto } from '../../../../../../../api-dto/files/files-in-list.dto';
import { FileValidationResultDto } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { FileDownloadDto } from '../../../../../../../api-dto/files/file-download.dto';
import { TestFilesUploadResultDto } from '../../../../../../../api-dto/files/test-files-upload-result.dto';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';
import {
  TestFilesUploadConflictsDialogComponent,
  TestFilesUploadConflictsDialogResult
} from './test-files-upload-conflicts-dialog.component';
import { TestFilesUploadFailedDialogComponent } from './test-files-upload-failed-dialog.component';
import {
  TestFilesUploadResultDialogComponent,
  TestFilesUploadResultDialogData
} from './test-files-upload-result-dialog.component';
import {
  TestFilesZipExportOptions,
  TestFilesZipExportOptionsDialogComponent
} from './test-files-zip-export-options-dialog.component';
import { getFileIcon } from '../../utils/file-utils';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { Result } from '../../../shared/services/file/import.service';

@Component({
  selector: 'coding-box-test-files',
  templateUrl: './test-files.component.html',
  styleUrls: ['./test-files.component.scss'],
  providers: [{ provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }],
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
    MatPaginator,
    MatIconButton,
    MatTooltip
  ]
})
export class TestFilesComponent implements OnInit, OnDestroy {
  appService = inject(AppService);
  fileService = inject(FileService);
  private fileBackendService = inject(FileBackendService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);

  displayedColumns: string[] = [
    'selectCheckbox',
    'filename',
    'file_size',
    'file_type',
    'created_at',
    'actions'
  ];

  dataSource = new MatTableDataSource<FilesInListDto>([]);
  tableCheckboxSelection = new SelectionModel<FilesInListDto>(true, []);
  isLoading = false;
  isValidating = false;
  isDownloadingAllFiles = false;
  isDeleting = false;
  isUploading = false;
  selectedFileType: string = '';
  selectedFileSize: string = '';
  fileTypes: string[] = [];
  fileSizeRanges: { value: string; display: string }[] = [
    { value: '', display: 'Alle Größen' },
    { value: '0-10KB', display: '< 10KB' },
    { value: '10KB-100KB', display: '10KB - 100KB' },
    { value: '100KB-1MB', display: '100KB - 1MB' },
    { value: '1MB-10MB', display: '1MB - 10MB' },
    { value: '10MB+', display: '> 10MB' }
  ];

  resourcePackagesModified = false;

  textFilterValue: string = '';
  @ViewChild(MatSort) sort!: MatSort;

  private textFilterChanged: Subject<string> = new Subject<string>();
  private textFilterSubscription: Subscription | undefined;

  page: number = 1;
  limit: number = 100;
  total: number = 0;

  ngOnInit(): void {
    this.loadTestFiles();
    this.textFilterSubscription = this.textFilterChanged
      .pipe(debounceTime(300))
      .subscribe(() => {
        this.applyFilters();
      });
  }

  ngOnDestroy(): void {
    if (this.textFilterSubscription) {
      this.textFilterSubscription.unsubscribe();
    }
  }

  private openUploadResultDialog(data: TestFilesUploadResultDialogData): void {
    this.dialog.open(TestFilesUploadResultDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data
    });
  }

  get matSort(): MatSort {
    if (this.dataSource) {
      this.dataSource.sort = this.sort;
    }
    return this.sort;
  }

  get isBusy(): boolean {
    return (
      this.isDeleting ||
      this.isUploading ||
      this.isDownloadingAllFiles ||
      this.isValidating ||
      this.isLoading
    );
  }

  get busyText(): string {
    if (this.isDeleting) {
      return 'Datei(en) werden gelöscht...';
    }
    if (this.isDownloadingAllFiles) {
      return 'ZIP-Datei wird erstellt und heruntergeladen...';
    }
    if (this.isValidating) {
      return 'Validierung wird durchgeführt...';
    }
    if (this.isUploading) {
      return 'Datei(en) werden hochgeladen...';
    }
    if (this.isLoading) {
      return 'Dateiliste wird geladen...';
    }
    return '';
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableCheckboxSelection.selected.length;
    const numRows = this.dataSource?.data.length || 0;
    return numSelected === numRows;
  }

  masterToggle(): void {
    this.isAllSelected() ?
      this.tableCheckboxSelection.clear() :
      this.dataSource?.data.forEach(row => this.tableCheckboxSelection.select(row)
      );
  }

  loadTestFiles(): void {
    this.isLoading = true;
    this.isValidating = false;
    this.fileService
      .getFilesList(
        this.appService.selectedWorkspaceId,
        this.page,
        this.limit,
        this.selectedFileType,
        this.selectedFileSize,
        this.textFilterValue
      )
      .pipe(
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe({
        next: response => {
          this.total = response.total;
          this.page = response.page;
          this.limit = response.limit;
          this.updateTable(response);
        },
        error: () => {
          this.snackBar.open(
            'Fehler beim Laden der Dateiliste.',
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  private updateTable(files: {
    data: FilesInListDto[];
    fileTypes: string[];
  }): void {
    this.dataSource = new MatTableDataSource(files.data);
    this.fileTypes = files.fileTypes;
  }

  applyFilters(): void {
    this.page = 1;
    this.tableCheckboxSelection.clear();
    this.loadTestFiles();
  }

  onTextFilterChange(value: string): void {
    this.textFilterValue = value.trim();
    this.textFilterChanged.next(this.textFilterValue);
  }

  clearFilters(): void {
    this.textFilterValue = '';
    this.selectedFileType = '';
    this.selectedFileSize = '';
    this.applyFilters();
  }

  private showUploadSummary(result: TestFilesUploadResultDto): void {
    const conflicts = result.conflicts || [];
    const conflictInfo =
      conflicts.length > 0 ? `, Konflikte: ${conflicts.length}` : '';
    this.snackBar.open(
      `Upload abgeschlossen: ${result.uploaded} erfolgreich, ${result.failed} fehlgeschlagen${conflictInfo}`,
      'OK',
      { duration: 5000 }
    );

    if (result.failedFiles && result.failedFiles.length > 0) {
      this.dialog.open(TestFilesUploadFailedDialogComponent, {
        width: '800px',
        maxWidth: '95vw',
        data: {
          failedFiles: result.failedFiles
        }
      });
    }
  }

  private handleUploadResult(
    workspaceId: number,
    files: FileList | FormData,
    result: TestFilesUploadResultDto
  ): void {
    this.showUploadSummary(result);

    const conflicts = result.conflicts || [];
    const uploadedFiles = result.uploadedFiles || [];
    const failedFiles = result.failedFiles || [];
    const attempted = result.total;
    if (conflicts.length === 0) {
      this.openUploadResultDialog({
        attempted,
        uploadedFiles,
        failedFiles,
        remainingConflicts: []
      });
      this.onUploadSuccess();
      return;
    }

    const ref = this.dialog.open<
    TestFilesUploadConflictsDialogComponent,
    { conflicts: typeof conflicts },
    TestFilesUploadConflictsDialogResult
    >(TestFilesUploadConflictsDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: { conflicts }
    });

    ref.afterClosed().subscribe(resultChoice => {
      if (resultChoice?.overwrite === true) {
        this.isLoading = true;
        this.isUploading = true;
        const overwriteSelectedCount = (resultChoice.overwriteFileIds || [])
          .length;
        this.fileService
          .uploadTestFiles(
            workspaceId,
            files,
            true,
            resultChoice.overwriteFileIds
          )
          .pipe(
            finalize(() => {
              this.isLoading = false;
              this.isUploading = false;
            })
          )
          .subscribe({
            next: overwriteResult => {
              this.showUploadSummary(overwriteResult);

              const finalUploadedFiles = [
                ...uploadedFiles,
                ...(overwriteResult.uploadedFiles || [])
              ];
              const finalFailedFiles = [
                ...failedFiles,
                ...(overwriteResult.failedFiles || [])
              ];
              const remainingConflicts = conflicts.filter(
                c => !(resultChoice.overwriteFileIds || []).includes(c.fileId)
              );

              this.openUploadResultDialog({
                attempted,
                overwriteSelectedCount,
                uploadedFiles: finalUploadedFiles,
                failedFiles: finalFailedFiles,
                remainingConflicts
              });
              this.onUploadSuccess();
            },
            error: () => {
              this.snackBar.open(
                'Fehler beim Überschreiben der Dateien.',
                this.translate.instant('error'),
                { duration: 3000 }
              );
            }
          });
      } else {
        // Skip overwriting, keep already uploaded (non-conflicting) files.
        this.openUploadResultDialog({
          attempted,
          uploadedFiles,
          failedFiles,
          remainingConflicts: conflicts
        });
        this.onUploadSuccess();
      }
    });
  }

  onFileSelected(target: EventTarget | null): void {
    if (!target) return;
    const inputElement = target as HTMLInputElement;
    const files = inputElement.files;
    if (files && files.length) {
      this.isLoading = true;
      this.isUploading = true;
      const workspaceId = this.appService.selectedWorkspaceId;
      this.fileService
        .uploadTestFiles(workspaceId, files, false)
        .pipe(
          finalize(() => {
            this.isLoading = false;
            this.isUploading = false;
          })
        )
        .subscribe({
          next: result => {
            this.handleUploadResult(workspaceId, files, result);
          },
          error: () => {
            this.snackBar.open(
              'Fehler beim Hochladen der Dateien.',
              this.translate.instant('error'),
              { duration: 3000 }
            );
          }
        });
    }
  }

  private onUploadSuccess(): void {
    setTimeout(() => {
      this.loadTestFiles();
    }, 1000);
    this.isLoading = false;
    this.isUploading = false;
    this.isValidating = false;
  }

  testCenterImport(): void {
    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '1000px',
      maxWidth: '95vw',
      minHeight: '800px',
      data: {
        importType: 'testFiles'
      }
    });
    dialogRef.afterClosed().subscribe((result: unknown) => {
      const maybePayload = result as
        | {
          didImport?: boolean;
          importType?: 'testFiles';
          result?: Result;
          overwriteSelectedCount?: number;
        }
        | boolean
        | UntypedFormGroup
        | undefined;

      if (
        maybePayload &&
        typeof maybePayload === 'object' &&
        'didImport' in maybePayload &&
        (maybePayload as { didImport?: boolean }).didImport &&
        (maybePayload as { importType?: string }).importType === 'testFiles' &&
        (maybePayload as { result?: unknown }).result
      ) {
        const payload = maybePayload as { result: Result };
        const r = payload.result;

        const detailed = r.testFilesUploadResult;
        const attempted = Number(detailed?.total ?? r.testFiles ?? 0);
        const uploadedFiles = detailed?.uploadedFiles || [];
        const failedFiles = detailed?.failedFiles || [];
        const remainingConflicts = detailed?.conflicts || [];

        this.openUploadResultDialog({
          attempted,
          uploadedCount: Number(detailed?.uploaded ?? uploadedFiles.length),
          failedCount: Number(detailed?.failed ?? failedFiles.length),
          remainingConflictsCount: Number(remainingConflicts.length),
          overwriteSelectedCount: Number(
            (maybePayload as { overwriteSelectedCount?: number })
              .overwriteSelectedCount || 0
          ),
          uploadedFiles,
          failedFiles,
          remainingConflicts,
          issues: r.issues
        } as TestFilesUploadResultDialogData);

        this.onUploadSuccess();
        return;
      }

      if (result instanceof UntypedFormGroup || result) {
        this.loadTestFiles();
      }
    });
  }

  deleteFiles(): void {
    const fileIds = this.tableCheckboxSelection.selected.map(file => file.id);
    this.isDeleting = true;
    this.fileService
      .deleteFiles(this.appService.selectedWorkspaceId, fileIds)
      .pipe(
        finalize(() => {
          this.isDeleting = false;
        })
      )
      .subscribe({
        next: respOk => {
          this.handleDeleteResponse(respOk);
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('ws-admin.files-not-deleted'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  downloadFile(row: FilesInListDto): void {
    this.fileService
      .downloadFile(this.appService.selectedWorkspaceId, row.id)
      .subscribe({
        next: (res: FileDownloadDto) => {
          const decodedString = atob(res.base64Data);
          const byteArray = new Uint8Array(decodedString.length);
          for (let i = 0; i < decodedString.length; i++) {
            byteArray[i] = decodedString.charCodeAt(i);
          }
          const blob = new Blob([byteArray], {
            type: res.mimeType || 'application/xml'
          });
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

  downloadAllFilesAsZip(): void {
    const ref = this.dialog.open(TestFilesZipExportOptionsDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: {
        availableFileTypes: this.fileTypes || [],
        selectedFileTypes: this.fileTypes || []
      }
    });

    ref.afterClosed().subscribe((result?: TestFilesZipExportOptions) => {
      if (!result) {
        return;
      }
      if (!result.fileTypes || result.fileTypes.length === 0) {
        this.snackBar.open('Keine Dateitypen ausgewählt.', 'OK', {
          duration: 3000
        });
        return;
      }

      this.isDownloadingAllFiles = true;
      this.fileBackendService
        .downloadWorkspaceFilesAsZip(
          this.appService.selectedWorkspaceId,
          result.fileTypes
        )
        .subscribe({
          next: (blob: Blob) => {
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `workspace-${this.appService.selectedWorkspaceId}-files.zip`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            window.URL.revokeObjectURL(url);
            this.isDownloadingAllFiles = false;

            this.snackBar.open(
              'ZIP-Datei wurde erfolgreich heruntergeladen.',
              'OK',
              { duration: 3000 }
            );
          },
          error: () => {
            this.isDownloadingAllFiles = false;
            this.snackBar.open(
              'Fehler beim Herunterladen der ZIP-Datei.',
              'OK',
              { duration: 3000 }
            );
          }
        });
    });
  }

  validateFiles(): void {
    this.isLoading = true;
    this.isValidating = true;
    this.fileService
      .validateFiles(this.appService.selectedWorkspaceId)
      .subscribe({
        next: respOk => {
          this.handleValidationResponse(respOk);
        },
        error: () => {
          this.isLoading = false;
          this.isValidating = false;
          this.snackBar.open(
            this.translate.instant('ws-admin.validation-failed'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  private handleDeleteResponse(success: boolean): void {
    this.snackBar.open(
      success ?
        this.translate.instant('ws-admin.files-deleted') :
        this.translate.instant('ws-admin.files-not-deleted'),
      success ? '' : this.translate.instant('error'),
      { duration: 1000 }
    );
    if (success) {
      this.tableCheckboxSelection.clear();
      this.loadTestFiles();
    }
  }

  private handleValidationResponse(
    res: boolean | FileValidationResultDto
  ): void {
    this.isLoading = false;
    this.isValidating = false;
    if (res === false) {
      this.snackBar.open(
        this.translate.instant('ws-admin.validation-failed'),
        this.translate.instant('error'),
        { duration: 3000 }
      );
    } else if (typeof res !== 'boolean') {
      if (!res.testTakersFound) {
        const confirmRef = this.dialog.open(ConfirmDialogComponent, {
          width: '400px',
          data: {
            title: 'Keine Testtaker gefunden',
            content:
              'Es wurden keine Testtaker-Dateien gefunden. Möchten Sie eine automatisch generierte Testtaker-Datei erstellen?',
            confirmButtonLabel: 'Ja',
            showCancel: true
          }
        });

        confirmRef.afterClosed().subscribe(result => {
          if (result === true) {
            this.isLoading = true;
            this.fileService
              .createDummyTestTakerFile(this.appService.selectedWorkspaceId)
              .subscribe({
                next: success => {
                  this.isLoading = false;
                  if (success) {
                    this.snackBar.open(
                      'Testtaker-Datei wurde erfolgreich erstellt.',
                      'OK',
                      { duration: 3000 }
                    );
                    this.loadTestFiles();
                    setTimeout(() => {
                      this.validateFiles();
                    }, 1000);
                  } else {
                    this.snackBar.open(
                      'Fehler beim Erstellen der Testtaker-Datei.',
                      this.translate.instant('error'),
                      { duration: 3000 }
                    );
                  }
                },
                error: () => {
                  this.isLoading = false;
                  this.snackBar.open(
                    'Fehler beim Erstellen der Testtaker-Datei.',
                    this.translate.instant('error'),
                    { duration: 3000 }
                  );
                }
              });
          } else {
            this.snackBar.open('Keine Testtaker-Dateien vorhanden.', 'OK', {
              duration: 3000
            });

            const validationResults = (res.validationResults || []).filter(
              v => !!v?.testTaker
            );
            if (validationResults.length > 0) {
              const dialogRef = this.dialog.open(FilesValidationDialogComponent, {
                width: '90%',
                maxWidth: '1400px',
                height: '80vh',
                data: {
                  validationResults,
                  filteredTestTakers: res.filteredTestTakers,
                  unusedTestFiles: res.unusedTestFiles,
                  workspaceId: this.appService.selectedWorkspaceId
                }
              });

              dialogRef.afterClosed().subscribe((dialogResult: boolean) => {
                if (dialogResult) {
                  this.loadTestFiles();
                }
              });
            }
          }
        });
      } else {
        const dialogRef = this.dialog.open(FilesValidationDialogComponent, {
          width: '90%',
          maxWidth: '1400px',
          height: '80vh',
          data: {
            validationResults: (res.validationResults || []).filter(
              v => !!v?.testTaker
            ),
            filteredTestTakers: res.filteredTestTakers,
            unusedTestFiles: res.unusedTestFiles,
            workspaceId: this.appService.selectedWorkspaceId
          }
        });

        dialogRef.afterClosed().subscribe((result: boolean) => {
          if (result) {
            this.loadTestFiles();
          }
        });
      }
    }
  }

  openResourcePackagesDialog(): void {
    const dialogRef = this.dialog.open(ResourcePackagesDialogComponent, {
      width: '90%',
      maxWidth: '1200px',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.resourcePackagesModified = true;
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.page = event.pageIndex + 1;
    this.limit = event.pageSize;
    this.tableCheckboxSelection.clear();
    this.loadTestFiles();
  }

  showFileContent(file: FilesInListDto): void {
    this.fileService
      .downloadFile(this.appService.selectedWorkspaceId, file.id)
      .subscribe(fileData => {
        const decodedContent = atob(fileData.base64Data);

        if (
          file.file_type === 'Resource' &&
          file.filename.toLowerCase().endsWith('.vocs')
        ) {
          const dialogRef = this.dialog.open(SchemeEditorDialogComponent, {
            width: '100vw',
            height: '90vh',
            data: {
              workspaceId: this.appService.selectedWorkspaceId,
              fileId: file.id,
              fileName: file.filename,
              content: decodedContent
            }
          });

          dialogRef.afterClosed().subscribe(result => {
            if (result === true) {
              this.loadTestFiles();
            }
          });
        } else {
          this.dialog.open(ContentDialogComponent, {
            width: '800px',
            height: '800px',
            data: {
              title: file.filename,
              content: decodedContent
            }
          });
        }
      });
  }

  protected readonly getFileIcon = getFileIcon;
}
