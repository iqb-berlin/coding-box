import {
  Component, OnInit, OnDestroy, signal, ChangeDetectionStrategy, DestroyRef, inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MAT_DIALOG_DATA, MatDialogModule, MatDialogRef
} from '@angular/material/dialog';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatListModule } from '@angular/material/list';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  Subscription, interval, switchMap, takeWhile
} from 'rxjs';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { TestPersonCodingService } from '../../services/test-person-coding.service';
import { CodingPermissionsService } from '../../services/coding-permissions.service';
import { AppService } from '../../../core/services/app.service';

export interface ImportComparisonRow {
  unitAlias: string;
  variableId: string;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  bookletName?: string;
  originalCodedStatus: string;
  originalCode: number | null;
  originalScore: number | null;
  updatedCodedStatus: string | null;
  updatedCode: number | null;
  updatedScore: number | null;
  importAction?: 'update' | 'skip' | 'unchanged';
  actionReason?: string;
  hasExistingCoding?: boolean;
  hasConflict?: boolean;
}

export interface ImportComparisonData {
  message: string;
  processedRows: number;
  updatedRows: number;
  errors: string[];
  affectedRows: ImportComparisonRow[];
  isPreview?: boolean;
  workspaceId?: number;
  fileData?: string;
  fileName?: string;
  sourceFormat?: 'external-coding' | 'coding-list' | 'coding-results';
  sourceVersion?: 'v1' | 'v2' | 'v3';
  scoreMode?: 'import' | 'derive';
  existingCodingMode?: 'skip-conflicts' | 'fill-empty' | 'overwrite';
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-import-comparison-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTableModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslateModule,
    MatFormFieldModule,
    MatSelectModule,
    MatListModule,
    MatSnackBarModule
  ],
  template: `
    <div class="import-comparison-dialog">
      <h2 mat-dialog-title>{{ 'coding-management-manual.titles.comparison-table' | translate }}</h2>

      <mat-dialog-content class="dialog-content">
        <div class="summary-info">
          <p>{{data.message}}</p>
          <p>{{ 'ui-text.import-comparison-dialog.affected-rows' | translate: { length: (data.affectedRows.length) } }}</p>
          <p>{{ 'ui-text.import-comparison-dialog.processed-rows' | translate: { processedRows: (data.processedRows) } }}</p>
          <p>{{ 'ui-text.import-comparison-dialog.rows-to-update' | translate: { updatedRows: (data.updatedRows) } }}</p>
          <div class="matched-indicator">
            <mat-icon class="matched-icon">{{data.isPreview ? 'preview' : 'check_circle'}}</mat-icon>
            <span>{{ 'ui-text.import-comparison-dialog.row-action' | translate: { updatedRows: (data.updatedRows), value2: (data.isPreview ? 'aktualisiert (Vorschau)' : 'aktualisiert') } }}</span>
          </div>
          @if (data.isPreview) {
            <div class="preview-notice">
              <mat-icon class="warning-icon">info</mat-icon>
              <span>{{ 'ui-text.import-comparison-dialog.preview-hint' | translate }}</span>
            </div>
          }
          @if (applyProgress() >= 0) {
            <div class="apply-progress">
              <p>{{ 'ui-text.import-comparison-dialog.importing' | translate: { value1: (applyProgress()) } }}</p>
              <mat-progress-bar mode="determinate" [value]="applyProgress()"></mat-progress-bar>
            </div>
          }
        </div>

        @if (data.affectedRows.length > 0) {
          <div class="table-container">
            <mat-form-field appearance="outline" class="page-size-field">
              <mat-label>{{ 'ui-text.import-comparison-dialog.items-per-page' | translate }}</mat-label>
              <mat-select [(value)]="pageSize" (selectionChange)="onPageSizeChange()">
                <mat-option value="50">50</mat-option>
                <mat-option value="100">100</mat-option>
                <mat-option value="200">200</mat-option>
                <mat-option value="500">500</mat-option>
              </mat-select>
            </mat-form-field>
            <table mat-table [dataSource]="dataSource" class="comparison-table">
              <!-- Unit Alias Column -->
              <ng-container matColumnDef="unitAlias">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.unit-alias' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.unitAlias}}</td>
              </ng-container>
              <!-- Variable ID Column -->
              <ng-container matColumnDef="variableId">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management.filters.variable-id' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.variableId}}</td>
              </ng-container>
              <!-- Person Login Column -->
              <ng-container matColumnDef="personLogin">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management.columns.person-login' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.personLogin || '-'}}</td>
              </ng-container>
              <!-- Person Code Column -->
              <ng-container matColumnDef="personCode">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management.columns.person-code' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.personCode || '-'}}</td>
              </ng-container>
              <!-- Person Group Column -->
              <ng-container matColumnDef="personGroup">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management.columns.person-group' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.personGroup || '-'}}</td>
              </ng-container>
              <!-- Booklet Name Column -->
              <ng-container matColumnDef="bookletName">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.booklet-name' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.bookletName || '-'}}</td>
              </ng-container>
              <!-- Import Action Column -->
              <ng-container matColumnDef="importAction">
                <th mat-header-cell *matHeaderCellDef>{{ 'ui-text.test-results.import' | translate }}</th>
                <td mat-cell *matCellDef="let row">
                  <span class="action-chip"
                    [class.action-update]="row.importAction === 'update' || !row.importAction"
                    [class.action-skip]="row.importAction === 'skip'"
                    [class.action-unchanged]="row.importAction === 'unchanged'">
                    {{getActionLabel(row)}}
                  </span>
                  @if (row.actionReason) {
                    <span class="action-reason">
                      {{row.actionReason}}
                    </span>
                  }
                </td>
              </ng-container>
              <!-- Original Status Column -->
              <ng-container matColumnDef="originalStatus">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.original-status' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.originalCodedStatus}}</td>
              </ng-container>
              <!-- Original Code Column -->
              <ng-container matColumnDef="originalCode">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.original-code' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.originalCode ?? '-'}}</td>
              </ng-container>
              <!-- Original Score Column -->
              <ng-container matColumnDef="originalScore">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.original-score' | translate }}</th>
                <td mat-cell *matCellDef="let row">{{row.originalScore ?? '-'}}</td>
              </ng-container>
              <!-- Updated Status Column -->
              <ng-container matColumnDef="updatedStatus">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.updated-status' | translate }}</th>
                <td mat-cell *matCellDef="let row"
                  [class.updated-value]="row.updatedCodedStatus !== row.originalCodedStatus"
                  [class.matched-row]="row.importAction !== 'skip'">
                  {{row.updatedCodedStatus || '-'}}
                </td>
              </ng-container>
              <!-- Updated Code Column -->
              <ng-container matColumnDef="updatedCode">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.updated-code' | translate }}</th>
                <td mat-cell *matCellDef="let row"
                  [class.updated-value]="row.updatedCode !== row.originalCode"
                  [class.matched-row]="row.importAction !== 'skip'">
                  {{row.updatedCode ?? '-'}}
                </td>
              </ng-container>
              <!-- Updated Score Column -->
              <ng-container matColumnDef="updatedScore">
                <th mat-header-cell *matHeaderCellDef>{{ 'coding-management-manual.table.headers.updated-score' | translate }}</th>
                <td mat-cell *matCellDef="let row"
                  [class.updated-value]="row.updatedScore !== row.originalScore"
                  [class.matched-row]="row.importAction !== 'skip'">
                  {{row.updatedScore ?? '-'}}
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: displayedColumns;"
                [class.matched-row]="row.importAction !== 'skip'"
                [class.skipped-row]="row.importAction === 'skip'"
              [class.unchanged-row]="row.importAction === 'unchanged'"></tr>
            </table>
            <mat-paginator
              [length]="data.affectedRows.length"
              [pageSize]="pageSize"
              [pageSizeOptions]="[50, 100, 200, 500]"
              (page)="onPageChange($event)"
              showFirstLastButtons>
            </mat-paginator>
          </div>
        }

        @if (data.errors.length > 0) {
          <div class="error-section">
            <h3>{{ 'coding-management-manual.import.errors-and-warnings' | translate }}</h3>
            <mat-list>
              @for (error of data.errors; track error) {
                <mat-list-item>
                  <mat-icon matListItemIcon class="error-icon">error</mat-icon>
                  <div matListItemTitle>{{error}}</div>
                </mat-list-item>
              }
            </mat-list>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="downloadComparisonTable()"
          [disabled]="isLoading() || !data.affectedRows.length"
          [matTooltip]="'coding-management-manual.buttons.download-excel' | translate">
          <mat-icon>download</mat-icon>
          {{ 'download' | translate }}
        </button>

        <!-- Preview mode buttons -->
        @if (data.isPreview) {
          <button mat-button (click)="closeDialog()" [matTooltip]="'ui-text.import-comparison-dialog.cancel-preview' | translate">
            <mat-icon>cancel</mat-icon>
            {{ 'cancel' | translate }}
          </button>
          @if (canApplyImport) {
          <button mat-raised-button color="primary" (click)="applyImport()"
            [disabled]="isLoading() || data.updatedRows === 0"
            [matTooltip]="'ui-text.import-comparison-dialog.apply-changes' | translate">
            <mat-icon>check_circle</mat-icon>
            {{ 'ui-text.import-comparison-dialog.apply-changes' | translate }}
          </button>
          }
        }

        <!-- Normal mode button -->
        @if (!data.isPreview) {
          <button mat-button (click)="closeDialog()" [matTooltip]="'ui-text.coding-job-result-dialog.close' | translate">
            <mat-icon>close</mat-icon>
            {{ 'deferred-view.close' | translate }}
          </button>
        }
      </mat-dialog-actions>
    </div>
    `,
  styles: [`
    .import-comparison-dialog {
      min-width: 90vw;
      max-width: 95vw;
      max-height: 90vh;
    }

    .dialog-content {
      padding: 20px;
      max-height: 70vh;
      overflow-y: auto;
    }

    .summary-info {
      margin-bottom: 20px;
      padding: 16px;
      background-color: #f5f5f5;
      border-radius: 8px;
    }

    .summary-info p {
      margin: 4px 0;
      font-size: 14px;
    }

    .matched-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      padding: 8px 12px;
      background-color: #e8f5e8;
      border-radius: 6px;
      border-left: 4px solid #4caf50;
    }

    .matched-icon {
      color: #4caf50;
      font-size: 18px;
    }

    .matched-indicator span {
      color: #2e7d32;
      font-weight: 500;
      font-size: 14px;
    }

    .preview-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
      padding: 8px 12px;
      background-color: #e3f2fd;
      border-radius: 6px;
      border-left: 4px solid #1976d2;
    }

    .preview-notice .warning-icon {
      color: #1976d2;
      font-size: 18px;
    }

    .preview-notice span {
      color: #1565c0;
      font-weight: 500;
      font-size: 14px;
    }

    .table-container {
      margin-top: 20px;
    }

    .page-size-field {
      width: 200px;
      margin-bottom: 16px;
    }

    .comparison-table {
      width: 100%;
      overflow-x: auto;
    }

    .comparison-table mat-header-cell {
      font-weight: 600;
      min-width: 120px;
    }

    .comparison-table mat-cell {
      min-width: 120px;
    }

    .updated-value {
      font-weight: 600;
      color: #1976d2;
      background-color: #e3f2fd;
      padding: 4px 8px;
      border-radius: 4px;
    }

    .matched-row {
      background-color: #f8fff8;
      border-left: 4px solid #4caf50;
      transition: background-color 0.2s ease;
    }

    .matched-row:hover {
      background-color: #f0f8f0;
    }

    .matched-row mat-cell {
      border-bottom: 1px solid #e8f5e8;
    }

    .skipped-row {
      background-color: #fff8ed;
      border-left: 4px solid #ff9800;
    }

    .unchanged-row {
      background-color: #f5f5f5;
      border-left: 4px solid #9e9e9e;
    }

    .action-chip {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }

    .action-update {
      color: #2e7d32;
      background: #e8f5e8;
    }

    .action-skip {
      color: #e65100;
      background: #fff3e0;
    }

    .action-unchanged {
      color: #616161;
      background: #eeeeee;
    }

    .action-reason {
      display: block;
      margin-top: 4px;
      color: rgba(0, 0, 0, 0.6);
      font-size: 12px;
      line-height: 1.35;
      max-width: 260px;
    }

    .error-section {
      margin-top: 24px;
      padding: 16px;
      background-color: #fff3e0;
      border-radius: 8px;
    }

    .error-section h3 {
      margin-top: 0;
      color: #e65100;
    }

    .error-icon {
      color: #f44336;
    }

    mat-dialog-actions {
      padding: 16px 24px;
      gap: 8px;
    }

    .apply-progress {
      margin-top: 12px;
      padding: 8px 12px;
      background-color: #e3f2fd;
      border-radius: 6px;
      border-left: 4px solid #1976d2;
    }

    .apply-progress p {
      margin: 0 0 8px 0;
      color: #1565c0;
      font-weight: 500;
      font-size: 14px;
    }
  `]
})
export class ImportComparisonDialogComponent implements OnInit, OnDestroy {
  private readonly uiTranslate = injectUiTranslator();

  dialogRef = inject<MatDialogRef<ImportComparisonDialogComponent>>(MatDialogRef);
  protected data = inject<ImportComparisonData>(MAT_DIALOG_DATA);
  private translateService = inject(TranslateService);
  private testPersonCodingService = inject(TestPersonCodingService);
  private snackBar = inject(MatSnackBar);
  private readonly permissions = inject(CodingPermissionsService);
  private readonly appService = inject(AppService);

  private readonly destroyRef = inject(DestroyRef);

  protected displayedColumns: string[] = [
    'unitAlias',
    'variableId',
    'personLogin',
    'personCode',
    'personGroup',
    'bookletName',
    'importAction',
    'originalStatus',
    'originalCode',
    'originalScore',
    'updatedStatus',
    'updatedCode',
    'updatedScore'
  ];

  protected dataSource = new MatTableDataSource<ImportComparisonRow>([]);
  protected pageSize = 100;
  readonly isLoading = signal(false);
  readonly applyProgress = signal(-1);

  private pollingSubscription?: Subscription;

  ngOnInit(): void {
    if (this.data.workspaceId) this.permissions.load(this.data.workspaceId);
    this.dataSource.data = this.data.affectedRows;
  }

  protected get canApplyImport(): boolean {
    return this.data.workspaceId === this.appService.selectedWorkspaceId && this.permissions.canApply;
  }

  ngOnDestroy(): void {
    this.pollingSubscription?.unsubscribe();
  }

  protected onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.updateDataSource();
  }

  protected onPageSizeChange(): void {
    this.updateDataSource();
  }

  protected getActionLabel(row: ImportComparisonRow): string {
    if (row.importAction === 'skip') {
      return row.hasConflict ? this.uiTranslate('ui-text.import-comparison-dialog.conflict-skipped') : this.uiTranslate('ui-text.import-comparison-dialog.skipped');
    }

    if (row.importAction === 'unchanged') {
      return this.uiTranslate('ui-text.import-comparison-dialog.unchanged');
    }

    if (!row.hasExistingCoding) {
      return this.uiTranslate('ui-text.import-comparison-dialog.import-action-outcome');
    }

    return this.data.existingCodingMode === 'overwrite' ? this.uiTranslate('ui-text.import-comparison-dialog.overwritten') : this.uiTranslate('ui-text.import-comparison-dialog.added');
  }

  private updateDataSource(): void {
    // For simplicity, we'll let MatTableDataSource handle pagination
    // In a real implementation, you might want to slice the data manually
  }

  protected async downloadComparisonTable(): Promise<void> {
    if (!this.data.affectedRows || this.data.affectedRows.length === 0) {
      return;
    }

    this.isLoading.set(true);

    try {
      const { default: ExcelJS } = await import('exceljs');
      if (this.destroyRef.destroyed) return;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(this.uiTranslate('ui-text.import-comparison-dialog.export-sheet'));

      const headers = [
        'Unit Alias',
        this.uiTranslate('variable-analysis.variable-id-column'),
        'Person Login',
        'Person Code',
        'Person Group',
        'Booklet Name',
        this.uiTranslate('ui-text.import-comparison-dialog.import-action'),
        this.uiTranslate('ui-text.import-comparison-dialog.import-note'),
        'Original Status',
        'Original Code',
        'Original Score',
        'Updated Status',
        'Updated Code',
        'Updated Score'
      ];
      worksheet.addRow(headers);

      // Style headers
      const headerRow = worksheet.getRow(1);
      headerRow.font = { bold: true };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };

      this.data.affectedRows.forEach(row => {
        worksheet.addRow([
          row.unitAlias,
          row.variableId,
          row.personLogin,
          row.personCode,
          row.personGroup,
          row.bookletName,
          this.getActionLabel(row),
          row.actionReason,
          row.originalCodedStatus,
          row.originalCode,
          row.originalScore,
          row.updatedCodedStatus,
          row.updatedCode,
          row.updatedScore
        ]);
      });

      worksheet.columns.forEach(column => {
        if (column) {
          let maxLength = 0;
          column.eachCell?.({ includeEmpty: true }, cell => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
              maxLength = columnLength;
            }
          });
          if (column.width !== undefined) {
            column.width = Math.min(maxLength + 2, 50);
          }
        }
      });

      const buffer = await workbook.xlsx.writeBuffer();
      if (this.destroyRef.destroyed) return;
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const timestamp = new Date().toISOString().slice(0, 10);
      link.download = `import-comparison-${timestamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch {
      // Swallow error; UI state is reset in finally block
    } finally {
      this.isLoading.set(false);
    }
  }

  protected closeDialog(): void {
    this.dialogRef.close();
  }

  protected applyImport(): void {
    if (!this.canApplyImport || !this.data.isPreview || !this.data.workspaceId || !this.data.fileData || !this.data.fileName) {
      return;
    }

    this.isLoading.set(true);
    this.applyProgress.set(0);

    this.testPersonCodingService.startExternalCodingImportJob(
      this.data.workspaceId,
      {
        file: this.data.fileData,
        fileName: this.data.fileName,
        sourceFormat: this.data.sourceFormat,
        sourceVersion: this.data.sourceVersion,
        scoreMode: this.data.scoreMode,
        existingCodingMode: this.data.existingCodingMode
      }
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ jobId }) => {
        this.pollImportJob(this.data.workspaceId!, jobId);
      },
      error: error => {
        this.isLoading.set(false);
        this.applyProgress.set(-1);
        if (error.status === 409) {
          this.snackBar.open(
            this.uiTranslate('ui-text.import-comparison-dialog.already-running'),
            '',
            { duration: 5000 }
          );
        } else {
          this.snackBar.open(
            this.uiTranslate('ui-text.import-comparison-dialog.import-failed', { value1: error.error?.message || error.message || this.uiTranslate('error.unknown') }),
            '',
            { duration: 5000 }
          );
        }
      }
    });
  }

  private pollImportJob(workspaceId: number, jobId: string): void {
    this.pollingSubscription = interval(2000).pipe(
      switchMap(() => this.testPersonCodingService.getExternalCodingImportJobStatus(workspaceId, jobId)),
      takeWhile(status => status.status !== 'completed' && status.status !== 'failed', true)
    ).subscribe({
      next: status => {
        this.applyProgress.set(status.progress);

        if (status.status === 'completed') {
          this.fetchImportResult(workspaceId, jobId);
        } else if (status.status === 'failed') {
          this.isLoading.set(false);
          this.applyProgress.set(-1);
          this.snackBar.open(
            this.uiTranslate('ui-text.import-comparison-dialog.import-failed', { value1: status.error || this.uiTranslate('error.unknown') }),
            '',
            { duration: 5000 }
          );
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.applyProgress.set(-1);
        this.snackBar.open(
          this.uiTranslate('ui-text.import-comparison-dialog.status-query-failed'),
          '',
          { duration: 5000 }
        );
      }
    });
  }

  private fetchImportResult(workspaceId: number, jobId: string): void {
    this.testPersonCodingService.getExternalCodingImportResult(workspaceId, jobId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.isLoading.set(false);
        this.applyProgress.set(-1);
        this.notifyImportApplied(workspaceId);
        this.dialogRef.close({ applied: true, result });
      },
      error: () => {
        this.isLoading.set(false);
        this.applyProgress.set(-1);
        this.notifyImportApplied(workspaceId);
        this.snackBar.open(
          this.uiTranslate('ui-text.import-comparison-dialog.result-load-failed'),
          '',
          { duration: 5000 }
        );
        this.dialogRef.close({ applied: true });
      }
    });
  }

  private notifyImportApplied(workspaceId: number): void {
    const event = this.data.sourceVersion ?
      {
        workspaceId,
        statisticsVersion: this.data.sourceVersion
      } :
      { workspaceId };
    this.testPersonCodingService.notifyTestResultsChanged(event);
  }
}
