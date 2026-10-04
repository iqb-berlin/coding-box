import {
  Component, ChangeDetectionStrategy, input, output
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
import { CodingStatistics } from '../../../../../../../../../api-dto/coding/coding-statistics';
import {
  getResponseStatusLabel,
  getResponseStatusTooltipKey
} from '../../../../../shared/utils/response-status-metadata.util';
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
  readonly codingStatistics = input<CodingStatistics>({ totalResponses: 0, statusCounts: {} });
  readonly referenceStatistics = input<CodingStatistics | null>(null);
  readonly referenceVersion = input<StatisticsVersion | null>(null);
  readonly selectedVersion = input<'v1' | 'v2' | 'v3'>('v1');
  readonly isLoading = input(false);
  readonly isDownloadInProgress = input(false);
  readonly statisticsLoaded = input(false);
  readonly resetProgress = input<number | null>(null);
  readonly downloadProgress = input<number | null>(null);
  readonly hideActionButtons = input(false);
  readonly hideResetButton = input(false);

  readonly versionChange = output<'v1' | 'v2' | 'v3'>();
  readonly loadStatistics = output<void>();
  readonly downloadResults = output<void>();
  readonly cancelDownloadResults = output<void>();
  readonly resetVersion = output<void>();
  readonly statusClick = output<string>();
  readonly derivedClick = output<void>();

  private readonly ignoredStatuses = [
    '0', '1', '2', '3', '10',
    'UNSET', 'NOT_REACHED', 'DISPLAYED', 'VALUE_CHANGED', 'PARTLY_DISPLAYED'
  ];

  readonly codingRunOptions = [
    { value: 'v1' as const, label: 'coding-management.statistics.first-autocode-run' },
    { value: 'v2' as const, label: 'coding-management.statistics.manual-coding-run' },
    { value: 'v3' as const, label: 'coding-management.statistics.second-autocode-run' }
  ];

  mapStatusToString(status: string | number): string {
    return getResponseStatusLabel(status) || 'UNKNOWN';
  }

  getStatusTooltipKey(status: string): string {
    return getResponseStatusTooltipKey(status);
  }

  get effectiveTotalResponses(): number {
    const codingStatistics = this.codingStatistics();
    if (!codingStatistics) return 0;
    return codingStatistics.totalResponses;
  }

  get effectiveDerivedResponses(): number {
    return this.codingStatistics()?.derivedResponseCount || 0;
  }

  get derivedAnswerCount(): number {
    if (!this.codingStatistics()) return 0;
    return this.effectiveDerivedResponses;
  }

  get derivedVariableCount(): number {
    return this.codingStatistics()?.derivedVariableCount || 0;
  }

  get hasDerivedStatistics(): boolean {
    return this.derivedAnswerCount > 0;
  }

  get showCodingStatisticsEmptyState(): boolean {
    return this.effectiveTotalResponses === 0 && this.getStatuses().length === 0;
  }

  get codingStatisticsEmptyTextKey(): string {
    return this.codingStatistics().totalResponses > 0 ?
      'coding-management.statistics.only-raw-statuses-text' :
      'coding-management.statistics.no-coding-results-text';
  }

  get effectiveReferenceTotalResponses(): number {
    const referenceStatistics = this.referenceStatistics();
    if (!referenceStatistics) return 0;
    return referenceStatistics.totalResponses;
  }

  getStatuses(): string[] {
    const currentStatuses = Object.keys(this.codingStatistics().statusCounts).filter(s => !this.ignoredStatuses.includes(s));
    const referenceStatistics = this.referenceStatistics();
    if (referenceStatistics) {
      const referenceStatuses = Object.keys(referenceStatistics.statusCounts).filter(s => !this.ignoredStatuses.includes(s));
      const allStatuses = new Set([...currentStatuses, ...referenceStatuses]);
      return Array.from(allStatuses);
    }
    return currentStatuses;
  }

  getStatusDifference(status: string): number | null {
    const referenceStatistics = this.referenceStatistics();
    const selectedVersion = this.selectedVersion();
    if (
      !referenceStatistics ||
      (selectedVersion !== 'v2' && selectedVersion !== 'v3')
    ) {
      return null;
    }
    // Don't show differences if current version has no data yet
    if (this.effectiveTotalResponses === 0) {
      return null;
    }
    const currentCount = this.codingStatistics().statusCounts[status] || 0;
    const referenceCount = referenceStatistics.statusCounts[status] || 0;
    return currentCount - referenceCount;
  }

  getTotalResponsesDifference(): number | null {
    const selectedVersion = this.selectedVersion();
    if (
      !this.referenceStatistics() ||
      (selectedVersion !== 'v2' && selectedVersion !== 'v3')
    ) {
      return null;
    }
    // Don't show differences if current version has no data yet
    if (this.effectiveTotalResponses === 0) {
      return null;
    }
    return this.effectiveTotalResponses - this.effectiveReferenceTotalResponses;
  }

  getDifferenceTooltip(): string {
    const referenceVersion = this.referenceVersion();
    if (referenceVersion === 'v1') {
      return 'coding-management.statistics.difference-tooltip-v1';
    }
    if (referenceVersion === 'v2') {
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
    const total = this.effectiveTotalResponses;
    const codingStatistics = this.codingStatistics();
    if (!total || !codingStatistics.statusCounts[status]) {
      return 0;
    }
    return Math.round(
      (codingStatistics.statusCounts[status] / total) * 100
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

  onCancelDownloadResults(): void {
    this.cancelDownloadResults.emit();
  }

  onResetVersion(): void {
    this.resetVersion.emit();
  }

  onStatusClick(status: string): void {
    this.statusClick.emit(status);
  }

  onDerivedClick(): void {
    this.derivedClick.emit();
  }

  get isManualCodingComplete(): boolean {
    if (this.selectedVersion() !== 'v2') {
      return false;
    }
    // CODING_INCOMPLETE = 8, INTENDED_INCOMPLETE = 12
    const incompleteCount = (this.codingStatistics().statusCounts['8'] || 0) +
      (this.codingStatistics().statusCounts['12'] || 0);
    return incompleteCount === 0;
  }

  protected readonly Number = Number;
}
