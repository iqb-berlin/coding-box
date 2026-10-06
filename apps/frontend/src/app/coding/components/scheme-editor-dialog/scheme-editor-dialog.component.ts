import {
  Component, OnInit, DestroyRef, inject, signal, computed, ChangeDetectionStrategy
} from '@angular/core';
import { TranslateService, TranslateModule } from '@ngx-translate/core';

import {
  MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogTitle, MatDialogContent, MatDialogActions
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  of, catchError, finalize, map, switchMap, take, takeUntil
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDivider } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { selectSchemerFile } from '../../utils/coding-scheme-reference';
import { UnitCodingSchemeRefDto } from '../../../../../../../api-dto/unit-info/unit-coding-scheme-ref.dto';
import { StandaloneUnitSchemerComponent } from '../schemer/unit-schemer.component';
import { UnitScheme } from '../schemer/unit-scheme.interface';
import { FileService } from '../../../shared/services/file/file.service';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';
import { TestResultsUploadIssueDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';

import { ConfirmDialogComponent } from '../../../shared/dialogs/confirm-dialog.component';

export interface SchemeEditorDialogData {
  workspaceId: number;
  fileId: string;
  fileName: string;
  content: string;
  readOnly?: boolean;
  codingSchemeRef?: UnitCodingSchemeRefDto;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-scheme-editor-dialog',
  standalone: true,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatDivider,
    MatProgressSpinnerModule,
    TranslateModule,
    StandaloneUnitSchemerComponent
  ],
  template: `
    <h2 mat-dialog-title>{{ data.fileName }}</h2>
    <mat-dialog-content>
      @if (isLoading()) {
        <mat-spinner diameter="40" [attr.aria-label]="'coding.schemer.loading' | translate"></mat-spinner>
      } @else if (schemerHtml()) {
        <coding-box-unit-schemer
          [schemerHtml]="schemerHtml()"
          [unitScheme]="unitScheme()"
          [schemerConfig]="{ definitionReportPolicy: 'eager', role: data.readOnly ? 'viewer' : 'editor' }"
          (schemeChanged)="onSchemeChanged($event)"
          (schemerError)="onError($event)">
        </coding-box-unit-schemer>
      } @else {
        @if (loadError()) {
          <p role="alert">{{ loadError() }}</p>
        }
        <pre class="raw-json">{{ prettyScheme() }}</pre>
      }
    </mat-dialog-content>
    <mat-divider></mat-divider>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">{{ 'close' | translate }}</button>
      @if (!data.readOnly) {
        <button mat-button color="primary" [disabled]="!hasChanges()" (click)="save()">{{ 'save' | translate }}</button>
      }
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    mat-dialog-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      padding: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
    }

    coding-box-unit-schemer {
      display: block;
      height: 100%;
      width: 100%;
    }

    mat-spinner {
      margin: auto;
    }

    .raw-json {
      flex: 1;
      min-height: 0;
      width: 100%;
      box-sizing: border-box;
      margin: 0;
      padding: 12px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    mat-dialog-actions {
      margin: 0 !important;
      padding: 0 !important;
    }
  `]
})
export class SchemeEditorDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<SchemeEditorDialogComponent>>(MatDialogRef);
  protected data = inject<SchemeEditorDialogData>(MAT_DIALOG_DATA);
  private snackBar = inject(MatSnackBar);
  private fileService = inject(FileService);
  private translate = inject(TranslateService);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  private readonly destroyRef = inject(DestroyRef);
  protected readonly loadError = signal('');
  readonly schemerHtml = signal('');
  readonly isLoading = signal(true);
  readonly hasChanges = signal(false);

  readonly unitScheme = signal<UnitScheme>({
    scheme: '',
    schemeType: 'iqb-standard@3.2'
  });

  readonly prettyScheme = computed<string>(() => {
    const raw = this.unitScheme()?.scheme ?? '';
    if (!raw) return '';
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return raw.toString?.() ?? String(raw);
    }
  });

  ngOnInit(): void {
    this.unitScheme.set({
      scheme: this.data.content,
      schemeType: this.data.codingSchemeRef?.schemeType || this.inferSchemeType()
    });
    this.loadSchemerHtml();
    this.fileService.getVariableInfoForScheme(this.data.workspaceId, this.data.fileName)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: variables => {
          if (variables && variables.length > 0) {
            this.unitScheme.set({
              ...this.unitScheme(),
              variables
            });
          }
        },
        error: () => {
          this.snackBar.open(
            this.translate.instant('coding.schemer.load-error'),
            'OK',
            { duration: 5000 }
          );
        }
      });
  }

  private inferSchemeType(): string {
    try {
      const { version } = JSON.parse(this.data.content);
      if (typeof version === 'string' && /^\d+\.\d+$/.test(version)) return `iqb@${version}`;
    } catch {
      // Keep a readable preview for invalid or older schemes.
    }
    return 'iqb-standard@3.2';
  }

  loadSchemerHtml(): void {
    this.isLoading.set(true);
    this.loadError.set('');
    const reference$ = this.data.codingSchemeRef || !this.data.fileName.toLowerCase().endsWith('.vocs') ?
      of(this.data.codingSchemeRef) :
      this.fileService.getUnitInfo(this.data.workspaceId, this.data.fileName.replace(/\.vocs$/i, '').toUpperCase())
        .pipe(
          map(unit => (unit.codingSchemeRef?.content.toLowerCase() === this.data.fileName.toLowerCase() ?
            unit.codingSchemeRef : undefined)),
          catchError(() => of(undefined))
        );

    reference$.pipe(
      switchMap(reference => {
        if (reference?.schemeType) this.unitScheme.set({ ...this.unitScheme(), schemeType: reference.schemeType });
        return this.fileService.getFilesList(this.data.workspaceId, 1, 10000, 'Schemer').pipe(
          switchMap(response => {
            const file = selectSchemerFile(response.data || [], reference?.schemer);
            if (!file) {
              this.loadError.set(this.translate.instant('coding.schemer.not-found', { schemer: reference?.schemer || '' }));
              return of(null);
            }
            return this.fileService.downloadFile(this.data.workspaceId, file.id).pipe(
              catchError(() => {
                this.loadError.set(this.translate.instant('coding.schemer.download-error'));
                return of(null);
              })
            );
          })
        );
      }),
      catchError(() => {
        this.loadError.set(this.translate.instant('coding.schemer.fetch-error'));
        return of(null);
      }),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        this.isLoading.set(false);
      })
    ).subscribe(file => {
      if (file) {
        this.schemerHtml.set(base64ToUtf8(file.base64Data));
        if (!this.schemerHtml().trim()) {
          this.schemerHtml.set('');
          this.loadError.set(this.translate.instant('coding.schemer.decode-error'));
        }
      }
    });
  }

  onSchemeChanged(scheme: UnitScheme): void {
    if (this.data.readOnly) return;
    if (!scheme.variables && this.unitScheme().variables) {
      scheme.variables = this.unitScheme().variables;
    }
    this.unitScheme.set(scheme);
    this.hasChanges.set(true);
  }

  onError(error: string): void {
    this.snackBar.open(
      this.translate.instant('coding.schemer.schemer-error', { error }),
      'Error',
      { duration: 3000 }
    );
  }

  close(): void {
    if (this.hasChanges()) {
      const confirmRef = this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: {
          title: this.translate.instant('coding.schemer.unsaved-changes-title'),
          content: this.translate.instant('coding.schemer.unsaved-changes-content'),
          confirmButtonLabel: 'Ja',
          showCancel: true
        }
      });

      confirmRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
        if (result === true) {
          this.dialogRef.close(false);
        }
      });
    } else {
      this.dialogRef.close(false);
    }
  }

  save(): void {
    if (!this.hasChanges()) {
      this.dialogRef.close(false);
      return;
    }

    const schemeFilename = this.data.fileName;
    this.fileService.getFilesList(this.data.workspaceId, 1, 10000, 'Resource').pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: response => {
          const existingFile = response.data?.find(file => file.filename === schemeFilename && file.file_type === 'Resource');
          this.uploadSchemeFile(
            schemeFilename,
            !!existingFile,
            existingFile ? [schemeFilename] : undefined
          );
        },
        error: () => {
          this.snackBar.open('Failed to fetch files list', 'Error', { duration: 3000 });
        }
      });
  }

  private uploadSchemeFile(
    filename: string,
    overwriteExisting: boolean = false,
    overwriteFileIds?: string[]
  ): void {
    const blob = new Blob([this.unitScheme().scheme], { type: 'application/octet-stream' });
    const file = new File([blob], filename, { type: 'application/octet-stream' });

    const formData = new FormData();
    formData.append('files', file);

    this.fileService.uploadTestFiles(
      this.data.workspaceId,
      formData,
      overwriteExisting,
      overwriteFileIds
    ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(result => {
        const conflicts = result.conflicts || [];
        const ok = result.failed === 0 && conflicts.length === 0;
        if (ok) {
          if (this.hasCodingFreshnessWarning(result.issues)) {
            this.showCodingFreshnessWarning();
          } else {
            this.showCodingFreshnessSuccess();
          }
          this.dialogRef.close(true);
        } else {
          this.snackBar.open(
            this.translate.instant('coding.schemer.save-error'),
            'Error',
            { duration: 3000 }
          );
        }
      });
  }

  private hasCodingFreshnessWarning(
    issues: TestResultsUploadIssueDto[] | undefined
  ): boolean {
    return (issues || []).some(issue => issue.category === 'coding_freshness');
  }

  private showCodingFreshnessWarning(): void {
    const snackBarRef = this.snackBar.open(
      this.translate.instant('coding.schemer.save-freshness-warning'),
      this.translate.instant('coding.schemer.check-coding-status'),
      { duration: 10000 }
    ) as ReturnType<MatSnackBar['open']> | undefined;

    this.navigateToCodingStatusOnAction(snackBarRef);
  }

  private showCodingFreshnessSuccess(): void {
    const snackBarRef = this.snackBar.open(
      this.translate.instant('coding.schemer.save-success'),
      this.translate.instant('coding.schemer.check-coding-status'),
      { duration: 10000 }
    ) as ReturnType<MatSnackBar['open']> | undefined;

    this.navigateToCodingStatusOnAction(snackBarRef);
  }

  private navigateToCodingStatusOnAction(
    snackBarRef: ReturnType<MatSnackBar['open']> | undefined
  ): void {
    if (!snackBarRef) return;
    const workspaceId = this.data.workspaceId;
    const router = this.router;
    snackBarRef.onAction().pipe(take(1), takeUntil(snackBarRef.afterDismissed())).subscribe(() => {
      router.navigate(
        [`/workspace-admin/${workspaceId}/coding/management`],
        { queryParams: { refreshCodingFreshness: '1' } }
      );
    });
  }
}
