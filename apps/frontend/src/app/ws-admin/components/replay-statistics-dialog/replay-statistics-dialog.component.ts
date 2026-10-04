import {
  AfterViewInit, Component, ElementRef, OnDestroy, OnInit, inject, signal, viewChild, ChangeDetectionStrategy
} from '@angular/core';

import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { VerticalBarChartComponent } from '../../../shared/components/vertical-bar-chart/vertical-bar-chart.component';
import {
  ReplayBackendService,
  ReplaySourceSummaryResponse
} from '../../../replay/services/replay-backend.service';

interface ReplayFrequencyData {
  name: string;
  value: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-replay-statistics-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    TranslateModule,
    VerticalBarChartComponent
  ],
  template: `
    <h2 mat-dialog-title>{{ 'workspace.replay-statistics' | translate }}</h2>
    <mat-dialog-content class="dialog-content" #dialogContent>
      @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="50"></mat-spinner>
          <p>{{ 'workspace.loading-statistics' | translate }}</p>
        </div>
      }

      @if (!loading()) {
        <div class="dialog-body">
          <div class="stats-container source-summary">
            <mat-card>
              <mat-card-content>
                <div class="source-summary-grid">
                  <div class="source-summary-item">
                    <span class="stat-label">{{ 'workspace.total-replays' | translate }}</span>
                    <span class="stat-value">{{ sourceSummary().total }}</span>
                  </div>
                  <div class="source-summary-item">
                    <span class="stat-label">{{ 'workspace.internal-replays' | translate }}</span>
                    <span class="stat-value">{{ sourceSummary().internal }}</span>
                  </div>
                  <div class="source-summary-item">
                    <span class="stat-label">{{ 'workspace.external-token-replays' | translate }}</span>
                    <span class="stat-value">{{ sourceSummary().external }}</span>
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          </div>
          <mat-tab-group
            class="tabs"
            dynamicHeight="false"
            (selectedIndexChange)="selectedTabIndex.set($event)"
            >
            <!-- Frequency Tab -->
            <mat-tab label="{{ 'workspace.replay-frequency' | translate }}">
              <div class="chart-container">
                <h3>{{ 'workspace.replay-frequency-by-unit' | translate }}</h3>
                @if (selectedTabIndex() === 0) {
                  <coding-box-vertical-bar-chart
                    [results]="frequencyData()"
                    [xAxisLabel]="'workspace.unit' | translate"
                    [yAxisLabel]="'workspace.replay-count' | translate"
                    [rotateXAxisTicks]="true"
                    [xAxisTickFormatting]="formatXAxisTick"
                    [view]="wideView()"
                  ></coding-box-vertical-bar-chart>
                }
              </div>
            </mat-tab>
            <!-- Duration Tab -->
            <mat-tab label="{{ 'workspace.replay-duration' | translate }}">
              <div class="chart-container">
                <div class="stats-container">
                  <mat-card>
                    <mat-card-content>
                      <div class="stat-item">
                        <span class="stat-label"
                          >{{ 'workspace.min-duration' | translate }}:</span
                          >
                          <span class="stat-value">{{
                            formatMilliseconds(durationStats().min)
                          }}</span>
                        </div>
                        <div class="stat-item">
                          <span class="stat-label"
                            >{{ 'workspace.max-duration' | translate }}:</span
                            >
                            <span class="stat-value">{{
                              formatMilliseconds(durationStats().max)
                            }}</span>
                          </div>
                          <div class="stat-item">
                            <span class="stat-label"
                              >{{ 'workspace.avg-duration' | translate }}:</span
                              >
                              <span class="stat-value">{{
                                formatMilliseconds(durationStats().average)
                              }}</span>
                            </div>
                          </mat-card-content>
                        </mat-card>
                      </div>
                      <div class="charts-row">
                        <div class="chart-column">
                          <h3>
                            {{ 'workspace.replay-duration-distribution' | translate }}
                          </h3>
                          @if (selectedTabIndex() === 1) {
                            <coding-box-vertical-bar-chart
                              [results]="durationDistributionData()"
                              [xAxisLabel]="'workspace.duration-milliseconds' | translate"
                              [yAxisLabel]="'workspace.replay-count' | translate"
                              [view]="halfView()"
                            ></coding-box-vertical-bar-chart>
                          }
                        </div>
                        <div class="chart-column">
                          <h3>{{ 'workspace.avg-duration-by-unit' | translate }}</h3>
                          @if (selectedTabIndex() === 1) {
                            <coding-box-vertical-bar-chart
                              [results]="unitDurationData()"
                              [xAxisLabel]="'workspace.unit' | translate"
                    [yAxisLabel]="
                      'workspace.avg-duration-milliseconds' | translate
                    "
                              [rotateXAxisTicks]="true"
                              [xAxisTickFormatting]="formatXAxisTick"
                              [view]="halfView()"
                            ></coding-box-vertical-bar-chart>
                          }
                        </div>
                      </div>
                    </div>
                  </mat-tab>
                  <!-- Day Distribution Tab -->
                  <mat-tab
                    label="{{ 'workspace.replay-distribution-by-day' | translate }}"
                    >
                    <div class="chart-container">
                      <h3>{{ 'workspace.replay-distribution-by-day' | translate }}</h3>
                      @if (selectedTabIndex() === 2) {
                        <coding-box-vertical-bar-chart
                          [results]="dayDistributionData()"
                          [xAxisLabel]="'workspace.date' | translate"
                          [yAxisLabel]="'workspace.replay-count' | translate"
                          [view]="wideView()"
                        ></coding-box-vertical-bar-chart>
                      }
                    </div>
                  </mat-tab>
                  <!-- Hour Distribution Tab -->
                  <mat-tab
                    label="{{ 'workspace.replay-distribution-by-hour' | translate }}"
                    >
                    <div class="chart-container">
                      <h3>{{ 'workspace.replay-distribution-by-hour' | translate }}</h3>
                      @if (selectedTabIndex() === 3) {
                        <coding-box-vertical-bar-chart
                          [results]="hourDistributionData()"
                          [xAxisLabel]="'workspace.hour' | translate"
                          [yAxisLabel]="'workspace.replay-count' | translate"
                          [view]="wideView()"
                        ></coding-box-vertical-bar-chart>
                      }
                    </div>
                  </mat-tab>
                  <!-- Error Statistics Tab -->
                  <mat-tab label="{{ 'workspace.replay-errors' | translate }}">
                    <div class="chart-container">
                      <div class="stats-container">
                        <mat-card>
                          <mat-card-content>
                            <div class="stat-item">
                              <span class="stat-label"
                                >{{ 'workspace.success-rate' | translate }}:</span
                                >
                                <span class="stat-value"
                                  >{{ errorStats().successRate.toFixed(2) }}%</span
                                  >
                                </div>
                                <div class="stat-item">
                                  <span class="stat-label"
                                    >{{ 'workspace.total-replays' | translate }}:</span
                                    >
                                    <span class="stat-value">{{
                                      errorStats().totalReplays
                                    }}</span>
                                  </div>
                                  <div class="stat-item">
                                    <span class="stat-label"
                                      >{{ 'workspace.successful-replays' | translate }}:</span
                                      >
                                      <span class="stat-value">{{
                                        errorStats().successfulReplays
                                      }}</span>
                                    </div>
                                    <div class="stat-item">
                                      <span class="stat-label"
                                        >{{ 'workspace.failed-replays' | translate }}:</span
                                        >
                                        <span class="stat-value">{{
                                          errorStats().failedReplays
                                        }}</span>
                                      </div>
                                    </mat-card-content>
                                  </mat-card>
                                </div>
                                @if (errorStats().commonErrors.length > 0) {
                                  <div>
                                    <h3>{{ 'workspace.common-errors' | translate }}</h3>
                                    <mat-card>
                                      <mat-card-content>
                                        @for (error of errorStats().commonErrors; track error) {
                                          <div
                                            class="error-item"
                                            >
                                            <div class="error-count">{{ error.count }}</div>
                                            <div class="error-message">{{ error.message }}</div>
                                          </div>
                                        }
                                      </mat-card-content>
                                    </mat-card>
                                  </div>
                                }
                                @if (
                                  errorStats().commonErrors.length === 0 &&
                                  errorStats().failedReplays > 0
                                  ) {
                                  <div
                                    >
                                    <p>{{ 'workspace.no-error-messages' | translate }}</p>
                                  </div>
                                }
                              </div>
                            </mat-tab>
                            <!-- Failure Distribution by Unit Tab -->
                            <mat-tab
                              label="{{ 'workspace.failure-distribution-by-unit' | translate }}"
                              >
                              <div class="chart-container">
                                <h3>
                                  {{ 'workspace.failure-distribution-by-unit' | translate }}
                                </h3>
                                @if (failureByUnitData().length === 0) {
                                  <div>
                                    <p>{{ 'workspace.no-failures' | translate }}</p>
                                  </div>
                                }
                                @if (failureByUnitData().length > 0 && selectedTabIndex() === 5) {
                                  <coding-box-vertical-bar-chart
                                    [results]="failureByUnitData()"
                                    [xAxisLabel]="'workspace.unit' | translate"
                                    [yAxisLabel]="'workspace.failure-count' | translate"
                                    [rotateXAxisTicks]="true"
                                    [xAxisTickFormatting]="formatXAxisTick"
                                    [view]="wideView()"
                                  ></coding-box-vertical-bar-chart>
                                }
                              </div>
                            </mat-tab>
                            <!-- Failure Distribution by Day Tab -->
                            <mat-tab
                              label="{{ 'workspace.failure-distribution-by-day' | translate }}"
                              >
                              <div class="chart-container">
                                <h3>{{ 'workspace.failure-distribution-by-day' | translate }}</h3>
                                @if (failureByDayData().length === 0) {
                                  <div>
                                    <p>{{ 'workspace.no-failures' | translate }}</p>
                                  </div>
                                }
                                @if (failureByDayData().length > 0 && selectedTabIndex() === 6) {
                                  <coding-box-vertical-bar-chart
                                    [results]="failureByDayData()"
                                    [xAxisLabel]="'workspace.date' | translate"
                                    [yAxisLabel]="'workspace.failure-count' | translate"
                                    [view]="wideView()"
                                  ></coding-box-vertical-bar-chart>
                                }
                              </div>
                            </mat-tab>
                            <!-- Failure Distribution by Hour Tab -->
                            <mat-tab
                              label="{{ 'workspace.failure-distribution-by-hour' | translate }}"
                              >
                              <div class="chart-container">
                                <h3>
                                  {{ 'workspace.failure-distribution-by-hour' | translate }}
                                </h3>
                                @if (failureByHourData().length === 0) {
                                  <div>
                                    <p>{{ 'workspace.no-failures' | translate }}</p>
                                  </div>
                                }
                                @if (failureByHourData().length > 0 && selectedTabIndex() === 7) {
                                  <coding-box-vertical-bar-chart
                                    [results]="failureByHourData()"
                                    [xAxisLabel]="'workspace.hour' | translate"
                                    [yAxisLabel]="'workspace.failure-count' | translate"
                                    [view]="wideView()"
                                  ></coding-box-vertical-bar-chart>
                                }
                              </div>
                            </mat-tab>
                          </mat-tab-group>
                        </div>
                      }
                    </mat-dialog-content>
                    <mat-dialog-actions align="end">
                      <button mat-button mat-dialog-close>
                        {{ 'workspace.close' | translate }}
                      </button>
                    </mat-dialog-actions>
    `,
  styles: [
    `
      .dialog-content {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
      }

      .dialog-body {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .tabs {
        flex: 1;
        min-height: 0;
      }

      .tabs ::ng-deep .mat-mdc-tab-body-wrapper {
        flex: 1;
        min-height: 0;
      }

      .tabs ::ng-deep .mat-mdc-tab-body {
        height: 100%;
      }

      .tabs ::ng-deep .mat-mdc-tab-body-content {
        height: 100%;
        overflow: auto;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 400px;
      }

      .chart-container {
        padding: 12px 0;
      }

      .charts-row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        gap: 20px;
        margin-bottom: 20px;
      }

      .chart-column {
        flex: 1;
        min-width: 0;
        height: auto;
      }

      @media (max-width: 1100px) {
        .charts-row {
          flex-direction: column;
        }

        .chart-column {
          height: auto;
        }
      }

      .stats-container {
        margin: 20px 0;
      }

      .source-summary {
        margin: 0 0 12px;
      }

      .source-summary-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
      }

      .source-summary-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
      }

      .stat-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .stat-label {
        font-weight: bold;
      }

      .error-item {
        display: flex;
        margin-bottom: 12px;
        padding: 8px;
        border-bottom: 1px solid #eee;
      }

      .error-count {
        font-weight: bold;
        min-width: 40px;
        margin-right: 16px;
        color: #d32f2f;
      }

      .error-message {
        flex: 1;
        word-break: break-word;
      }

      @media (max-width: 720px) {
        .source-summary-grid {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class ReplayStatisticsDialogComponent
implements OnInit, AfterViewInit, OnDestroy {
  private replayBackendService = inject(ReplayBackendService);
  private data = inject(MAT_DIALOG_DATA);

  readonly dialogContent = viewChild<ElementRef<HTMLElement>>('dialogContent');

  workspaceId: number;
  readonly loading = signal(true);
  readonly selectedTabIndex = signal(0);

  readonly wideView = signal<[number, number]>([900, 520]);
  readonly halfView = signal<[number, number]>([440, 380]);

  private readonly defaultLastDays = 30;
  private readonly topUnitsCount = 25;

  private resizeObserver?: ResizeObserver;
  private rafPending = false;

  // Chart data
  readonly frequencyData = signal<ReplayFrequencyData[]>([]);
  readonly durationDistributionData = signal<{ name: string; value: number }[]>([]);
  readonly unitDurationData = signal<ReplayFrequencyData[]>([]);
  readonly dayDistributionData = signal<ReplayFrequencyData[]>([]);
  readonly hourDistributionData = signal<ReplayFrequencyData[]>([]);

  // Failure distribution data
  readonly failureByUnitData = signal<ReplayFrequencyData[]>([]);
  readonly failureByDayData = signal<ReplayFrequencyData[]>([]);
  readonly failureByHourData = signal<ReplayFrequencyData[]>([]);

  // Error statistics data
  readonly errorStats = signal({
    successRate: 0,
    totalReplays: 0,
    successfulReplays: 0,
    failedReplays: 0,
    commonErrors: [] as Array<{ message: string; count: number }>
  });

  readonly sourceSummary = signal<ReplaySourceSummaryResponse>({
    internal: 0,
    external: 0,
    total: 0
  });

  // Duration statistics
  readonly durationStats = signal({
    min: 0,
    max: 0,
    average: 0
  });

  formatMilliseconds(milliseconds: number): string {
    // Convert to seconds with 2 decimal places for better readability
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }

  formatXAxisLabel(value: string): string {
    if (value.length > 20) {
      return `${value.substring(0, 17)}...`;
    }
    return value;
  }

  readonly formatXAxisTick = (value: string): string => this.formatXAxisLabel(value);

  constructor() {
    this.workspaceId = this.data.workspaceId;
  }

  ngOnInit(): void {
    this.loadReplayStatistics();
  }

  ngAfterViewInit(): void {
    const el = this.dialogContent()?.nativeElement;
    if (!el) {
      return;
    }

    this.updateViewsFromElement(el);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.rafPending) {
        return;
      }
      this.rafPending = true;

      requestAnimationFrame(() => {
        this.rafPending = false;
        this.updateViewsFromElement(el);
      });
    });

    this.resizeObserver.observe(el);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private updateViewsFromElement(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();

    const width = Math.max(600, Math.floor(rect.width) - 24);
    const wideHeight = Math.max(460, Math.floor(rect.height * 0.78));
    const halfWidth = Math.max(420, Math.floor((width - 20) / 2));
    const halfHeight = Math.max(380, Math.floor(rect.height * 0.6));

    this.wideView.set([width, wideHeight]);
    this.halfView.set([halfWidth, halfHeight]);
  }

  private toTopNWithOther(
    data: Record<string, number>,
    topN: number,
    otherLabel: string
  ): { name: string; value: number }[] {
    const sorted = Object.entries(data)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    if (sorted.length <= topN) {
      return sorted;
    }

    const top = sorted.slice(0, topN);
    const otherValue = sorted
      .slice(topN)
      .reduce((sum, item) => sum + item.value, 0);

    if (otherValue > 0) {
      top.push({ name: otherLabel, value: otherValue });
    }

    return top;
  }

  private toTopN(data: Record<string, number>, topN: number): ReplayFrequencyData[] {
    return Object.entries(data)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, topN);
  }

  private loadReplayStatistics(): void {
    this.loading.set(true);

    const options = {
      lastDays: this.defaultLastDays,
      limit: this.topUnitsCount
    };

    this.replayBackendService
      .getReplaySourceSummary(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.sourceSummary.set(data);
          this.loadReplayFrequency(options);
        },
        error: () => {
          this.loadReplayFrequency(options);
        }
      });
  }

  private loadReplayFrequency(options: { lastDays: number; limit: number }): void {
    this.replayBackendService
      .getReplayFrequencyByUnit(this.workspaceId, options)
      .subscribe({
        next: (data: Record<string, number>) => {
          this.frequencyData.set(this.toTopNWithOther(
            data,
            this.topUnitsCount,
            'Other'
          ));

          // Load day distribution data
          this.loadDayDistribution(options);
        },
        error: () => {
          this.loading.set(false);
        }
      });
  }

  private loadDayDistribution(options: { lastDays: number }): void {
    this.replayBackendService
      .getReplayDistributionByDay(this.workspaceId, options)
      .subscribe({
        next: (data: Record<string, number>) => {
          this.dayDistributionData.set(Object.entries(data).map(
            ([day, count]) => ({
              name: day,
              value: count
            })
          ).sort((a, b) => a.name.localeCompare(b.name)));

          // Load hour distribution data
          this.loadHourDistribution(options);
        },
        error: () => {
          // Continue with duration statistics even if day distribution fails
          this.loadHourDistribution(options);
        }
      });
  }

  private loadHourDistribution(options: { lastDays: number }): void {
    this.replayBackendService
      .getReplayDistributionByHour(this.workspaceId, options)
      .subscribe({
        next: (data: Record<string, number>) => {
          this.hourDistributionData.set(Object.entries(data).map(
            ([hour, count]) => ({
              name: `${hour}:00`,
              value: count
            })
          ).sort((a, b) => {
            const hourA = parseInt(a.name.split(':')[0], 10);
            const hourB = parseInt(b.name.split(':')[0], 10);
            return hourA - hourB;
          }));

          // Load duration statistics
          this.loadDurationStatistics(options);
        },
        error: () => {
          // Continue with duration statistics even if hour distribution fails
          this.loadDurationStatistics(options);
        }
      });
  }

  private loadDurationStatistics(options: { lastDays: number }): void {
    this.replayBackendService
      .getReplayDurationStatistics(this.workspaceId, undefined, options)
      .subscribe({
        next: (data: {
          min: number;
          max: number;
          average: number;
          distribution: Record<string, number>;
          unitAverages?: Record<string, number>;
        }) => {
          // Set duration statistics
          this.durationStats.set({
            min: data.min,
            max: data.max,
            average: data.average
          });

          // Set duration distribution data
          this.durationDistributionData.set(Object.entries(data.distribution).map(
            ([range, count]) => ({
              name: range,
              value: count as number
            })
          ).sort((a, b) => {
            const aStart = parseInt(a.name.split('-')[0], 10);
            const bStart = parseInt(b.name.split('-')[0], 10);
            return aStart - bStart;
          }));

          // Set unit duration data
          if (data.unitAverages) {
            this.unitDurationData.set(this.toTopN(
              data.unitAverages as Record<string, number>,
              this.topUnitsCount
            ));
          }

          // Load error statistics
          this.loadErrorStatistics(options);
        },
        error: () => {
          // Continue with error statistics even if duration statistics fails
          this.loadErrorStatistics(options);
        }
      });
  }

  private loadErrorStatistics(options: { lastDays: number }): void {
    this.replayBackendService
      .getReplayErrorStatistics(this.workspaceId, options)
      .subscribe({
        next: (data: {
          successRate: number;
          totalReplays: number;
          successfulReplays: number;
          failedReplays: number;
          commonErrors: Array<{ message: string; count: number }>;
        }) => {
          this.errorStats.set(data);

          // Load failure distributions
          this.loadFailureDistributions(options);
        },
        error: () => {
          // Continue with failure distributions even if error statistics fails
          this.loadFailureDistributions(options);
        }
      });
  }

  private loadFailureDistributions(options: { lastDays: number }): void {
    // Load failure distribution by unit
    this.replayBackendService
      .getFailureDistributionByUnit(this.workspaceId, options)
      .subscribe({
        next: (data: Record<string, number>) => {
          this.failureByUnitData.set(this.toTopNWithOther(
            data,
            this.topUnitsCount,
            'Other'
          ));

          this.loadFailureDistributionByDay(options);
        },
        error: () => {
          this.loadFailureDistributionByDay(options);
        }
      });
  }

  private loadFailureDistributionByDay(options: { lastDays: number }): void {
    this.replayBackendService
      .getFailureDistributionByDay(this.workspaceId, options)
      .subscribe({
        next: (data: Record<string, number>) => {
          this.failureByDayData.set(Object.entries(data).map(([day, count]) => ({
            name: day,
            value: count
          })).sort((a, b) => a.name.localeCompare(b.name)));

          this.loadFailureDistributionByHour(options);
        },
        error: () => {
          this.loadFailureDistributionByHour(options);
        }
      });
  }

  private loadFailureDistributionByHour(options: { lastDays: number }): void {
    this.replayBackendService
      .getFailureDistributionByHour(this.workspaceId, options)
      .subscribe({
        next: (data: Record<string, number>) => {
          this.failureByHourData.set(Object.entries(data).map(
            ([hour, count]) => ({
              name: `${hour}:00`,
              value: count
            })
          ).sort((a, b) => {
            const hourA = parseInt(a.name.split(':')[0], 10);
            const hourB = parseInt(b.name.split(':')[0], 10);
            return hourA - hourB;
          }));

          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        }
      });
  }
}
