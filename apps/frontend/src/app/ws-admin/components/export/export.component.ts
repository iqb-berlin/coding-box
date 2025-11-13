import { Component, inject } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatRadioModule } from '@angular/material/radio';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

export type ExportFormat = 'aggregated' | 'by-coder' | 'by-variable';

@Component({
  selector: 'coding-box-export',
  templateUrl: './export.component.html',
  styleUrls: ['./export.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    MatCardModule,
    MatButtonModule,
    MatRadioModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    FormsModule,
    CommonModule
  ]
})
export class ExportComponent {
  private appService = inject(AppService);
  private backendService = inject(BackendService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  selectedFormat: ExportFormat = 'aggregated';
  isExporting = false;

  exportFormats = [
    {
      value: 'aggregated' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.aggregated'),
      description: this.translateService.instant('ws-admin.export-formats.aggregated-description')
    },
    {
      value: 'by-coder' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.by-coder'),
      description: this.translateService.instant('ws-admin.export-formats.by-coder-description')
    },
    {
      value: 'by-variable' as ExportFormat,
      label: this.translateService.instant('ws-admin.export-formats.by-variable'),
      description: this.translateService.instant('ws-admin.export-formats.by-variable-description')
    }
  ];

  onExport(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        this.translateService.instant('ws-admin.export.errors.no-workspace'),
        this.translateService.instant('close'),
        { duration: 5000 }
      );
      return;
    }

    this.isExporting = true;

    let exportMethod: Observable<Blob>;
    let filename: string;

    switch (this.selectedFormat) {
      case 'aggregated':
        exportMethod = this.backendService.exportCodingResultsAggregated(workspaceId);
        filename = `coding-results-aggregated-${new Date().toISOString().slice(0, 10)}.xlsx`;
        break;
      case 'by-coder':
        exportMethod = this.backendService.exportCodingResultsByCoder(workspaceId);
        filename = `coding-results-by-coder-${new Date().toISOString().slice(0, 10)}.xlsx`;
        break;
      case 'by-variable':
        exportMethod = this.backendService.exportCodingResultsByVariable(workspaceId);
        filename = `coding-results-by-variable-${new Date().toISOString().slice(0, 10)}.xlsx`;
        break;
      default:
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.invalid-format'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isExporting = false;
        return;
    }

    exportMethod.subscribe({
      next: (blob: Blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        this.snackBar.open(
          this.translateService.instant('ws-admin.export.success'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isExporting = false;
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('ws-admin.export.errors.export-failed'),
          this.translateService.instant('close'),
          { duration: 5000 }
        );
        this.isExporting = false;
      }
    });
  }
}
