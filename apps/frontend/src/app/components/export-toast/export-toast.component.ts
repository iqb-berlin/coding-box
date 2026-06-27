import {
  Component, inject, OnDestroy, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { ExportJob, ExportJobService } from '../../shared/services/file/export-job.service';

@Component({
  selector: 'coding-box-export-toast',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslateModule
  ],
  templateUrl: './export-toast.component.html',
  styleUrls: ['./export-toast.component.scss']
})
export class ExportToastComponent implements OnInit, OnDestroy {
  private exportJobService = inject(ExportJobService);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();
  private readonly exportTypeLabelKeys: Record<string, string> = {
    aggregated: 'export-toast.types.aggregated',
    'by-coder': 'export-toast.types.by-coder',
    'by-variable': 'export-toast.types.by-variable',
    'by-variable-compact': 'export-toast.types.by-variable-compact',
    detailed: 'export-toast.types.detailed',
    'coding-times': 'export-toast.types.coding-times',
    'results-by-version': 'export-toast.types.results-by-version',
    'item-matrix': 'export-toast.types.item-matrix'
  };

  jobs: ExportJob[] = [];
  isCollapsed = false;

  ngOnInit(): void {
    this.exportJobService.jobs$
      .pipe(takeUntil(this.destroy$))
      .subscribe(jobs => {
        this.jobs = jobs;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get hasJobs(): boolean {
    return this.jobs.length > 0;
  }

  get activeJobCount(): number {
    return this.jobs.filter(j => j.status === 'waiting' || j.status === 'active' || j.status === 'downloading').length;
  }

  get completedJobCount(): number {
    return this.jobs.filter(j => j.status === 'completed').length;
  }

  get failedJobCount(): number {
    return this.jobs.filter(j => j.status === 'failed').length;
  }

  toggleCollapse(): void {
    this.isCollapsed = !this.isCollapsed;
  }

  getStatusIcon(status: ExportJob['status']): string {
    switch (status) {
      case 'waiting':
        return 'hourglass_empty';
      case 'active':
        return 'sync';
      case 'downloading':
        return 'file_download';
      case 'completed':
        return 'check_circle';
      case 'failed':
        return 'error';
      case 'cancelled':
        return 'cancel';
      default:
        return 'help';
    }
  }

  getStatusClass(status: ExportJob['status']): string {
    return `status-${status}`;
  }

  getExportTypeLabel(jobOrExportType: ExportJob | string): string {
    const exportType = typeof jobOrExportType === 'string' ? jobOrExportType : jobOrExportType.exportType;
    const displayLabelKey = typeof jobOrExportType === 'string' ? undefined : jobOrExportType.displayLabelKey;
    const translationKey = displayLabelKey || this.exportTypeLabelKeys[exportType];
    return translationKey ? this.translateService.instant(translationKey) : exportType;
  }

  getErrorTitle(job: ExportJob): string {
    if (this.getWorksheetLimitError(job)) {
      return this.translateService.instant('export-toast.errors.too-many-worksheets-title');
    }
    return this.translateService.instant('export-toast.errors.generic-title');
  }

  getErrorMessage(job: ExportJob): string {
    const worksheetLimitError = this.getWorksheetLimitError(job);
    if (worksheetLimitError) {
      return this.translateService.instant('export-toast.errors.too-many-worksheets-message', worksheetLimitError);
    }
    return job.error || '';
  }

  hasTechnicalDetails(job: ExportJob): boolean {
    return !!job.error && this.getErrorMessage(job) !== job.error;
  }

  downloadFile(job: ExportJob): void {
    this.exportJobService.downloadFile(
      job.workspaceId,
      job.jobId,
      job.exportType,
      job.result?.fileName,
      job.downloadFilePrefix
    );
  }

  removeJob(job: ExportJob): void {
    this.exportJobService.removeJob(job.jobId);
  }

  cancelJob(job: ExportJob): void {
    this.exportJobService.cancelJob(job);
  }

  clearCompleted(): void {
    const completedJobs = this.jobs.filter(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled');
    completedJobs.forEach(job => this.exportJobService.removeJob(job.jobId));
  }

  private getWorksheetLimitError(job: ExportJob): { actual: number; max: number } | null {
    if (job.errorCode === 'EXPORT_TOO_MANY_WORKSHEETS') {
      const actual = Number(job.errorDetails?.actual);
      const max = Number(job.errorDetails?.max);
      if (Number.isFinite(actual) && Number.isFinite(max)) {
        return { actual, max };
      }
    }

    const match = job.error?.match(/enthaelt\s+(\d+)\s+Unit-Variable-Kombinationen[\s\S]*Limit von\s+(\d+)\s+Tabellenblaettern/i);
    if (!match) return null;
    return {
      actual: Number(match[1]),
      max: Number(match[2])
    };
  }
}
