import {
  Component, DestroyRef, OnDestroy, OnInit, inject, signal, computed
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService, TranslateModule } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { FormsModule } from '@angular/forms';
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
import { HttpEventType, HttpResponse } from '@angular/common/http';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { MatProgressBar } from '@angular/material/progress-bar';
import {
  of,
  Subject,
  Subscription,
  timer
} from 'rxjs';
import {
  debounceTime,
  filter,
  finalize,
  switchMap,
  take,
  takeUntil,
  tap
} from 'rxjs/operators';
import {
  MatPaginator,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import { MetadataResolver } from '@iqb/metadata-resolver';
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
import {
  deduplicateTestFilesUploadFailedFiles,
  TestFilesUploadResultDialogComponent,
  TestFilesUploadResultDialogData
} from './test-files-upload-result-dialog.component';
import {
  TestFilesZipExportOptions,
  TestFilesZipExportOptionsDialogComponent
} from './test-files-zip-export-options-dialog.component';
import { getFileIcon, getFileTypeLabel } from '../../utils/file-utils';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { Result } from '../../../shared/services/file/import.service';
import { MetadataDialogComponent, VomdMetadata } from '../../../shared/dialogs/metadata-dialog/metadata-dialog.component';
import {
  GithubReleasesDialogComponent
} from '../github-releases-dialog/github-releases-dialog.component';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';
import { ContentPoolIntegrationService } from '../../services/content-pool-integration.service';
import { ContentPoolSettings } from '../../models/content-pool.model';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { hasInvalidRegexFilter } from '../../../shared/utils/regex-filter.util';
import {
  ContentPoolImportDialogComponent,
  ContentPoolImportDialogResult
} from '../content-pool-import-dialog/content-pool-import-dialog.component';
import {
  ContentPoolUploadDialogComponent,
  ContentPoolUploadDialogResult
} from '../content-pool-upload-dialog/content-pool-upload-dialog.component';

const VALIDATION_TASK_POLL_INTERVAL_MS = 300;

type ValidationProgressStep = {
  threshold: number;
  label: string;
};

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
    MatProgressBar,
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
  private contentPoolIntegrationService = inject(ContentPoolIntegrationService);
  private validationService = inject(ValidationService);
  private readonly destroyRef = inject(DestroyRef);
  private workspaceSettingsService = inject(WorkspaceSettingsService);

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
  readonly isLoading = signal(false);
  readonly isValidating = signal(false);
  readonly isDownloadingAllFiles = signal(false);
  readonly isLoadingContentPoolConfig = signal(false);
  readonly isDeleting = signal(false);
  readonly isUploading = signal(false);
  readonly downloadProgressPercent = signal(0);
  readonly downloadProgressLoadedBytes = signal(0);
  readonly downloadProgressTotalBytes = signal(0);
  readonly downloadProgressStatus = signal<'preparing' | 'downloading'>('preparing');
  readonly validationProgress = signal(0);
  readonly validationProgressMessage = signal('');
  readonly validationProgressSteps: ValidationProgressStep[] = [
    { threshold: 0, label: 'Änderungen prüfen' },
    { threshold: 3, label: 'Vorbereiten' },
    { threshold: 8, label: 'Ausschlüsse laden' },
    { threshold: 12, label: 'Booklets analysieren' },
    { threshold: 22, label: 'Aufgabenreferenzen' },
    { threshold: 30, label: 'Ressourcen laden' },
    { threshold: 38, label: 'XML-Schemata' },
    { threshold: 48, label: 'Kodierschemata' },
    { threshold: 55, label: 'TestTakers verarbeiten' },
    { threshold: 84, label: 'Unbenutzte Dateien' },
    { threshold: 88, label: 'Doppelte TestTaker' },
    { threshold: 90, label: 'Personenstatus' },
    { threshold: 92, label: 'GeoGebra-Aufgaben' },
    { threshold: 94, label: 'GeoGebra-Paket' },
    { threshold: 98, label: 'Ergebnis vorbereiten' },
    { threshold: 100, label: 'Abgeschlossen' }
  ];

  readonly selectedFileType = signal<string>('');
  readonly selectedFileSize = signal<string>('');
  readonly enableRegexSearch = signal(false);
  readonly fileTypes = signal<string[]>([]);
  fileSizeRanges: { value: string; display: string }[] = [
    { value: '', display: 'Alle Größen' },
    { value: '0-10KB', display: '< 10KB' },
    { value: '10KB-100KB', display: '10KB - 100KB' },
    { value: '100KB-1MB', display: '100KB - 1MB' },
    { value: '1MB-10MB', display: '1MB - 10MB' },
    { value: '10MB+', display: '> 10MB' }
  ];

  getFileTypeLabel = getFileTypeLabel;

  readonly resourcePackagesModified = signal(false);
  readonly contentPoolSettings = signal<ContentPoolSettings>({
    enabled: false,
    baseUrl: '',
    hasApplicationToken: false
  });

  readonly textFilterValue = signal<string>('');

  private textFilterChanged: Subject<string> = new Subject<string>();
  private textFilterSubscription: Subscription | undefined;
  private fileListSubscription: Subscription | undefined;

  readonly page = signal<number>(1);
  readonly limit = signal<number>(100);
  readonly total = signal<number>(0);

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.workspaceSettingsService
      .getEnableRegexSearch(workspaceId)
      .pipe(
        takeUntil(this.appService.selectedWorkspaceId$.pipe(filter(id => id !== workspaceId))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(enabled => {
        const modeChanged = this.enableRegexSearch() !== enabled;
        this.enableRegexSearch.set(enabled);
        if (modeChanged && this.textFilterValue()) {
          this.fileListSubscription?.unsubscribe();
          this.applyFilters();
        }
      });
    this.loadTestFiles();
    this.loadContentPoolSettings();
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

  readonly isBusy = computed<boolean>(() => (
    this.isDeleting() ||
      this.isUploading() ||
      this.isDownloadingAllFiles() ||
      this.isValidating() ||
      this.isLoading()
  ));

  get busyText(): string {
    if (this.isDeleting()) {
      return 'Datei(en) werden gelöscht...';
    }
    if (this.isDownloadingAllFiles()) {
      if (this.downloadProgressStatus() === 'preparing') {
        return 'ZIP-Datei wird vorbereitet...';
      }

      const totalText = this.downloadProgressTotalBytes() > 0 ?
        ` / ${this.formatBytes(this.downloadProgressTotalBytes())}` :
        '';
      return `ZIP-Download: ${this.downloadProgressPercent()}% (${this.formatBytes(this.downloadProgressLoadedBytes())}${totalText})`;
    }
    if (this.isValidating()) {
      return this.validationProgressMessage() ||
        'Validierung wird durchgeführt...';
    }
    if (this.isUploading()) {
      return 'Datei(en) werden hochgeladen...';
    }
    if (this.isLoading()) {
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
    if (this.isTextFilterRegexInvalid()) {
      return;
    }

    this.fileListSubscription?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading.set(true);

    this.fileListSubscription = this.fileService
      .getFilesList(
        workspaceId,
        this.page(),
        this.limit(),
        this.selectedFileType(),
        this.selectedFileSize(),
        this.textFilterValue(),
        this.enableRegexSearch()
      )
      .pipe(
        takeUntil(this.appService.selectedWorkspaceId$.pipe(filter(id => id !== workspaceId))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isLoading.set(false);
        })
      )
      .subscribe({
        next: response => {
          this.total.set(response.total);
          this.page.set(response.page);
          this.limit.set(response.limit);
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
    this.fileTypes.set(files.fileTypes);
  }

  applyFilters(): void {
    if (this.isTextFilterRegexInvalid()) {
      return;
    }

    this.page.set(1);
    this.tableCheckboxSelection.clear();
    this.loadTestFiles();
  }

  onTextFilterChange(value: string): void {
    this.textFilterValue.set(value.trim());
    if (this.isTextFilterRegexInvalid()) {
      return;
    }
    this.textFilterChanged.next(this.textFilterValue());
  }

  clearFilters(): void {
    this.textFilterValue.set('');
    this.selectedFileType.set('');
    this.selectedFileSize.set('');
    this.applyFilters();
  }

  isTextFilterRegexInvalid(): boolean {
    return hasInvalidRegexFilter(this.textFilterValue(), this.enableRegexSearch());
  }

  private loadContentPoolSettings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoadingContentPoolConfig.set(true);
    this.contentPoolIntegrationService
      .getWorkspaceConfig(workspaceId)
      .pipe(
        takeUntil(this.appService.selectedWorkspaceId$.pipe(filter(id => id !== workspaceId))),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isLoadingContentPoolConfig.set(false);
        })
      )
      .subscribe({
        next: settings => {
          this.contentPoolSettings.set({
            enabled: !!settings.enabled,
            baseUrl: (settings.baseUrl || '').trim(),
            hasApplicationToken: !!settings.hasApplicationToken
          });
        },
        error: () => {
          this.contentPoolSettings.set({
            enabled: false,
            baseUrl: '',
            hasApplicationToken: false
          });
        }
      });
  }

  canUploadSelectedFilesToContentPool(): boolean {
    return Boolean(
      !this.isLoadingContentPoolConfig() &&
      this.contentPoolSettings().enabled &&
      this.contentPoolSettings().baseUrl &&
      this.contentPoolSettings().hasApplicationToken &&
      this.tableCheckboxSelection.selected.length > 0
    );
  }

  openContentPoolUploadDialogForSelectedFiles(): void {
    if (!this.contentPoolSettings().enabled) {
      this.snackBar.open(
        'Die Content-Pool-Integration ist aktuell deaktiviert.',
        'OK',
        { duration: 3000 }
      );
      return;
    }

    if (!this.contentPoolSettings().baseUrl) {
      this.snackBar.open(
        'In den Systemeinstellungen ist keine Content-Pool URL hinterlegt.',
        'OK',
        { duration: 4000 }
      );
      return;
    }

    if (!this.contentPoolSettings().hasApplicationToken) {
      this.snackBar.open(
        'In den Systemeinstellungen ist kein Content-Pool Application-Token hinterlegt.',
        'OK',
        { duration: 4000 }
      );
      return;
    }

    if (this.tableCheckboxSelection.selected.length === 0) {
      this.snackBar.open('Bitte mindestens eine Datei auswählen.', 'OK', {
        duration: 3000
      });
      return;
    }

    const ref = this.dialog.open(ContentPoolUploadDialogComponent, {
      width: '760px',
      maxWidth: '95vw',
      data: {
        workspaceId: this.appService.selectedWorkspaceId,
        files: this.tableCheckboxSelection.selected.map(file => ({
          id: file.id,
          filename: file.filename
        })),
        settings: this.contentPoolSettings()
      }
    });

    ref.afterClosed().subscribe(
      (payload?: ContentPoolUploadDialogResult | { success: false }) => {
        if (!payload?.success) {
          return;
        }

        this.handleContentPoolUploadResult(payload);
      }
    );
  }

  openContentPoolImportDialog(): void {
    if (!this.contentPoolSettings().enabled) {
      this.snackBar.open(
        'Die Content-Pool-Integration ist aktuell deaktiviert.',
        'OK',
        { duration: 3000 }
      );
      return;
    }

    if (!this.contentPoolSettings().baseUrl) {
      this.snackBar.open(
        'In den Systemeinstellungen ist keine Content-Pool URL hinterlegt.',
        'OK',
        { duration: 4000 }
      );
      return;
    }

    if (!this.contentPoolSettings().hasApplicationToken) {
      this.snackBar.open(
        'In den Systemeinstellungen ist kein Content-Pool Application-Token hinterlegt.',
        'OK',
        { duration: 4000 }
      );
      return;
    }

    const ref = this.dialog.open(ContentPoolImportDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: {
        workspaceId: this.appService.selectedWorkspaceId,
        settings: this.contentPoolSettings()
      }
    });

    ref.afterClosed().subscribe(
      (payload?: ContentPoolImportDialogResult | { success: false }) => {
        if (!payload?.success) {
          return;
        }

        this.handleContentPoolImportResult(payload);
      }
    );
  }

  private handleContentPoolImportResult(
    payload: ContentPoolImportDialogResult
  ): void {
    const result = payload.result;
    this.showUploadSummary(result);

    const conflicts = result.conflicts || [];
    const uploadedFiles = result.uploadedFiles || [];
    const failedFiles = result.failedFiles || [];
    const attempted = result.total;
    if (conflicts.length === 0) {
      this.openUploadResultDialog({
        workspaceId: this.appService.selectedWorkspaceId,
        attempted,
        uploadedFiles,
        failedFiles,
        remainingConflicts: [],
        issues: result.issues
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
        this.isLoading.set(true);
        this.isUploading.set(true);
        const overwriteSelectedCount = (resultChoice.overwriteFileIds || [])
          .length;
        this.contentPoolIntegrationService
          .importAcp(this.appService.selectedWorkspaceId, {
            acpId: payload.acpId,
            overwriteExisting: true,
            overwriteFileIds: resultChoice.overwriteFileIds
          })
          .pipe(
            finalize(() => {
              this.isLoading.set(false);
              this.isUploading.set(false);
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
              const finalIssues = [
                ...(result.issues || []),
                ...(overwriteResult.issues || [])
              ];

              this.openUploadResultDialog({
                workspaceId: this.appService.selectedWorkspaceId,
                attempted,
                overwriteSelectedCount,
                uploadedFiles: finalUploadedFiles,
                failedFiles: finalFailedFiles,
                remainingConflicts,
                issues: finalIssues.length ? finalIssues : undefined
              });
              this.onUploadSuccess();
            },
            error: () => {
              this.snackBar.open(
                'Fehler beim Überschreiben der Dateien aus dem Content Pool.',
                this.translate.instant('error'),
                { duration: 3000 }
              );
            }
          });
      } else {
        this.openUploadResultDialog({
          workspaceId: this.appService.selectedWorkspaceId,
          attempted,
          uploadedFiles,
          failedFiles,
          remainingConflicts: conflicts,
          issues: result.issues
        });
        this.onUploadSuccess();
      }
    });
  }

  private handleContentPoolUploadResult(
    payload: ContentPoolUploadDialogResult
  ): void {
    const result = payload.result;
    const versionInfo = result.versionNumber ?
      `, Version ${result.versionNumber}` :
      '';
    const skippedInfo = result.skipped > 0 ?
      `, übersprungen: ${result.skipped}` :
      '';
    const failedInfo = result.failed > 0 ?
      `, fehlgeschlagen: ${result.failed}` :
      '';

    this.snackBar.open(
      `Content-Pool-Upload abgeschlossen: ${result.replaced} ersetzt${skippedInfo}${failedInfo}${versionInfo}`,
      'OK',
      { duration: 6000 }
    );

    if (result.skippedFiles.length > 0 || result.failedFiles.length > 0) {
      const details = [
        ...result.skippedFiles.map(file => (
          `Übersprungen: ${file.filename} (${file.reason || 'kein Treffer'})`
        )),
        ...result.failedFiles.map(file => (
          `Fehlgeschlagen: ${file.filename} (${file.reason || 'Fehler'})`
        ))
      ].join('\n');

      this.dialog.open(ContentDialogComponent, {
        width: '760px',
        maxWidth: '95vw',
        data: {
          title: 'Content-Pool-Upload Ergebnis',
          content: details
        }
      });
    }
  }

  private showUploadSummary(result: TestFilesUploadResultDto): void {
    const conflicts = result.conflicts || [];
    const conflictInfo =
      conflicts.length > 0 ? `, Konflikte: ${conflicts.length}` : '';
    const failedCount =
      result.failedFiles && result.failedFiles.length > 0 ?
        deduplicateTestFilesUploadFailedFiles(result.failedFiles).length :
        result.failed;
    this.snackBar.open(
      `Upload abgeschlossen: ${result.uploaded} erfolgreich, ${failedCount} fehlgeschlagen${conflictInfo}`,
      'OK',
      { duration: 5000 }
    );
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
        workspaceId,
        attempted,
        uploadedFiles,
        failedFiles,
        remainingConflicts: [],
        issues: result.issues
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
        this.isLoading.set(true);
        this.isUploading.set(true);
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
              this.isLoading.set(false);
              this.isUploading.set(false);
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
              const finalIssues = [
                ...(result.issues || []),
                ...(overwriteResult.issues || [])
              ];

              this.openUploadResultDialog({
                workspaceId,
                attempted,
                overwriteSelectedCount,
                uploadedFiles: finalUploadedFiles,
                failedFiles: finalFailedFiles,
                remainingConflicts,
                issues: finalIssues.length ? finalIssues : undefined
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
          workspaceId,
          attempted,
          uploadedFiles,
          failedFiles,
          remainingConflicts: conflicts,
          issues: result.issues
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
      this.isLoading.set(true);
      this.isUploading.set(true);
      const workspaceId = this.appService.selectedWorkspaceId;
      this.fileService
        .uploadTestFiles(workspaceId, files, false)
        .pipe(
          finalize(() => {
            this.isLoading.set(false);
            this.isUploading.set(false);
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
    this.isLoading.set(false);
    this.isUploading.set(false);
    this.isValidating.set(false);
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
          workspaceId: this.appService.selectedWorkspaceId,
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
          issues: detailed?.issues || r.issues
        } as TestFilesUploadResultDialogData);

        this.onUploadSuccess();
        return;
      }

      if (result) {
        this.loadTestFiles();
      }
    });
  }

  deleteFiles(): void {
    const fileIds = this.tableCheckboxSelection.selected.map(file => file.id);
    this.isDeleting.set(true);
    this.fileService
      .deleteFilesWithResult(this.appService.selectedWorkspaceId, fileIds)
      .pipe(
        finalize(() => {
          this.isDeleting.set(false);
        })
      )
      .subscribe({
        next: result => {
          this.handleDeleteResponse(result.success, result.requestHandled);
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
          const decodedString = base64ToUtf8(res.base64Data);
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
        availableFileTypes: this.fileTypes() || [],
        selectedFileTypes: this.fileTypes() || []
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

      this.isDownloadingAllFiles.set(true);
      this.downloadProgressPercent.set(0);
      this.downloadProgressLoadedBytes.set(0);
      this.downloadProgressTotalBytes.set(0);
      this.downloadProgressStatus.set('preparing');
      this.fileBackendService
        .downloadWorkspaceFilesAsZipWithProgress(
          this.appService.selectedWorkspaceId,
          result.fileTypes
        )
        .subscribe({
          next: event => {
            if (event.type === HttpEventType.DownloadProgress) {
              this.downloadProgressStatus.set('downloading');
              this.downloadProgressLoadedBytes.set(event.loaded);
              this.downloadProgressTotalBytes.set(event.total || 0);
              this.downloadProgressPercent.set(event.total && event.total > 0 ?
                Math.min(100, Math.round((event.loaded / event.total) * 100)) :
                0);
              return;
            }

            if (event instanceof HttpResponse) {
              const blob = event.body;
              if (!blob) {
                throw new Error('Leere ZIP-Antwort erhalten.');
              }

              const url = window.URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = `workspace-${this.appService.selectedWorkspaceId}-files.zip`;
              document.body.appendChild(anchor);
              anchor.click();
              document.body.removeChild(anchor);
              window.URL.revokeObjectURL(url);
              this.downloadProgressPercent.set(100);
              this.downloadProgressLoadedBytes.set(blob.size);
              this.downloadProgressTotalBytes.set(blob.size);
              this.isDownloadingAllFiles.set(false);

              this.snackBar.open(
                'ZIP-Datei wurde erfolgreich heruntergeladen.',
                'OK',
                { duration: 3000 }
              );
            }
          },
          error: () => {
            this.isDownloadingAllFiles.set(false);
            this.snackBar.open(
              'Fehler beim Herunterladen der ZIP-Datei.',
              'OK',
              { duration: 3000 }
            );
          }
        });
    });
  }

  readonly downloadProgressValue = computed<number>(() => (this.downloadProgressStatus() === 'downloading' ?
    this.downloadProgressPercent() :
    0));

  readonly isDownloadProgressIndeterminate = computed<boolean>(() => (
    this.isDownloadingAllFiles() &&
      this.downloadProgressStatus() === 'preparing'
  ));

  readonly busyProgressValue = computed<number>(() => (this.isValidating() ?
    this.validationProgress() :
    this.downloadProgressValue()));

  readonly isBusyProgressIndeterminate = computed<boolean>(() => (this.isValidating() ? false : this.isDownloadProgressIndeterminate()));

  get completedValidationStepCount(): number {
    return this.validationProgressSteps.filter(
      step => this.isValidationStepComplete(step)
    ).length;
  }

  isValidationStepComplete(step: ValidationProgressStep): boolean {
    if (this.validationProgress() >= 100) {
      return true;
    }
    return this.validationProgress() > step.threshold;
  }

  isValidationStepActive(index: number): boolean {
    const step = this.validationProgressSteps[index];
    const nextStep = this.validationProgressSteps[index + 1];
    return this.validationProgress() >= step.threshold &&
      (!nextStep || this.validationProgress() < nextStep.threshold);
  }

  private formatBytes(bytes: number): string {
    if (!bytes || bytes < 0) {
      return '0 B';
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  validateFiles(): void {
    if (this.isValidating()) return;
    this.isValidating.set(true);
    this.validationProgress.set(0);
    this.validationProgressMessage.set('Testdateien werden auf Änderungen geprüft...');

    const workspaceId = this.appService.selectedWorkspaceId;

    this.validationService
      .createValidationTask(workspaceId, 'testFiles')
      .pipe(
        filter(() => this.appService.selectedWorkspaceId === workspaceId),
        switchMap(task => this.waitForValidationTask(workspaceId, task)),
        filter(() => this.appService.selectedWorkspaceId === workspaceId),
        switchMap(task => {
          if (task.status === 'failed') {
            throw new Error(task.error || 'Validierung fehlgeschlagen');
          }
          this.validationProgress.set(100);
          this.validationProgressMessage.set(task.progress_message || 'Validierungsergebnis wird geladen...');

          return this.validationService.getValidationResults(
            workspaceId,
            task.id
          );
        }),
        takeUntil(this.appService.selectedWorkspaceId$.pipe(
          filter(selectedWorkspaceId => selectedWorkspaceId !== workspaceId)
        )),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.isValidating.set(false);
        })
      )
      .subscribe({
        next: result => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          this.handleValidationResponse(result as FileValidationResultDto, workspaceId);
        },
        error: () => {
          if (this.appService.selectedWorkspaceId !== workspaceId) return;
          this.snackBar.open(
            this.translate.instant('ws-admin.validation-failed'),
            this.translate.instant('error'),
            { duration: 3000 }
          );
        }
      });
  }

  private waitForValidationTask(
    workspaceId: number,
    task: ValidationTaskDto
  ) {
    this.updateValidationProgress(task);
    if (task.status === 'completed' || task.status === 'failed') {
      return of(task);
    }

    return timer(0, VALIDATION_TASK_POLL_INTERVAL_MS).pipe(
      switchMap(() => this.validationService.getValidationTask(workspaceId, task.id)),
      tap(nextTask => this.updateValidationProgress(nextTask)),
      filter(nextTask => nextTask.status !== 'pending' && nextTask.status !== 'processing'),
      take(1)
    );
  }

  private updateValidationProgress(task: ValidationTaskDto): void {
    const progress = task.progress ?? 0;
    this.validationProgress.set(Math.max(this.validationProgress(), progress));
    if (task.progress_message) {
      this.validationProgressMessage.set(`${this.validationProgress()}% - ${task.progress_message}`);
      return;
    }
    this.validationProgressMessage.set(this.validationProgress() >= 100 ?
      'Validierungsergebnis wird geladen...' :
      `Validierung wird durchgeführt (${this.validationProgress()}%)...`);
  }

  private handleDeleteResponse(
    success: boolean,
    requestHandled: boolean
  ): void {
    this.snackBar.open(
      success ?
        this.translate.instant('ws-admin.files-deleted') :
        this.translate.instant('ws-admin.files-not-deleted'),
      success ? '' : this.translate.instant('error'),
      { duration: 1000 }
    );
    if (requestHandled) {
      this.tableCheckboxSelection.clear();
      this.loadTestFiles();
    }
  }

  private handleValidationResponse(
    res: boolean | FileValidationResultDto,
    workspaceId = this.appService.selectedWorkspaceId
  ): void {
    const workspaceChanged$ = this.appService.selectedWorkspaceId$.pipe(
      filter(selectedWorkspaceId => selectedWorkspaceId !== workspaceId)
    );
    this.isValidating.set(false);
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

        confirmRef.afterClosed().pipe(
          takeUntil(workspaceChanged$),
          takeUntilDestroyed(this.destroyRef)
        ).subscribe(result => {
          if (result === true) {
            this.isLoading.set(true);

            let creationPending = true;
            this.fileService
              .createDummyTestTakerFile(workspaceId)
              .pipe(
                takeUntil(workspaceChanged$),
                takeUntilDestroyed(this.destroyRef),
                finalize(() => {
                  if (creationPending) this.isLoading.set(false);
                })
              )
              .subscribe({
                next: success => {
                  creationPending = false;
                  this.isLoading.set(false);

                  if (success) {
                    this.snackBar.open(
                      'Testtaker-Datei wurde erfolgreich erstellt.',
                      'OK',
                      { duration: 3000 }
                    );
                    this.loadTestFiles();
                    timer(1000).pipe(
                      takeUntil(workspaceChanged$),
                      takeUntilDestroyed(this.destroyRef)
                    ).subscribe(() => this.validateFiles());
                  } else {
                    this.snackBar.open(
                      'Fehler beim Erstellen der Testtaker-Datei.',
                      this.translate.instant('error'),
                      { duration: 3000 }
                    );
                  }
                },
                error: () => {
                  creationPending = false;
                  this.isLoading.set(false);

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
                maxHeight: '95vh',
                panelClass: 'validation-dialog-container',
                data: {
                  validationResults,
                  filteredTestTakers: res.filteredTestTakers,
                  duplicateTestTakers: res.duplicateTestTakers,
                  unusedTestFiles: res.unusedTestFiles,
                  geogebra: res.geogebra,
                  workspaceId
                }
              });

              dialogRef.afterClosed().pipe(
                takeUntil(workspaceChanged$),
                takeUntilDestroyed(this.destroyRef)
              ).subscribe((dialogResult: boolean) => {
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
          maxHeight: '95vh',
          panelClass: 'validation-dialog-container',
          data: {
            validationResults: (res.validationResults || []).filter(
              v => !!v?.testTaker
            ),
            filteredTestTakers: res.filteredTestTakers,
            duplicateTestTakers: res.duplicateTestTakers,
            unusedTestFiles: res.unusedTestFiles,
            geogebra: res.geogebra,
            workspaceId
          }
        });

        dialogRef.afterClosed().pipe(
          takeUntil(workspaceChanged$),
          takeUntilDestroyed(this.destroyRef)
        ).subscribe((result: boolean) => {
          if (result) {
            this.loadTestFiles();
          }
        });
      }
    }
  }

  openResourcePackagesDialog(): void {
    const dialogRef = this.dialog.open(ResourcePackagesDialogComponent, {
      width: '94vw',
      maxWidth: '1440px',
      maxHeight: '94vh',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.resourcePackagesModified.set(true);
      }
    });
  }

  openGithubReleasesDialog(): void {
    const dialogRef = this.dialog.open(GithubReleasesDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.loadTestFiles();
      }
    });
  }

  onPageChange(event: PageEvent): void {
    this.page.set(event.pageIndex + 1);
    this.limit.set(event.pageSize);
    this.tableCheckboxSelection.clear();
    this.loadTestFiles();
  }

  showFileContent(file: FilesInListDto): void {
    this.fileService
      .downloadFile(this.appService.selectedWorkspaceId, file.id)
      .subscribe(fileData => {
        const decodedContent = base64ToUtf8(fileData.base64Data);

        if (
          file.file_type === 'Resource' &&
          file.filename.toLowerCase().endsWith('.vocs')
        ) {
          const dialogRef = this.dialog.open(SchemeEditorDialogComponent, {
            width: '95vw',
            height: '95vh',
            maxWidth: '1400px',
            data: {
              workspaceId: this.appService.selectedWorkspaceId,
              fileId: file.id,
              fileName: file.filename,
              content: decodedContent
            },
            panelClass: 'scheme-editor-dialog-container'
          });

          dialogRef.afterClosed().subscribe(result => {
            if (result === true) {
              this.loadTestFiles();
            }
          });
        } else if (file.file_type === 'Resource' && file.filename.toLowerCase().endsWith('.vomd')) {
          this.openMetadataDialog(file, decodedContent);
        } else {
          const isXmlFile = this.isXmlFile(file.filename);
          const isJsonFile = this.isJsonFile(file.filename);

          this.dialog.open(ContentDialogComponent, {
            width: isXmlFile ? '82vw' : '800px',
            maxWidth: isXmlFile ? '1200px' : '80vw',
            height: isXmlFile ? '82vh' : '800px',
            maxHeight: isXmlFile ? '90vh' : undefined,
            data: {
              title: file.filename,
              content: decodedContent,
              isJson: isJsonFile,
              isXml: isXmlFile
            }
          });
        }
      });
  }

  private isXmlFile(filename: string): boolean {
    const lowerCaseFilename = filename.toLowerCase();

    return lowerCaseFilename.endsWith('.xml');
  }

  private isJsonFile(filename: string): boolean {
    const lowerCaseFilename = filename.toLowerCase();

    return lowerCaseFilename.endsWith('.json') || lowerCaseFilename.endsWith('.voud');
  }

  private async openMetadataDialog(file: FilesInListDto, decodedContent: string): Promise<void> {
    try {
      const vomdData = JSON.parse(decodedContent);

      const unitProfile = vomdData.profiles?.[0];
      if (!unitProfile) {
        this.snackBar.open('Keine Metadaten in der Datei gefunden', 'Schließen', {
          duration: 5000
        });
        return;
      }

      // Get item profile (from first item if exists)
      const firstItem = vomdData.items?.[0];
      const itemProfile = firstItem?.profiles?.[0];

      // Create resolver and load profiles with vocabularies
      const resolver = new MetadataResolver();

      // Load unit profile and vocabularies
      const unitProfileUrl = unitProfile.profileId;
      const unitProfileWithVocabs = await resolver.loadProfileWithVocabularies(unitProfileUrl);

      // Load item profile and vocabularies (if items exist)
      let itemProfileData = null;
      if (itemProfile) {
        const itemProfileUrl = itemProfile.profileId;
        const itemProfileWithVocabs = await resolver.loadProfileWithVocabularies(itemProfileUrl);
        itemProfileData = itemProfileWithVocabs.profile;

        // eslint-disable-next-line no-console
        console.log(`Loaded profiles: Unit + Items (${vomdData.items.length} items)`);
      } else {
        // eslint-disable-next-line no-console
        console.log('Loaded profile: Unit only (no items)');
      }

      const dialogRef = this.dialog.open(MetadataDialogComponent, {
        width: '1200px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        data: {
          title: file.filename,
          profileData: unitProfileWithVocabs.profile,
          itemProfileData: itemProfileData,
          metadataValues: vomdData,
          resolver: resolver,
          language: 'de',
          mode: 'readonly'
        }
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result) {
          this.saveMetadata(file, result);
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error parsing vomd file:', error);
      this.snackBar.open('Fehler beim Parsen der Metadaten-Datei', 'Schließen', {
        duration: 5000
      });
    }
  }

  private saveMetadata(originalFile: FilesInListDto, newMetadata: VomdMetadata): void {
    this.isLoading.set(true);
    const jsonContent = JSON.stringify(newMetadata, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/octet-stream' });
    const file = new File([blob], originalFile.filename, { type: 'application/octet-stream' });

    // Create a DataTransfer to simulate file selection
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    const files = dataTransfer.files;

    this.fileService.uploadTestFiles(
      this.appService.selectedWorkspaceId,
      files,
      true, // overwriteExisting
      [originalFile.filename]
    ).pipe(
      finalize(() => {
        this.isLoading.set(false);
      })
    ).subscribe({
      next: () => {
        this.snackBar.open('Metadaten erfolgreich gespeichert.', 'OK', { duration: 3000 });
        this.loadTestFiles();
      },
      error: () => {
        this.snackBar.open('Fehler beim Speichern der Metadaten.', 'Fehler', { duration: 3000 });
      }
    });
  }

  protected readonly getFileIcon = getFileIcon;
}
