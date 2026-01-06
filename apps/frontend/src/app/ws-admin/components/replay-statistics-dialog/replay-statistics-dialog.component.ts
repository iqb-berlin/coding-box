import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { NgxChartsModule } from '@swimlane/ngx-charts';
import { BackendService } from '../../../services/backend.service';

interface ReplayFrequencyData {
  name: string;
  value: number;
}

@Component({
  selector: 'coding-box-replay-statistics-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    TranslateModule,
    NgxChartsModule
  ],
  template: `
    <h2 mat-dialog-title>{{ 'workspace.replay-statistics' | translate }}</h2>
    <mat-dialog-content class="dialog-content" #dialogContent>
      <div *ngIf="loading" class="loading-container">
        <mat-spinner diameter="50"></mat-spinner>
        <p>{{ 'workspace.loading-statistics' | translate }}</p>
      </div>

      <div *ngIf="!loading" class="dialog-body">
        <mat-tab-group class="tabs" dynamicHeight="false">
          <!-- Frequency Tab -->
          <mat-tab label="{{ 'workspace.replay-frequency' | translate }}">
            <div class="chart-container">
              <h3>{{ 'workspace.replay-frequency-by-unit' | translate }}</h3>
              <ngx-charts-bar-vertical
                [results]="frequencyData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.unit' | translate"
                [yAxisLabel]="'workspace.replay-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
                [rotateXAxisTicks]="true"
                [xAxisTickFormatting]="formatXAxisLabel.bind(this)"
                [view]="wideView"
              ></ngx-charts-bar-vertical>
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
                        formatMilliseconds(durationStats.min)
                      }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{ 'workspace.max-duration' | translate }}:</span
                      >
                      <span class="stat-value">{{
                        formatMilliseconds(durationStats.max)
                      }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{ 'workspace.avg-duration' | translate }}:</span
                      >
                      <span class="stat-value">{{
                        formatMilliseconds(durationStats.average)
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
                  <ngx-charts-bar-vertical
                    [results]="durationDistributionData"
                    [xAxis]="true"
                    [yAxis]="true"
                    [showXAxisLabel]="true"
                    [showYAxisLabel]="true"
                    [xAxisLabel]="'workspace.duration-milliseconds' | translate"
                    [yAxisLabel]="'workspace.replay-count' | translate"
                    [scheme]="colorScheme"
                    [showDataLabel]="true"
                    [view]="halfView"
                  ></ngx-charts-bar-vertical>
                </div>

                <div class="chart-column">
                  <h3>{{ 'workspace.avg-duration-by-unit' | translate }}</h3>
                  <ngx-charts-bar-vertical
                    [results]="unitDurationData"
                    [xAxis]="true"
                    [yAxis]="true"
                    [showXAxisLabel]="true"
                    [showYAxisLabel]="true"
                    [xAxisLabel]="'workspace.unit' | translate"
                    [yAxisLabel]="
                      'workspace.avg-duration-milliseconds' | translate
                    "
                    [scheme]="colorScheme"
                    [showDataLabel]="true"
                    [rotateXAxisTicks]="true"
                    [xAxisTickFormatting]="formatXAxisLabel.bind(this)"
                    [view]="halfView"
                  ></ngx-charts-bar-vertical>
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
              <ngx-charts-bar-vertical
                [results]="dayDistributionData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.date' | translate"
                [yAxisLabel]="'workspace.replay-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
                [view]="wideView"
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>

          <!-- Hour Distribution Tab -->
          <mat-tab
            label="{{ 'workspace.replay-distribution-by-hour' | translate }}"
          >
            <div class="chart-container">
              <h3>{{ 'workspace.replay-distribution-by-hour' | translate }}</h3>
              <ngx-charts-bar-vertical
                [results]="hourDistributionData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.hour' | translate"
                [yAxisLabel]="'workspace.replay-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
                [view]="wideView"
              ></ngx-charts-bar-vertical>
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
                        >{{ errorStats.successRate.toFixed(2) }}%</span
                      >
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{ 'workspace.total-replays' | translate }}:</span
                      >
                      <span class="stat-value">{{
                        errorStats.totalReplays
                      }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{ 'workspace.successful-replays' | translate }}:</span
                      >
                      <span class="stat-value">{{
                        errorStats.successfulReplays
                      }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label"
                        >{{ 'workspace.failed-replays' | translate }}:</span
                      >
                      <span class="stat-value">{{
                        errorStats.failedReplays
                      }}</span>
                    </div>
                  </mat-card-content>
                </mat-card>
              </div>

              <div *ngIf="errorStats.commonErrors.length > 0">
                <h3>{{ 'workspace.common-errors' | translate }}</h3>
                <mat-card>
                  <mat-card-content>
                    <div
                      *ngFor="let error of errorStats.commonErrors"
                      class="error-item"
                    >
                      <div class="error-count">{{ error.count }}</div>
                      <div class="error-message">{{ error.message }}</div>
                    </div>
                  </mat-card-content>
                </mat-card>
              </div>

              <div
                *ngIf="
                  errorStats.commonErrors.length === 0 &&
                  errorStats.failedReplays > 0
                "
              >
                <p>{{ 'workspace.no-error-messages' | translate }}</p>
              </div>
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
              <div *ngIf="failureByUnitData.length === 0">
                <p>{{ 'workspace.no-failures' | translate }}</p>
              </div>
              <ngx-charts-bar-vertical
                *ngIf="failureByUnitData.length > 0"
                [results]="failureByUnitData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.unit' | translate"
                [yAxisLabel]="'workspace.failure-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
                [rotateXAxisTicks]="true"
                [xAxisTickFormatting]="formatXAxisLabel.bind(this)"
                [view]="wideView"
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>

          <!-- Failure Distribution by Day Tab -->
          <mat-tab
            label="{{ 'workspace.failure-distribution-by-day' | translate }}"
          >
            <div class="chart-container">
              <h3>{{ 'workspace.failure-distribution-by-day' | translate }}</h3>
              <div *ngIf="failureByDayData.length === 0">
                <p>{{ 'workspace.no-failures' | translate }}</p>
              </div>
              <ngx-charts-bar-vertical
                *ngIf="failureByDayData.length > 0"
                [results]="failureByDayData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.date' | translate"
                [yAxisLabel]="'workspace.failure-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
                [view]="wideView"
              ></ngx-charts-bar-vertical>
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
              <div *ngIf="failureByHourData.length === 0">
                <p>{{ 'workspace.no-failures' | translate }}</p>
              </div>
              <ngx-charts-bar-vertical
                *ngIf="failureByHourData.length > 0"
                [results]="failureByHourData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.hour' | translate"
                [yAxisLabel]="'workspace.failure-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
                [view]="wideView"
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>
        </mat-tab-group>
      </div>
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
    `
  ]
})
export class ReplayStatisticsDialogComponent
implements OnInit, AfterViewInit, OnDestroy {
  private backendService = inject(BackendService);
  private data = inject(MAT_DIALOG_DATA);

  @ViewChild('dialogContent', { static: false })
    dialogContent?: ElementRef<HTMLElement>;

  workspaceId: number;
  loading = true;

  wideView: [number, number] = [900, 520];
  halfView: [number, number] = [440, 380];

  private readonly defaultLastDays = 30;
  private readonly topUnitsCount = 25;

  private resizeObserver?: ResizeObserver;
  private rafPending = false;

  // Chart data
  frequencyData: ReplayFrequencyData[] = [];
  durationDistributionData: { name: string; value: number }[] = [];
  unitDurationData: ReplayFrequencyData[] = [];
  dayDistributionData: ReplayFrequencyData[] = [];
  hourDistributionData: ReplayFrequencyData[] = [];

  // Failure distribution data
  failureByUnitData: ReplayFrequencyData[] = [];
  failureByDayData: ReplayFrequencyData[] = [];
  failureByHourData: ReplayFrequencyData[] = [];

  // Error statistics data
  errorStats = {
    successRate: 0,
    totalReplays: 0,
    successfulReplays: 0,
    failedReplays: 0,
    commonErrors: [] as Array<{ message: string; count: number }>
  };

  // Duration statistics
  durationStats = {
    min: 0,
    max: 0,
    average: 0
  };

  // Chart configuration
  colorScheme = 'vivid';

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

  constructor() {
    this.workspaceId = this.data.workspaceId;
  }

  ngOnInit(): void {
    this.loadReplayStatistics();
  }

  ngAfterViewInit(): void {
    const el = this.dialogContent?.nativeElement;
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

    this.wideView = [width, wideHeight];
    this.halfView = [halfWidth, halfHeight];
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

  private loadReplayStatistics(): void {
    this.loading = true;

    const options = { lastDays: this.defaultLastDays };

    // Load replay frequency data
    this.backendService
      .getReplayFrequencyByUnit(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.frequencyData = this.toTopNWithOther(
            data,
            this.topUnitsCount,
            'Other'
          );

          // Load day distribution data
          this.loadDayDistribution(options);
        },
        error: () => {
          this.loading = false;
        }
      });
  }

  private loadDayDistribution(options: { lastDays: number }): void {
    this.backendService
      .getReplayDistributionByDay(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.dayDistributionData = Object.entries(data).map(
            ([day, count]) => ({
              name: day,
              value: count
            })
          );

          // Sort by date (oldest first)
          this.dayDistributionData.sort((a, b) => a.name.localeCompare(b.name));

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
    this.backendService
      .getReplayDistributionByHour(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.hourDistributionData = Object.entries(data).map(
            ([hour, count]) => ({
              name: `${hour}:00`,
              value: count
            })
          );

          // Sort by hour (earliest first)
          this.hourDistributionData.sort((a, b) => {
            const hourA = parseInt(a.name.split(':')[0], 10);
            const hourB = parseInt(b.name.split(':')[0], 10);
            return hourA - hourB;
          });

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
    this.backendService
      .getReplayDurationStatistics(this.workspaceId, undefined, options)
      .subscribe({
        next: data => {
          // Set duration statistics
          this.durationStats = {
            min: data.min,
            max: data.max,
            average: data.average
          };

          // Set duration distribution data
          this.durationDistributionData = Object.entries(data.distribution).map(
            ([range, count]) => ({
              name: range,
              value: count as number
            })
          );

          // Sort by duration range
          this.durationDistributionData.sort((a, b) => {
            const aStart = parseInt(a.name.split('-')[0], 10);
            const bStart = parseInt(b.name.split('-')[0], 10);
            return aStart - bStart;
          });

          // Set unit duration data
          if (data.unitAverages) {
            this.unitDurationData = Object.entries(data.unitAverages).map(
              ([unitId, avgDuration]) => ({
                name: unitId,
                value: avgDuration as number
              })
            );

            // Sort by unit ID
            this.unitDurationData.sort((a, b) => a.name.localeCompare(b.name));
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
    this.backendService
      .getReplayErrorStatistics(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.errorStats = data;

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
    this.backendService
      .getFailureDistributionByUnit(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.failureByUnitData = this.toTopNWithOther(
            data,
            this.topUnitsCount,
            'Other'
          );

          this.loadFailureDistributionByDay(options);
        },
        error: () => {
          this.loadFailureDistributionByDay(options);
        }
      });
  }

  private loadFailureDistributionByDay(options: { lastDays: number }): void {
    this.backendService
      .getFailureDistributionByDay(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.failureByDayData = Object.entries(data).map(([day, count]) => ({
            name: day,
            value: count
          }));

          // Sort by date (oldest first)
          this.failureByDayData.sort((a, b) => a.name.localeCompare(b.name));

          this.loadFailureDistributionByHour(options);
        },
        error: () => {
          this.loadFailureDistributionByHour(options);
        }
      });
  }

  private loadFailureDistributionByHour(options: { lastDays: number }): void {
    this.backendService
      .getFailureDistributionByHour(this.workspaceId, options)
      .subscribe({
        next: data => {
          this.failureByHourData = Object.entries(data).map(
            ([hour, count]) => ({
              name: `${hour}:00`,
              value: count
            })
          );

          // Sort by hour (earliest first)
          this.failureByHourData.sort((a, b) => {
            const hourA = parseInt(a.name.split(':')[0], 10);
            const hourB = parseInt(b.name.split(':')[0], 10);
            return hourA - hourB;
          });

          this.loading = false;
        },
        error: () => {
          this.loading = false;
        }
      });
  }
}
