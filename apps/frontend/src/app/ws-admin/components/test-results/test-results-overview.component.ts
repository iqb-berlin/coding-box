import {
  ChangeDetectionStrategy, Component, inject, input, output
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslateService } from '@ngx-translate/core';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RESPONSE_STATUS_INFO } from './test-results-response-status';
import { TestResultsOverviewResponse } from '../../../shared/services/test-result/test-result.service';
import { getResponseStatusTooltipKey } from '../../../shared/utils/response-status-metadata.util';

@Component({
  selector: 'coding-box-test-results-overview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './test-results-overview.component.html',
  styleUrl: './test-results-overview.component.scss',
  imports: [DecimalPipe, MatDividerModule, MatProgressSpinnerModule, MatIconModule, MatButtonModule, MatTooltipModule]
})
export class TestResultsOverviewComponent {
  private readonly translateService = inject(TranslateService);
  readonly overview = input<TestResultsOverviewResponse | null>(null);
  readonly loading = input(false);
  readonly selectedStatus = input<string>();
  readonly statusSelected = output<string>();
  readonly sessionDetailsRequested = output<void>();

  get overviewStatusCounts(): Array<{ status: string; count: number; percent: number }> {
    const map = (this.overview()?.responseStatusCounts || {}) as Record<
      string,
      number
    >;
    const total = Object.values(this.overview()?.responseStatusCounts || {}).reduce((sum, value) => sum + value, 0);
    return Object.entries(map)
      .map(([status, count]) => {
        const normalizedCount = Number(count) || 0;
        return {
          status,
          count: normalizedCount,
          percent: this.getPercent(normalizedCount, total)
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  protected getPercent(count: number, total: number): number {
    const t = Number(total) || 0;
    if (t <= 0) {
      return 0;
    }
    return Math.round((Number(count) / t) * 1000) / 10;
  }

  protected getResponseStatusTooltip(status: string): string {
    const sharedTooltipKey = getResponseStatusTooltipKey(status);
    if (sharedTooltipKey) {
      return this.translateService.instant(sharedTooltipKey);
    }

    const info = RESPONSE_STATUS_INFO[status];
    if (!info) {
      return status;
    }

    const descriptionPart = info.description ? `: ${info.description}` : '';
    return `${status}${descriptionPart}`;
  }
}
