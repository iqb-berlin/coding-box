import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
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
import * as ExcelJS from 'exceljs';
import { TestPersonCodingService } from '../../services/test-person-coding.service';

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
}

@Component({
  selector: 'app-import-comparison-dialog',
  standalone: true,
  imports: [
    CommonModule,
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
    MatListModule
  ],
  template: `
    <div class="import-comparison-dialog">
      <h2 mat-dialog-title>Import-Vergleichstabelle</h2>

      <mat-dialog-content class="dialog-content">
        <div class="summary-info">
          <p>{{data.message}}</p>
          <p>Betroffene Zeilen: {{data.affectedRows.length}}</p>
          <p>Verarbeitete Zeilen: {{data.processedRows}}</p>
          <p>Aktualisierte Zeilen: {{data.updatedRows}}</p>
          <div class="matched-indicator">
            <mat-icon class="matched-icon">{{data.isPreview ? 'preview' : 'check_circle'}}</mat-icon>
            <span>{{data.affectedRows.length}} Zeilen wurden {{data.isPreview ? 'gefunden (Vorschau)' : 'gefunden und aktualisiert'}}</span>
          </div>
          <div *ngIf="data.isPreview" class="preview-notice">
            <mat-icon class="warning-icon">info</mat-icon>
            <span>Dies ist eine Vorschau. Die Änderungen wurden noch nicht angewendet.</span>
          </div>
        </div>

        <div class="table-container" *ngIf="data.affectedRows.length > 0">
          <mat-form-field appearance="outline" class="page-size-field">
            <mat-label>Einträge pro Seite</mat-label>
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
              <th mat-header-cell *matHeaderCellDef>Unit-Alias</th>
              <td mat-cell *matCellDef="let row">{{row.unitAlias}}</td>
            </ng-container>

            <!-- Variable ID Column -->
            <ng-container matColumnDef="variableId">
              <th mat-header-cell *matHeaderCellDef>Variablen-ID</th>
              <td mat-cell *matCellDef="let row">{{row.variableId}}</td>
            </ng-container>

            <!-- Person Login Column -->
            <ng-container matColumnDef="personLogin">
              <th mat-header-cell *matHeaderCellDef>Person-Login</th>
              <td mat-cell *matCellDef="let row">{{row.personLogin || '-'}}</td>
            </ng-container>

            <!-- Person Code Column -->
            <ng-container matColumnDef="personCode">
              <th mat-header-cell *matHeaderCellDef>Person-Code</th>
              <td mat-cell *matCellDef="let row">{{row.personCode || '-'}}</td>
            </ng-container>

            <!-- Person Group Column -->
            <ng-container matColumnDef="personGroup">
              <th mat-header-cell *matHeaderCellDef>Person-Gruppe</th>
              <td mat-cell *matCellDef="let row">{{row.personGroup || '-'}}</td>
            </ng-container>

            <!-- Booklet Name Column -->
            <ng-container matColumnDef="bookletName">
              <th mat-header-cell *matHeaderCellDef>Booklet-Name</th>
              <td mat-cell *matCellDef="let row">{{row.bookletName || '-'}}</td>
            </ng-container>

            <!-- Original Status Column -->
            <ng-container matColumnDef="originalStatus">
              <th mat-header-cell *matHeaderCellDef>Original Status</th>
              <td mat-cell *matCellDef="let row">{{row.originalCodedStatus}}</td>
            </ng-container>

            <!-- Original Code Column -->
            <ng-container matColumnDef="originalCode">
              <th mat-header-cell *matHeaderCellDef>Original Code</th>
              <td mat-cell *matCellDef="let row">{{row.originalCode || '-'}}</td>
            </ng-container>

            <!-- Original Score Column -->
            <ng-container matColumnDef="originalScore">
              <th mat-header-cell *matHeaderCellDef>Original Score</th>
              <td mat-cell *matCellDef="let row">{{row.originalScore || '-'}}</td>
            </ng-container>

            <!-- Updated Status Column -->
            <ng-container matColumnDef="updatedStatus">
              <th mat-header-cell *matHeaderCellDef>Aktualisierter Status</th>
              <td mat-cell *matCellDef="let row"
                  [class.updated-value]="row.updatedCodedStatus !== row.originalCodedStatus"
                  [class.matched-row]="true">
                {{row.updatedCodedStatus || '-'}}
              </td>
            </ng-container>

            <!-- Updated Code Column -->
            <ng-container matColumnDef="updatedCode">
              <th mat-header-cell *matHeaderCellDef>Aktualisierter Code</th>
              <td mat-cell *matCellDef="let row"
                  [class.updated-value]="row.updatedCode !== row.originalCode"
                  [class.matched-row]="true">
                {{row.updatedCode || '-'}}
              </td>
            </ng-container>

            <!-- Updated Score Column -->
            <ng-container matColumnDef="updatedScore">
              <th mat-header-cell *matHeaderCellDef>Aktualisierter Score</th>
              <td mat-cell *matCellDef="let row"
                  [class.updated-value]="row.updatedScore !== row.originalScore"
                  [class.matched-row]="true">
                {{row.updatedScore || '-'}}
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns;"
                [class.matched-row]="true"></tr>
          </table>

          <mat-paginator
            [length]="data.affectedRows.length"
            [pageSize]="pageSize"
            [pageSizeOptions]="[50, 100, 200, 500]"
            (page)="onPageChange($event)"
            showFirstLastButtons>
          </mat-paginator>
        </div>

        <div class="error-section" *ngIf="data.errors.length > 0">
          <h3>Fehler und Warnungen</h3>
          <mat-list>
            <mat-list-item *ngFor="let error of data.errors">
              <mat-icon matListItemIcon class="error-icon">error</mat-icon>
              <div matListItemTitle>{{error}}</div>
            </mat-list-item>
          </mat-list>
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="downloadComparisonTable()"
                [disabled]="isLoading || !data.affectedRows.length"
                matTooltip="Als Excel herunterladen">
          <mat-icon>download</mat-icon>
          Herunterladen
        </button>

        <!-- Preview mode buttons -->
        <ng-container *ngIf="data.isPreview">
          <button mat-button (click)="closeDialog()" matTooltip="Vorschau abbrechen">
            <mat-icon>cancel</mat-icon>
            Abbrechen
          </button>
          <button mat-raised-button color="primary" (click)="applyImport()"
                  [disabled]="isLoading || !data.affectedRows.length"
                  matTooltip="Änderungen anwenden">
            <mat-icon>check_circle</mat-icon>
            Änderungen anwenden
          </button>
        </ng-container>

        <!-- Normal mode button -->
        <ng-container *ngIf="!data.isPreview">
          <button mat-button (click)="closeDialog()" matTooltip="Dialog schließen">
            <mat-icon>close</mat-icon>
            Schließen
          </button>
        </ng-container>
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
  `]
})
export class ImportComparisonDialogComponent implements OnInit {
  displayedColumns: string[] = [
    'unitAlias',
    'variableId',
    'personLogin',
    'personCode',
    'personGroup',
    'bookletName',
    'originalStatus',
    'originalCode',
    'originalScore',
    'updatedStatus',
    'updatedCode',
    'updatedScore'
  ];

  dataSource = new MatTableDataSource<ImportComparisonRow>([]);
  pageSize = 100;
  isLoading = false;

  constructor(
    public dialogRef: MatDialogRef<ImportComparisonDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ImportComparisonData,
    private translateService: TranslateService,
    private testPersonCodingService: TestPersonCodingService
  ) {}

  ngOnInit(): void {
    this.dataSource.data = this.data.affectedRows;
    // Paginator will be set via template
  }

  onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.updateDataSource();
  }

  onPageSizeChange(): void {
    this.updateDataSource();
  }

  private updateDataSource(): void {
    // For simplicity, we'll let MatTableDataSource handle pagination
    // In a real implementation, you might want to slice the data manually
  }

  downloadComparisonTable(): void {
    if (!this.data.affectedRows || this.data.affectedRows.length === 0) {
      return;
    }

    this.isLoading = true;

    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Import Vergleich');

      const headers = [
        'Unit Alias',
        'Variable ID',
        'Person Login',
        'Person Code',
        'Person Group',
        'Booklet Name',
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

      workbook.xlsx.writeBuffer().then(buffer => {
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
      });
    } catch {
      // Swallow error; UI state is reset in finally block
    } finally {
      this.isLoading = false;
    }
  }

  closeDialog(): void {
    this.dialogRef.close();
  }

  async applyImport(): Promise<void> {
    if (!this.data.isPreview || !this.data.workspaceId || !this.data.fileData || !this.data.fileName) {
      return;
    }

    this.isLoading = true;

    try {
      await this.testPersonCodingService.importExternalCodingWithProgress(
        this.data.workspaceId,
        {
          file: this.data.fileData,
          fileName: this.data.fileName,
          previewOnly: false
        },
        () => {
          // Could show progress in dialog if needed
        },
        // onComplete callback
        result => {
          this.isLoading = false;
          this.dialogRef.close({ applied: true, result });
        },
        // onError callback
        () => {
          this.isLoading = false;
          // Could show error in dialog
        }
      );
    } catch {
      this.isLoading = false;
    }
  }
}
