import {
  Component, DestroyRef, OnDestroy, OnInit, inject, signal, computed, ChangeDetectionStrategy
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
  Subject,
  Subscription,
  timer
} from 'rxjs';
import {
  debounceTime,
  filter,
  finalize,
  switchMap,
  takeUntil
} from 'rxjs/operators';
import {
  MatPaginator,
  MatPaginatorIntl,
  PageEvent
} from '@angular/material/paginator';
import { MetadataResolver } from '@iqb/metadata-resolver';
import { FileValidationProgressFacade, ValidationProgressStep } from './file-validation-progress.facade';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
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
import { ContentPoolSettings } from '../../../shared/models/content-pool.model';
import { ValidationService } from '../../../shared/services/validation/validation.service';
import { ValidationTaskDto } from '../../../models/validation-task.dto';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { hasInvalidRegexFilter } from '../../../shared/utils/regex-filter.util';
import {
  ContentPoolImportDialogComponent,
  ContentPoolImportDialogResult
} from '../content-pool-import-dialog/content-pool-import-dialog.component';
import {
  ContentPoolUploadDialogComponent,
  ContentPoolUploadDialogResult
} from '../content-pool-upload-dialog/content-pool-upload-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-test-files',
  templateUrl: './test-files.component.html',
  styleUrls: ['./test-files.component.scss'],
  providers: [FileValidationProgressFacade, { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }],
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
  private readonly uiTranslate = injectUiTranslator();

  private readonly validationState = inject(FileValidationProgressFacade);

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

  protected displayedColumns: string[] = [
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
  protected readonly validationProgress = this.validationState.progress;
  protected readonly validationProgressMessage = this.validationState.message;
  protected get validationProgressSteps(): ValidationProgressStep[] { return this.validationState.steps(); }

  protected readonly selectedFileType = signal<string>('');
  protected readonly selectedFileSize = signal<string>('');
  readonly enableRegexSearch = signal(false);
  protected readonly fileTypes = signal<string[]>([]);
  private readonly localizedFileSizeRanges = computed<{ value: string; display: string }[]>(() => ([
    { value: '', display: this.uiTranslate('ui-text.test-files.alle-groessen') },
    { value: '0-10KB', display: this.uiTranslate('ui-text.test-files.10kb') },
    { value: '10KB-100KB', display: this.uiTranslate('ui-text.test-files.10kb-100kb') },
    { value: '100KB-1MB', display: this.uiTranslate('ui-text.test-files.100kb-1mb') },
    { value: '1MB-10MB', display: this.uiTranslate('ui-text.test-files.1mb-10mb') },
    { value: '10MB+', display: this.uiTranslate('ui-text.test-files.10mb') }
  ]));

  protected get fileSizeRanges(): { value: string; display: string }[] { return this.localizedFileSizeRanges(); }

  protected getFileTypeLabel = getFileTypeLabel.bind(undefined, this.uiTranslate);

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
  protected readonly limit = signal<number>(100);
  protected readonly total = signal<number>(0);

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
      return this.uiTranslate('ui-text.test-files.datei-en-werden-geloescht');
    }
    if (this.isDownloadingAllFiles()) {
      if (this.downloadProgressStatus() === 'preparing') {
        return this.uiTranslate('ui-text.test-files.zip-datei-wird-vorbereitet');
      }

      const totalText = this.downloadProgressTotalBytes() > 0 ?
        ` / ${this.formatBytes(this.downloadProgressTotalBytes())}` :
        '';
      return `ZIP-Download: ${this.downloadProgressPercent()}% (${this.formatBytes(this.downloadProgressLoadedBytes())}${totalText})`;
    }
    if (this.isValidating()) {
      return this.validationProgressMessage() ||
        this.uiTranslate('export-dialog.validation.validation-running');
    }
    if (this.isUploading()) {
      return this.uiTranslate('ui-text.test-files.datei-en-werden-hochgeladen');
    }
    if (this.isLoading()) {
      return this.uiTranslate('ui-text.test-files.dateiliste-wird-geladen');
    }
    return '';
  }

  private isAllSelected(): boolean {
    const numSelected = this.tableCheckboxSelection.selected.length;
    const numRows = this.dataSource?.data.length || 0;
    return numSelected === numRows;
  }

  protected masterToggle(): void {
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
            this.uiTranslate('ui-text.test-files.fehler-beim-laden-der-dateiliste'),
            this.translate.instant('error.error_title'),
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

  protected onTextFilterChange(value: string): void {
    this.textFilterValue.set(value.trim());
    if (this.isTextFilterRegexInvalid()) {
      return;
    }
    this.textFilterChanged.next(this.textFilterValue());
  }

  protected clearFilters(): void {
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

  protected canUploadSelectedFilesToContentPool(): boolean {
    return Boolean(
      !this.isLoadingContentPoolConfig() &&
      this.contentPoolSettings().enabled &&
      this.contentPoolSettings().baseUrl &&
      this.contentPoolSettings().hasApplicationToken &&
      this.tableCheckboxSelection.selected.length > 0
    );
  }

  protected openContentPoolUploadDialogForSelectedFiles(): void {
    if (!this.contentPoolSettings().enabled) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-files.die-content-pool-integration-ist-aktuell-deaktiviert'),
        'OK',
        { duration: 3000 }
      );
      return;
    }

    if (!this.contentPoolSettings().baseUrl) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-files.in-den-systemeinstellungen-ist-keine-content-pool-url-hinterlegt'),
        'OK',
        { duration: 4000 }
      );
      return;
    }

    if (!this.contentPoolSettings().hasApplicationToken) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-files.in-den-systemeinstellungen-ist-kein-content-pool-application-token-hinterlegt'),
        'OK',
        { duration: 4000 }
      );
      return;
    }

    if (this.tableCheckboxSelection.selected.length === 0) {
      this.snackBar.open(this.uiTranslate('ui-text.test-files.bitte-mindestens-eine-datei-auswaehlen'), 'OK', {
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

    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
      (payload?: ContentPoolUploadDialogResult | { success: false }) => {
        if (!payload?.success) {
          return;
        }

        this.handleContentPoolUploadResult(payload);
      }
    );
  }

  protected openContentPoolImportDialog(): void {
    if (!this.contentPoolSettings().enabled) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-files.die-content-pool-integration-ist-aktuell-deaktiviert'),
        'OK',
        { duration: 3000 }
      );
      return;
    }

    if (!this.contentPoolSettings().baseUrl) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-files.in-den-systemeinstellungen-ist-keine-content-pool-url-hinterlegt'),
        'OK',
        { duration: 4000 }
      );
      return;
    }

    if (!this.contentPoolSettings().hasApplicationToken) {
      this.snackBar.open(
        this.uiTranslate('ui-text.test-files.in-den-systemeinstellungen-ist-kein-content-pool-application-token-hinterlegt'),
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

    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(
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

    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(resultChoice => {
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
          ).pipe(takeUntilDestroyed(this.destroyRef))
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
                this.uiTranslate('ui-text.test-files.fehler-beim-ueberschreiben-der-dateien-aus-dem-content-pool'),
                this.translate.instant('error.error_title'),
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
      this.uiTranslate('ui-text.test-files.uebersprungen', { skipped: result.skipped }) :
      '';
    const failedInfo = result.failed > 0 ?
      `, fehlgeschlagen: ${result.failed}` :
      '';

    this.snackBar.open(
      this.uiTranslate('ui-text.test-files.content-pool-upload-abgeschlossen-ersetzt', {
        replaced: result.replaced, skippedInfo: skippedInfo, failedInfo: failedInfo, versionInfo: versionInfo
      }),
      'OK',
      { duration: 6000 }
    );

    if (result.skippedFiles.length > 0 || result.failedFiles.length > 0) {
      const details = [
        ...result.skippedFiles.map(file => (
          this.uiTranslate('ui-text.test-files.uebersprungen-65f2ab', { filename: file.filename, value2: file.reason || this.uiTranslate('ui-text.test-files.kein-treffer') })
        )),
        ...result.failedFiles.map(file => (
          `Fehlgeschlagen: ${file.filename} (${file.reason || this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error')})`
        ))
      ].join('\n');

      this.dialog.open(ContentDialogComponent, {
        width: '760px',
        maxWidth: '95vw',
        data: {
          title: this.uiTranslate('ui-text.test-files.content-pool-upload-ergebnis'),
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
      this.uiTranslate('ui-text.test-files.upload-abgeschlossen-erfolgreich-fehlgeschlagen', { uploaded: result.uploaded, failedCount: failedCount, conflictInfo: conflictInfo }),
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

    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(resultChoice => {
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
          ).pipe(takeUntilDestroyed(this.destroyRef))
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
                this.uiTranslate('ui-text.test-files.fehler-beim-ueberschreiben-der-dateien'),
                this.translate.instant('error.error_title'),
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
        ).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: result => {
            this.handleUploadResult(workspaceId, files, result);
          },
          error: () => {
            this.snackBar.open(
              this.uiTranslate('ui-text.test-files.fehler-beim-hochladen-der-dateien'),
              this.translate.instant('error.error_title'),
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

  protected testCenterImport(): void {
    const dialogRef = this.dialog.open(TestCenterImportComponent, {
      width: '1000px',
      maxWidth: '95vw',
      minHeight: '800px',
      data: {
        importType: 'testFiles'
      }
    });
    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result: unknown) => {
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
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.handleDeleteResponse(result.success, result.requestHandled);
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('ws-admin.files-not-deleted'),
            this.translate.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  protected downloadFile(row: FilesInListDto): void {
    this.fileService
      .downloadFile(this.appService.selectedWorkspaceId, row.id).pipe(takeUntilDestroyed(this.destroyRef))
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

  protected downloadAllFilesAsZip(): void {
    const ref = this.dialog.open(TestFilesZipExportOptionsDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: {
        availableFileTypes: this.fileTypes() || [],
        selectedFileTypes: this.fileTypes() || []
      }
    });

    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result?: TestFilesZipExportOptions) => {
      if (!result) {
        return;
      }
      if (!result.fileTypes || result.fileTypes.length === 0) {
        this.snackBar.open(this.uiTranslate('ui-text.test-files.keine-dateitypen-ausgewaehlt'), 'OK', {
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
        ).pipe(takeUntilDestroyed(this.destroyRef))
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
                throw new Error(this.uiTranslate('ui-text.test-files.leere-zip-antwort-erhalten'));
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
                this.uiTranslate('ui-text.test-files.zip-datei-wurde-erfolgreich-heruntergeladen'),
                'OK',
                { duration: 3000 }
              );
            }
          },
          error: () => {
            this.isDownloadingAllFiles.set(false);
            this.snackBar.open(
              this.uiTranslate('ui-text.test-files.fehler-beim-herunterladen-der-zip-datei'),
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

  protected readonly busyProgressValue = computed<number>(() => (this.isValidating() ?
    this.validationProgress() :
    this.downloadProgressValue()));

  protected readonly isBusyProgressIndeterminate = computed<boolean>(() => (this.isValidating() ? false : this.isDownloadProgressIndeterminate()));

  protected get completedValidationStepCount(): number {
    return this.validationProgressSteps.filter(
      step => this.isValidationStepComplete(step)
    ).length;
  }

  protected isValidationStepComplete(step: ValidationProgressStep): boolean {
    if (this.validationProgress() >= 100) {
      return true;
    }
    return this.validationProgress() > step.threshold;
  }

  protected isValidationStepActive(index: number): boolean {
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

  protected validateFiles(): void {
    if (this.isValidating()) return;
    this.isValidating.set(true);
    this.validationState.start(this.uiTranslate('ui-text.files-validation.testdateien-werden-auf-aenderungen-geprueft'));

    const workspaceId = this.appService.selectedWorkspaceId;

    this.validationService
      .createValidationTask(workspaceId, 'testFiles')
      .pipe(
        filter(() => this.appService.selectedWorkspaceId === workspaceId),
        switchMap(task => this.waitForValidationTask(workspaceId, task)),
        filter(() => this.appService.selectedWorkspaceId === workspaceId),
        switchMap(task => {
          if (task.status === 'failed') {
            throw new Error(task.error || this.uiTranslate('ui-text.files-validation.validierung-fehlgeschlagen'));
          }
          this.validationState.finish(task.progress_message);

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
            this.translate.instant('error.error_title'),
            { duration: 3000 }
          );
        }
      });
  }

  private waitForValidationTask(
    workspaceId: number,
    task: ValidationTaskDto
  ) { return this.validationState.watch(workspaceId, task); }

  private updateValidationProgress(task: ValidationTaskDto): void { this.validationState.accept(task); }

  private handleDeleteResponse(
    success: boolean,
    requestHandled: boolean
  ): void {
    this.snackBar.open(
      success ?
        this.translate.instant('ws-admin.files-deleted') :
        this.translate.instant('ws-admin.files-not-deleted'),
      success ? '' : this.translate.instant('error.error_title'),
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
        this.translate.instant('error.error_title'),
        { duration: 3000 }
      );
    } else if (typeof res !== 'boolean') {
      if (!res.testTakersFound) {
        const confirmRef = this.dialog.open(ConfirmDialogComponent, {
          width: '400px',
          data: {
            title: this.uiTranslate('ui-text.test-files.keine-testtaker-gefunden'),
            content:
              this.uiTranslate('ui-text.test-files.es-wurden-keine-testtaker-dateien-gefunden-moechten-sie-eine-automatisch-generierte-testta'),
            confirmButtonLabel: this.uiTranslate('process-overview.values.yes'),
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
                      this.uiTranslate('ui-text.test-files.testtaker-datei-wurde-erfolgreich-erstellt'),
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
                      this.uiTranslate('ui-text.test-files.fehler-beim-erstellen-der-testtaker-datei'),
                      this.translate.instant('error.error_title'),
                      { duration: 3000 }
                    );
                  }
                },
                error: () => {
                  creationPending = false;
                  this.isLoading.set(false);

                  this.snackBar.open(
                    this.uiTranslate('ui-text.test-files.fehler-beim-erstellen-der-testtaker-datei'),
                    this.translate.instant('error.error_title'),
                    { duration: 3000 }
                  );
                }
              });
          } else {
            this.snackBar.open(this.uiTranslate('ui-text.test-files.keine-testtaker-dateien-vorhanden'), 'OK', {
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

  protected openResourcePackagesDialog(): void {
    const dialogRef = this.dialog.open(ResourcePackagesDialogComponent, {
      width: '94vw',
      maxWidth: '1440px',
      maxHeight: '94vh',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result === true) {
        this.resourcePackagesModified.set(true);
      }
    });
  }

  protected openGithubReleasesDialog(): void {
    const dialogRef = this.dialog.open(GithubReleasesDialogComponent, {
      width: '800px',
      maxWidth: '95vw',
      data: {
        workspaceId: this.appService.selectedWorkspaceId
      }
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
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
      .downloadFile(this.appService.selectedWorkspaceId, file.id).pipe(takeUntilDestroyed(this.destroyRef))
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

          dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
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
        this.snackBar.open(this.uiTranslate('ui-text.test-files.keine-metadaten-in-der-datei-gefunden'), this.uiTranslate('deferred-view.close'), {
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
          mode: 'edit'
        }
      });

      dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
        if (result) {
          this.saveMetadata(file, result);
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error parsing vomd file:', error);
      this.snackBar.open(this.uiTranslate('ui-text.test-files.fehler-beim-parsen-der-metadaten-datei'), this.uiTranslate('deferred-view.close'), {
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
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.snackBar.open(this.uiTranslate('ui-text.test-files.metadaten-erfolgreich-gespeichert'), 'OK', { duration: 3000 });
        this.loadTestFiles();
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.test-files.fehler-beim-speichern-der-metadaten'), this.uiTranslate('ws-admin.export-options.item-dataset-diagnostics-severity-error'), { duration: 3000 });
      }
    });
  }

  protected readonly getFileIcon = getFileIcon;
}
