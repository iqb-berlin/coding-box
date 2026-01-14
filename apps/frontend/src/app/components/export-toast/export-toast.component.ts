import {
  Component, inject, OnDestroy, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
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
  private destroy$ = new Subject<void>();

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
    return this.jobs.filter(j => j.status === 'waiting' || j.status === 'active').length;
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

  getExportTypeLabel(exportType: string): string {
    const labels: Record<string, string> = {
      aggregated: 'Aggregiert',
      'by-coder': 'Nach Kodierer',
      'by-variable': 'Nach Variable',
      detailed: 'Detailliert',
      'coding-times': 'Kodierzeiten'
    };
    return labels[exportType] || exportType;
  }

  downloadFile(job: ExportJob): void {
    this.exportJobService.downloadFile(job.workspaceId, job.jobId, job.exportType);
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
}
