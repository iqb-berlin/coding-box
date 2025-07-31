import { Component, OnInit, inject } from '@angular/core';
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
    <mat-dialog-content class="dialog-content">
      <div *ngIf="loading" class="loading-container">
        <mat-spinner diameter="50"></mat-spinner>
        <p>{{ 'workspace.loading-statistics' | translate }}</p>
      </div>

      <div *ngIf="!loading">
        <mat-tab-group>
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
                      <span class="stat-label">{{ 'workspace.min-duration' | translate }}:</span>
                      <span class="stat-value">{{ formatMilliseconds(durationStats.min) }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ 'workspace.max-duration' | translate }}:</span>
                      <span class="stat-value">{{ formatMilliseconds(durationStats.max) }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ 'workspace.avg-duration' | translate }}:</span>
                      <span class="stat-value">{{ formatMilliseconds(durationStats.average) }}</span>
                    </div>
                  </mat-card-content>
                </mat-card>
              </div>

              <div class="charts-row">
                <div class="chart-column">
                  <h3>{{ 'workspace.replay-duration-distribution' | translate }}</h3>
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
                    [view]="[450, 300]"
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
                    [yAxisLabel]="'workspace.avg-duration-milliseconds' | translate"
                    [scheme]="colorScheme"
                    [showDataLabel]="true"
                    [view]="[450, 300]"
                  ></ngx-charts-bar-vertical>
                </div>
              </div>
            </div>
          </mat-tab>

          <!-- Day Distribution Tab -->
          <mat-tab label="{{ 'workspace.replay-distribution-by-day' | translate }}">
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
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>

          <!-- Hour Distribution Tab -->
          <mat-tab label="{{ 'workspace.replay-distribution-by-hour' | translate }}">
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
                      <span class="stat-label">{{ 'workspace.success-rate' | translate }}:</span>
                      <span class="stat-value">{{ errorStats.successRate.toFixed(2) }}%</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ 'workspace.total-replays' | translate }}:</span>
                      <span class="stat-value">{{ errorStats.totalReplays }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ 'workspace.successful-replays' | translate }}:</span>
                      <span class="stat-value">{{ errorStats.successfulReplays }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">{{ 'workspace.failed-replays' | translate }}:</span>
                      <span class="stat-value">{{ errorStats.failedReplays }}</span>
                    </div>
                  </mat-card-content>
                </mat-card>
              </div>

              <div *ngIf="errorStats.commonErrors.length > 0">
                <h3>{{ 'workspace.common-errors' | translate }}</h3>
                <mat-card>
                  <mat-card-content>
                    <div *ngFor="let error of errorStats.commonErrors" class="error-item">
                      <div class="error-count">{{ error.count }}</div>
                      <div class="error-message">{{ error.message }}</div>
                    </div>
                  </mat-card-content>
                </mat-card>
              </div>

              <div *ngIf="errorStats.commonErrors.length === 0 && errorStats.failedReplays > 0">
                <p>{{ 'workspace.no-error-messages' | translate }}</p>
              </div>
            </div>
          </mat-tab>

          <!-- Failure Distribution by Unit Tab -->
          <mat-tab label="{{ 'workspace.failure-distribution-by-unit' | translate }}">
            <div class="chart-container">
              <h3>{{ 'workspace.failure-distribution-by-unit' | translate }}</h3>
              <div *ngIf="failureByUnitData.length === 0">
                <p>{{ 'workspace.no-failures' | translate }}</p>
              </div>
              <ngx-charts-bar-vertical *ngIf="failureByUnitData.length > 0"
                [results]="failureByUnitData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.unit' | translate"
                [yAxisLabel]="'workspace.failure-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>

          <!-- Failure Distribution by Day Tab -->
          <mat-tab label="{{ 'workspace.failure-distribution-by-day' | translate }}">
            <div class="chart-container">
              <h3>{{ 'workspace.failure-distribution-by-day' | translate }}</h3>
              <div *ngIf="failureByDayData.length === 0">
                <p>{{ 'workspace.no-failures' | translate }}</p>
              </div>
              <ngx-charts-bar-vertical *ngIf="failureByDayData.length > 0"
                [results]="failureByDayData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.date' | translate"
                [yAxisLabel]="'workspace.failure-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>

          <!-- Failure Distribution by Hour Tab -->
          <mat-tab label="{{ 'workspace.failure-distribution-by-hour' | translate }}">
            <div class="chart-container">
              <h3>{{ 'workspace.failure-distribution-by-hour' | translate }}</h3>
              <div *ngIf="failureByHourData.length === 0">
                <p>{{ 'workspace.no-failures' | translate }}</p>
              </div>
              <ngx-charts-bar-vertical *ngIf="failureByHourData.length > 0"
                [results]="failureByHourData"
                [xAxis]="true"
                [yAxis]="true"
                [showXAxisLabel]="true"
                [showYAxisLabel]="true"
                [xAxisLabel]="'workspace.hour' | translate"
                [yAxisLabel]="'workspace.failure-count' | translate"
                [scheme]="colorScheme"
                [showDataLabel]="true"
              ></ngx-charts-bar-vertical>
            </div>
          </mat-tab>
        </mat-tab-group>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'workspace.close' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-content {
      min-height: 400px;
      min-width: 900px;
      max-width: 1200px;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 400px;
    }

    .chart-container {
      padding: 20px 0;
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
      height: 350px;
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
  `]
})
export class ReplayStatisticsDialogComponent implements OnInit {
  private backendService = inject(BackendService);
  private data = inject(MAT_DIALOG_DATA);

  workspaceId: number;
  loading = true;

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

  /**
   * Format milliseconds to a more readable format
   * @param milliseconds The duration in milliseconds
   * @returns Formatted string (e.g., "5.00 s" for 5000 milliseconds)
   */
  formatMilliseconds(milliseconds: number): string {
    // Convert to seconds with 2 decimal places for better readability
    return `${(milliseconds / 1000).toFixed(2)} s`;
  }

  constructor() {
    this.workspaceId = this.data.workspaceId;
  }

  ngOnInit(): void {
    this.loadReplayStatistics();
  }

  private loadReplayStatistics(): void {
    this.loading = true;

    // Load replay frequency data
    this.backendService.getReplayFrequencyByUnit(this.workspaceId)
      .subscribe({
        next: data => {
          this.frequencyData = Object.entries(data).map(([unitId, count]) => ({
            name: unitId,
            value: count
          }));

          // Sort by frequency (highest first)
          this.frequencyData.sort((a, b) => b.value - a.value);

          // Load day distribution data
          this.loadDayDistribution();
        },
        error: () => {
          this.loading = false;
        }
      });
  }

  private loadDayDistribution(): void {
    this.backendService.getReplayDistributionByDay(this.workspaceId)
      .subscribe({
        next: data => {
          this.dayDistributionData = Object.entries(data).map(([day, count]) => ({
            name: day,
            value: count
          }));

          // Sort by date (oldest first)
          this.dayDistributionData.sort((a, b) => a.name.localeCompare(b.name));

          // Load hour distribution data
          this.loadHourDistribution();
        },
        error: () => {
          // Continue with duration statistics even if day distribution fails
          this.loadHourDistribution();
        }
      });
  }

  private loadHourDistribution(): void {
    this.backendService.getReplayDistributionByHour(this.workspaceId)
      .subscribe({
        next: data => {
          this.hourDistributionData = Object.entries(data).map(([hour, count]) => ({
            name: `${hour}:00`,
            value: count
          }));

          // Sort by hour (earliest first)
          this.hourDistributionData.sort((a, b) => {
            const hourA = parseInt(a.name.split(':')[0], 10);
            const hourB = parseInt(b.name.split(':')[0], 10);
            return hourA - hourB;
          });

          // Load duration statistics
          this.loadDurationStatistics();
        },
        error: () => {
          // Continue with duration statistics even if hour distribution fails
          this.loadDurationStatistics();
        }
      });
  }

  private loadDurationStatistics(): void {
    this.backendService.getReplayDurationStatistics(this.workspaceId)
      .subscribe({
        next: data => {
          // Set duration statistics
          this.durationStats = {
            min: data.min,
            max: data.max,
            average: data.average
          };

          // Set duration distribution data
          this.durationDistributionData = Object.entries(data.distribution).map(([range, count]) => ({
            name: range,
            value: count
          }));

          // Sort by duration range
          this.durationDistributionData.sort((a, b) => {
            const aStart = parseInt(a.name.split('-')[0], 10);
            const bStart = parseInt(b.name.split('-')[0], 10);
            return aStart - bStart;
          });

          // Set unit duration data
          if (data.unitAverages) {
            this.unitDurationData = Object.entries(data.unitAverages).map(([unitId, avgDuration]) => ({
              name: unitId,
              value: avgDuration as number
            }));

            // Sort by unit ID
            this.unitDurationData.sort((a, b) => a.name.localeCompare(b.name));
          }

          // Load error statistics
          this.loadErrorStatistics();
        },
        error: () => {
          // Continue with error statistics even if duration statistics fails
          this.loadErrorStatistics();
        }
      });
  }

  private loadErrorStatistics(): void {
    this.backendService.getReplayErrorStatistics(this.workspaceId)
      .subscribe({
        next: data => {
          this.errorStats = data;

          // Load failure distributions
          this.loadFailureDistributions();
        },
        error: () => {
          // Continue with failure distributions even if error statistics fails
          this.loadFailureDistributions();
        }
      });
  }

  private loadFailureDistributions(): void {
    // Load failure distribution by unit
    this.backendService.getFailureDistributionByUnit(this.workspaceId)
      .subscribe({
        next: data => {
          this.failureByUnitData = Object.entries(data).map(([unitId, count]) => ({
            name: unitId,
            value: count
          }));

          // Sort by unit ID
          this.failureByUnitData.sort((a, b) => a.name.localeCompare(b.name));

          // Load failure distribution by day
          this.loadFailureDistributionByDay();
        },
        error: () => {
          // Continue with day distribution even if unit distribution fails
          this.loadFailureDistributionByDay();
        }
      });
  }

  private loadFailureDistributionByDay(): void {
    this.backendService.getFailureDistributionByDay(this.workspaceId)
      .subscribe({
        next: data => {
          this.failureByDayData = Object.entries(data).map(([day, count]) => ({
            name: day,
            value: count
          }));

          // Sort by date (oldest first)
          this.failureByDayData.sort((a, b) => a.name.localeCompare(b.name));

          // Load failure distribution by hour
          this.loadFailureDistributionByHour();
        },
        error: () => {
          // Continue with hour distribution even if day distribution fails
          this.loadFailureDistributionByHour();
        }
      });
  }

  private loadFailureDistributionByHour(): void {
    this.backendService.getFailureDistributionByHour(this.workspaceId)
      .subscribe({
        next: data => {
          this.failureByHourData = Object.entries(data).map(([hour, count]) => ({
            name: `${hour}:00`,
            value: count
          }));

          // Sort by hour (earliest first)
          this.failureByHourData.sort((a, b) => {
            const hourA = parseInt(a.name.split(':')[0], 10);
            const hourB = parseInt(b.name.split(':')[0], 10);
            return hourA - hourB;
          });

          // Complete loading
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        }
      });
  }
}
