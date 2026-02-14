import {
  Component,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDivider } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconButton, MatFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { responseStatesNumericMap } from '@iqbspecs/response/response.interface';
import { CodingStatistics } from '../../../../../../../../../api-dto/coding/coding-statistics';
import { StatisticsVersion } from '../../../../services/coding-management.service';

@Component({
  selector: 'app-statistics-card',
  templateUrl: './statistics-card.component.html',
  styleUrls: ['./statistics-card.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDivider,
    MatSelectModule,
    MatFormFieldModule,
    MatIconButton,
    MatIcon,
    MatTooltipModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatFabButton,
    TranslateModule
  ]
})
export class StatisticsCardComponent {
  @Input() codingStatistics: CodingStatistics = { totalResponses: 0, statusCounts: {} };
  @Input() referenceStatistics: CodingStatistics | null = null;
  @Input() referenceVersion: StatisticsVersion | null = null;
  @Input() selectedVersion: 'v1' | 'v2' | 'v3' = 'v1';
  @Input() isLoading = false;
  @Input() isDownloadInProgress = false;
  @Input() statisticsLoaded = false;
  @Input() resetProgress: number | null = null;

  @Output() versionChange = new EventEmitter<'v1' | 'v2' | 'v3'>();
  @Output() loadStatistics = new EventEmitter<void>();
  @Output() downloadResults = new EventEmitter<void>();
  @Output() resetVersion = new EventEmitter<void>();
  @Output() statusClick = new EventEmitter<string>();

  private responseStatusMap = new Map(
    responseStatesNumericMap.map(entry => [entry.key, entry.value])
  );

  readonly codingRunOptions = [
    { value: 'v1' as const, label: 'coding-management.statistics.first-autocode-run' },
    { value: 'v2' as const, label: 'coding-management.statistics.manual-coding-run' },
    { value: 'v3' as const, label: 'coding-management.statistics.second-autocode-run' }
  ];

  mapStatusToString(status: number): string {
    return this.responseStatusMap.get(status) || 'UNKNOWN';
  }

  getStatuses(): string[] {
    const currentStatuses = Object.keys(this.codingStatistics.statusCounts);
    if (this.referenceStatistics) {
      const referenceStatuses = Object.keys(this.referenceStatistics.statusCounts);
      const allStatuses = new Set([...currentStatuses, ...referenceStatuses]);
      return Array.from(allStatuses);
    }
    return currentStatuses;
  }

  getStatusDifference(status: string): number | null {
    if (
      !this.referenceStatistics ||
            (this.selectedVersion !== 'v2' && this.selectedVersion !== 'v3')
    ) {
      return null;
    }
    // Don't show differences if current version has no data yet
    if (this.codingStatistics.totalResponses === 0) {
      return null;
    }
    const currentCount = this.codingStatistics.statusCounts[status] || 0;
    const referenceCount = this.referenceStatistics.statusCounts[status] || 0;
    return currentCount - referenceCount;
  }

  getTotalResponsesDifference(): number | null {
    if (
      !this.referenceStatistics ||
            (this.selectedVersion !== 'v2' && this.selectedVersion !== 'v3')
    ) {
      return null;
    }
    // Don't show differences if current version has no data yet
    if (this.codingStatistics.totalResponses === 0) {
      return null;
    }
    return this.codingStatistics.totalResponses - this.referenceStatistics.totalResponses;
  }

  getDifferenceTooltip(): string {
    if (this.referenceVersion === 'v1') {
      return 'coding-management.statistics.difference-tooltip-v1';
    }
    if (this.referenceVersion === 'v2') {
      return 'coding-management.statistics.difference-tooltip-v2';
    }
    return '';
  }

  formatDifference(diff: number | null): string {
    if (diff === null) return '';
    if (diff > 0) return `+${diff}`;
    if (diff < 0) return `${diff}`;
    return '±0';
  }

  getStatusPercentage(status: string): number {
    if (!this.codingStatistics.totalResponses || !this.codingStatistics.statusCounts[status]) {
      return 0;
    }
    return Math.round(
      (this.codingStatistics.statusCounts[status] / this.codingStatistics.totalResponses) * 100
    );
  }

  onVersionChange(version: 'v1' | 'v2' | 'v3'): void {
    this.versionChange.emit(version);
  }

  onLoadStatistics(): void {
    this.loadStatistics.emit();
  }

  onDownloadResults(): void {
    this.downloadResults.emit();
  }

  onResetVersion(): void {
    this.resetVersion.emit();
  }

  onStatusClick(status: string): void {
    this.statusClick.emit(status);
  }

  get isManualCodingComplete(): boolean {
    if (this.selectedVersion !== 'v2') {
      return false;
    }
    // CODING_INCOMPLETE = 8, INTENDED_INCOMPLETE = 12
    const incompleteCount = (this.codingStatistics.statusCounts['8'] || 0) +
      (this.codingStatistics.statusCounts['12'] || 0);
    return incompleteCount === 0;
  }

  protected readonly Number = Number;
}
