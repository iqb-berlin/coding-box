import {
  Component, OnInit, inject, ViewChild, AfterViewInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WorkspaceProcessesService } from '../../services/workspace-processes.service';
import { ProcessDto } from '../../../../../../../api-dto/workspaces/process-dto';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

type ProcessStatus = ProcessDto['status'];
type ProcessActionKind = 'cancel' | 'pause' | 'remove';

interface ProcessStatusPresentation {
  labelKey: string;
  tooltipKey: string;
  icon: string;
  cssClass: string;
}

interface QueuePresentation {
  labelKey: string;
  descriptionKey: string;
}

interface ProcessDetailItem {
  label: string;
  value: string;
}

const STATUS_PRESENTATIONS: Record<ProcessStatus, ProcessStatusPresentation> = {
  active: {
    labelKey: 'process-overview.status.active',
    tooltipKey: 'process-overview.status-tooltips.active',
    icon: 'play_circle',
    cssClass: 'active'
  },
  waiting: {
    labelKey: 'process-overview.status.waiting',
    tooltipKey: 'process-overview.status-tooltips.waiting',
    icon: 'hourglass_empty',
    cssClass: 'waiting'
  },
  delayed: {
    labelKey: 'process-overview.status.delayed',
    tooltipKey: 'process-overview.status-tooltips.delayed',
    icon: 'schedule',
    cssClass: 'delayed'
  },
  completed: {
    labelKey: 'process-overview.status.completed',
    tooltipKey: 'process-overview.status-tooltips.completed',
    icon: 'check_circle',
    cssClass: 'completed'
  },
  failed: {
    labelKey: 'process-overview.status.failed',
    tooltipKey: 'process-overview.status-tooltips.failed',
    icon: 'error',
    cssClass: 'failed'
  },
  paused: {
    labelKey: 'process-overview.status.paused',
    tooltipKey: 'process-overview.status-tooltips.paused',
    icon: 'pause_circle',
    cssClass: 'paused'
  },
  unknown: {
    labelKey: 'process-overview.status.unknown',
    tooltipKey: 'process-overview.status-tooltips.unknown',
    icon: 'help',
    cssClass: 'unknown'
  }
};

const QUEUE_PRESENTATIONS: Record<string, QueuePresentation> = {
  'test-person-coding': {
    labelKey: 'process-overview.queues.test-person-coding.label',
    descriptionKey: 'process-overview.queues.test-person-coding.description'
  },
  'coding-statistics': {
    labelKey: 'process-overview.queues.coding-statistics.label',
    descriptionKey: 'process-overview.queues.coding-statistics.description'
  },
  'data-export': {
    labelKey: 'process-overview.queues.data-export.label',
    descriptionKey: 'process-overview.queues.data-export.description'
  },
  'flat-response-filter-options': {
    labelKey: 'process-overview.queues.flat-response-filter-options.label',
    descriptionKey: 'process-overview.queues.flat-response-filter-options.description'
  },
  'test-results-upload': {
    labelKey: 'process-overview.queues.test-results-upload.label',
    descriptionKey: 'process-overview.queues.test-results-upload.description'
  },
  'codebook-generation': {
    labelKey: 'process-overview.queues.codebook-generation.label',
    descriptionKey: 'process-overview.queues.codebook-generation.description'
  },
  'reset-coding-version': {
    labelKey: 'process-overview.queues.reset-coding-version.label',
    descriptionKey: 'process-overview.queues.reset-coding-version.description'
  },
  'validation-task': {
    labelKey: 'process-overview.queues.validation-task.label',
    descriptionKey: 'process-overview.queues.validation-task.description'
  },
  'response-analysis': {
    labelKey: 'process-overview.queues.response-analysis.label',
    descriptionKey: 'process-overview.queues.response-analysis.description'
  },
  'variable-analysis': {
    labelKey: 'process-overview.queues.variable-analysis.label',
    descriptionKey: 'process-overview.queues.variable-analysis.description'
  },
  'external-coding-import': {
    labelKey: 'process-overview.queues.external-coding-import.label',
    descriptionKey: 'process-overview.queues.external-coding-import.description'
  },
  'database-export': {
    labelKey: 'process-overview.queues.database-export.label',
    descriptionKey: 'process-overview.queues.database-export.description'
  }
};

const DETAIL_LABEL_KEYS: Record<string, string> = {
  taskId: 'process-overview.details.taskId',
  resultType: 'process-overview.details.resultType',
  overwriteExisting: 'process-overview.details.overwriteExisting',
  personMatchMode: 'process-overview.details.personMatchMode',
  overwriteMode: 'process-overview.details.overwriteMode',
  scope: 'process-overview.details.scope',
  exportType: 'process-overview.details.exportType',
  version: 'process-overview.details.version',
  format: 'process-overview.details.format',
  source: 'process-overview.details.source',
  autoCoderRun: 'process-overview.details.autoCoderRun',
  freshnessVersion: 'process-overview.details.freshnessVersion',
  processingDurationThresholdMs: 'process-overview.details.processingDurationThresholdMs',
  missingsProfile: 'process-overview.details.missingsProfile',
  unitId: 'process-overview.details.unitId',
  variableId: 'process-overview.details.variableId',
  fileName: 'process-overview.details.fileName',
  sourceFormat: 'process-overview.details.sourceFormat',
  sourceVersion: 'process-overview.details.sourceVersion',
  scoreMode: 'process-overview.details.scoreMode',
  existingCodingMode: 'process-overview.details.existingCodingMode',
  validationType: 'process-overview.details.validationType',
  progressMessage: 'process-overview.details.progressMessage',
  isPaused: 'process-overview.details.isPaused',
  isCancelled: 'process-overview.details.isCancelled',
  personCount: 'process-overview.details.personCount',
  unitCount: 'process-overview.details.unitCount',
  groupCount: 'process-overview.details.groupCount',
  jobDefinitionCount: 'process-overview.details.jobDefinitionCount',
  coderTrainingCount: 'process-overview.details.coderTrainingCount',
  coderCount: 'process-overview.details.coderCount',
  matchingFlagCount: 'process-overview.details.matchingFlagCount'
};

const DETAIL_ORDER = [
  'fileName',
  'taskId',
  'resultType',
  'exportType',
  'version',
  'format',
  'source',
  'sourceFormat',
  'sourceVersion',
  'scoreMode',
  'existingCodingMode',
  'validationType',
  'progressMessage',
  'scope',
  'personCount',
  'unitCount',
  'groupCount',
  'jobDefinitionCount',
  'coderTrainingCount',
  'coderCount',
  'matchingFlagCount',
  'unitId',
  'variableId',
  'autoCoderRun',
  'freshnessVersion',
  'missingsProfile',
  'processingDurationThresholdMs',
  'overwriteExisting',
  'personMatchMode',
  'overwriteMode',
  'isPaused',
  'isCancelled'
];

@Component({
  selector: 'coding-box-process-overview-dialog',
  imports: [
    CommonModule,
    TranslateModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatDialogModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './process-overview.component.html',
  styleUrls: ['./process-overview.component.scss']
})
export class ProcessOverviewComponent implements OnInit, AfterViewInit {
  private processesService = inject(WorkspaceProcessesService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translateService = inject(TranslateService);
  data: { workspaceId: number } = inject(MAT_DIALOG_DATA);

  workspaceId: number = this.data.workspaceId;
  processes = new MatTableDataSource<ProcessDto>([]);
  displayedColumns: string[] = ['queueName', 'status', 'progress', 'time', 'details', 'actions'];
  isLoading = false;
  lastLoadedAt = Date.now();

  // Filter properties
  statusFilter = '';
  typeFilter = '';
  searchFilter = '';
  availableTypes: string[] = [];
  statusOptions: ProcessStatus[] = ['active', 'waiting', 'delayed', 'completed', 'failed', 'paused', 'unknown'];

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  ngOnInit(): void {
    if (this.workspaceId) {
      this.loadProcesses();
    }
    this.setupFilterPredicate();
  }

  ngAfterViewInit() {
    this.processes.paginator = this.paginator;
  }

  setupFilterPredicate(): void {
    this.processes.filterPredicate = (data: ProcessDto, filter: string) => {
      const searchTerms = JSON.parse(filter) as { status?: ProcessStatus; type?: string; search?: string };

      const statusMatch = !searchTerms.status || data.status === searchTerms.status;
      const typeMatch = !searchTerms.type || data.queueName === searchTerms.type;
      const searchableDetails = this.getProcessDetailItems(data)
        .map(item => `${item.label} ${item.value}`)
        .join(' ');

      const searchStr = [
        data.queueName,
        this.getQueueLabel(data.queueName),
        data.id,
        data.status,
        this.getStatusLabel(data.status),
        data.failedReason || '',
        searchableDetails
      ].join(' ').toLowerCase();
      const searchMatch = !searchTerms.search || searchStr.includes(searchTerms.search.toLowerCase());

      return statusMatch && typeMatch && searchMatch;
    };
  }

  applyFilter(): void {
    this.processes.filter = JSON.stringify({
      status: this.statusFilter,
      type: this.typeFilter,
      search: this.searchFilter
    });
    if (this.processes.paginator) {
      this.processes.paginator.firstPage();
    }
  }

  clearFilters(): void {
    this.statusFilter = '';
    this.typeFilter = '';
    this.searchFilter = '';
    this.applyFilter();
  }

  loadProcesses(): void {
    if (!this.workspaceId) return;
    this.isLoading = true;
    this.processesService.getProcesses(this.workspaceId).subscribe({
      next: data => {
        this.processes.data = data;
        this.availableTypes = [...new Set(data.map(d => d.queueName))]
          .sort((a, b) => this.getQueueLabel(a).localeCompare(this.getQueueLabel(b), 'de'));
        this.lastLoadedAt = Date.now();
        this.isLoading = false;
        this.applyFilter();
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('process-overview.messages.load-error'),
          this.translateService.instant('close'),
          { duration: 3000 }
        );
        this.isLoading = false;
      }
    });
  }

  deleteProcess(process: ProcessDto): void {
    const action = this.getProcessAction(process);
    if (!action) return;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '440px',
      data: <ConfirmDialogData>{
        title: this.getConfirmTitle(action),
        content: this.translateService.instant('process-overview.confirm-content', {
          queue: this.getQueueLabel(process.queueName),
          id: process.id,
          action: this.getActionInfinitive(action)
        }),
        confirmButtonLabel: this.getActionLabel(action),
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.confirmDeleteProcess(process, action);
      }
    });
  }

  confirmDeleteProcess(process: ProcessDto, action: ProcessActionKind = this.getProcessAction(process) as ProcessActionKind): void {
    if (!action) return;

    this.isLoading = true;
    this.processesService.deleteProcess(this.workspaceId, process.queueName, process.id.toString()).subscribe({
      next: success => {
        if (success) {
          this.snackBar.open(this.getActionSuccessMessage(action), this.translateService.instant('close'), { duration: 3000 });
          this.loadProcesses();
        } else {
          this.snackBar.open(
            this.translateService.instant('process-overview.messages.action-failed'),
            this.translateService.instant('close'),
            { duration: 4000 }
          );
          this.isLoading = false;
        }
      },
      error: () => {
        this.snackBar.open(
          this.translateService.instant('process-overview.messages.action-error'),
          this.translateService.instant('close'),
          { duration: 4000 }
        );
        this.isLoading = false;
      }
    });
  }

  canRemoveProcess(process: ProcessDto): boolean {
    return this.getProcessAction(process) !== null;
  }

  getActionTooltip(process: ProcessDto): string {
    const action = this.getProcessAction(process);
    if (!action) {
      return this.translateService.instant('process-overview.actions.not-safe');
    }
    return this.translateService.instant(`process-overview.actions.${action}.tooltip`);
  }

  isNumber(val: unknown): boolean {
    return typeof val === 'number';
  }

  getQueueLabel(queueName: string): string {
    const presentation = QUEUE_PRESENTATIONS[queueName];
    return presentation ? this.translateService.instant(presentation.labelKey) : queueName;
  }

  getQueueDescription(queueName: string): string {
    const presentation = QUEUE_PRESENTATIONS[queueName];
    return presentation ? this.translateService.instant(presentation.descriptionKey) : queueName;
  }

  getStatusLabel(status: ProcessStatus): string {
    return this.translateService.instant(STATUS_PRESENTATIONS[status].labelKey);
  }

  getStatusIcon(status: ProcessStatus): string {
    return STATUS_PRESENTATIONS[status].icon;
  }

  getStatusClass(status: ProcessStatus): string {
    return `status-${STATUS_PRESENTATIONS[status].cssClass}`;
  }

  getStatusTooltip(status: ProcessStatus): string {
    return this.translateService.instant(STATUS_PRESENTATIONS[status].tooltipKey);
  }

  hasProgressPercent(process: ProcessDto): boolean {
    return this.getProgressPercent(process) !== null;
  }

  getProgressPercent(process: ProcessDto): number | null {
    if (typeof process.progress !== 'number' || !Number.isFinite(process.progress)) {
      return null;
    }

    return Math.max(0, Math.min(100, Math.round(process.progress)));
  }

  getProgressLabel(process: ProcessDto): string {
    const progress = this.getProgressPercent(process);
    if (progress !== null) {
      return `${progress} %`;
    }

    return this.translateService.instant(`process-overview.progress.${process.status}`);
  }

  getDurationLabel(process: ProcessDto): string | null {
    const duration = this.getDurationMs(process);
    if (duration === null) return null;

    return this.formatDuration(duration);
  }

  getProcessDetailItems(process: ProcessDto): ProcessDetailItem[] {
    if (!process.data || typeof process.data !== 'object') return [];

    return Object.entries(process.data)
      .filter(([key, value]) => key !== 'workspaceId' && this.isDisplayableDetailValue(value))
      .sort(([a], [b]) => this.getDetailOrder(a) - this.getDetailOrder(b))
      .map(([key, value]) => ({
        label: this.translateService.instant(
          DETAIL_LABEL_KEYS[key] || 'process-overview.details.unknown-key',
          { key }
        ),
        value: this.formatDetailValue(value)
      }));
  }

  getProcessAction(process: ProcessDto): ProcessActionKind | null {
    if (process.status === 'active') {
      if (process.queueName === 'test-person-coding') return 'pause';
      if (['data-export', 'database-export'].includes(process.queueName)) return 'cancel';
      return null;
    }

    if (['waiting', 'delayed', 'paused', 'completed', 'failed'].includes(process.status)) {
      return 'remove';
    }

    return null;
  }

  getActionIcon(process: ProcessDto): string {
    const action = this.getProcessAction(process);
    if (action === 'cancel') return 'cancel';
    if (action === 'pause') return 'pause_circle';
    if (action === 'remove') return 'delete';
    return 'block';
  }

  getActionLabel(action: ProcessActionKind): string {
    return this.translateService.instant(`process-overview.actions.${action}.label`);
  }

  private getConfirmTitle(action: ProcessActionKind): string {
    return this.translateService.instant(`process-overview.actions.${action}.confirm-title`);
  }

  private getActionInfinitive(action: ProcessActionKind): string {
    return this.translateService.instant(`process-overview.actions.${action}.infinitive`);
  }

  private getActionSuccessMessage(action: ProcessActionKind): string {
    return this.translateService.instant(`process-overview.actions.${action}.success`);
  }

  private getDurationMs(process: ProcessDto): number | null {
    if (!process.processedOn) return null;

    if (process.finishedOn) {
      return Math.max(0, process.finishedOn - process.processedOn);
    }

    if (process.status === 'active') {
      return Math.max(0, this.lastLoadedAt - process.processedOn);
    }

    return null;
  }

  private formatDuration(milliseconds: number): string {
    const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds} s`;
    }

    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) {
      return seconds > 0 ? `${totalMinutes} min ${seconds} s` : `${totalMinutes} min`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }

  private isDisplayableDetailValue(value: unknown): boolean {
    return typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean';
  }

  private formatDetailValue(value: unknown): string {
    if (typeof value === 'boolean') {
      return this.translateService.instant(value ? 'process-overview.values.yes' : 'process-overview.values.no');
    }

    return String(value);
  }

  private getDetailOrder(key: string): number {
    const index = DETAIL_ORDER.indexOf(key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  }
}
