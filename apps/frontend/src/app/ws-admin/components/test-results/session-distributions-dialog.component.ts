import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

export type SessionDistributionsDialogData = {
  browserCounts: Record<string, number>;
  osCounts: Record<string, number>;
  screenCounts: Record<string, number>;
};

@Component({
  selector: 'coding-box-session-distributions-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatTooltipModule
  ],
  template: `
    <h2 mat-dialog-title>Sitzungen: Browser / OS / Screen</h2>
    <mat-dialog-content>
      <div class="dist-grid">
        <div class="dist-card">
          <div class="dist-title">Browser</div>
          <ng-container *ngIf="browserItems.length > 0; else emptyState">
            <div
              *ngFor="let it of browserItems"
              class="dist-row"
              [matTooltip]="getTooltip(it.key, it.count, browserTotal)"
            >
              <div class="dist-label">{{ it.key }}</div>
              <div class="dist-bar">
                <div
                  class="dist-bar-fill"
                  [style.width.%]="getPercent(it.count, browserTotal)"
                ></div>
              </div>
              <div class="dist-value">
                {{ it.count }}
                <span class="dist-percent"
                  >({{ getPercent(it.count, browserTotal) }}%)</span
                >
              </div>
            </div>
          </ng-container>
        </div>

        <div class="dist-card">
          <div class="dist-title">OS</div>
          <ng-container *ngIf="osItems.length > 0; else emptyState">
            <div
              *ngFor="let it of osItems"
              class="dist-row"
              [matTooltip]="getTooltip(it.key, it.count, osTotal)"
            >
              <div class="dist-label">{{ it.key }}</div>
              <div class="dist-bar">
                <div
                  class="dist-bar-fill"
                  [style.width.%]="getPercent(it.count, osTotal)"
                ></div>
              </div>
              <div class="dist-value">
                {{ it.count }}
                <span class="dist-percent"
                  >({{ getPercent(it.count, osTotal) }}%)</span
                >
              </div>
            </div>
          </ng-container>
        </div>

        <div class="dist-card">
          <div class="dist-title">Screen</div>
          <ng-container *ngIf="screenItems.length > 0; else emptyState">
            <div
              *ngFor="let it of screenItems"
              class="dist-row"
              [matTooltip]="getTooltip(it.key, it.count, screenTotal)"
            >
              <div class="dist-label">{{ it.key }}</div>
              <div class="dist-bar">
                <div
                  class="dist-bar-fill"
                  [style.width.%]="getPercent(it.count, screenTotal)"
                ></div>
              </div>
              <div class="dist-value">
                {{ it.count }}
                <span class="dist-percent"
                  >({{ getPercent(it.count, screenTotal) }}%)</span
                >
              </div>
            </div>
          </ng-container>
        </div>
      </div>

      <ng-template #emptyState>
        <div class="dist-empty">Keine Sitzungsdaten</div>
      </ng-template>
    </mat-dialog-content>

    <mat-divider></mat-divider>

    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Schließen</button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .dist-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
        gap: 14px;
      }

      .dist-card {
        background-color: #f9fafc;
        border: 1px solid rgba(0, 0, 0, 0.06);
        border-radius: 10px;
        padding: 12px 14px;
        overflow: hidden;
      }

      .dist-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 700;
        color: #1976d2;
        margin-bottom: 10px;
      }

      .dist-empty {
        font-size: 12px;
        color: #666;
        padding: 6px 0;
      }

      .dist-row {
        display: grid;
        grid-template-columns: minmax(90px, 1fr) 1.6fr auto;
        gap: 10px;
        align-items: center;
        padding: 4px 0;
      }

      .dist-label {
        font-size: 12px;
        font-weight: 600;
        color: #444;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dist-bar {
        height: 8px;
        background-color: rgba(25, 118, 210, 0.12);
        border-radius: 999px;
        overflow: hidden;
      }

      .dist-bar-fill {
        height: 100%;
        background-color: #1976d2;
        border-radius: 999px;
      }

      .dist-value {
        font-size: 12px;
        font-weight: 700;
        color: #1976d2;
        white-space: nowrap;
      }

      .dist-percent {
        font-weight: 600;
        color: #5c6b7a;
        margin-left: 4px;
      }
    `
  ]
})
export class SessionDistributionsDialogComponent {
  readonly browserItems = this.toSortedCountList(this.data.browserCounts);
  readonly osItems = this.toSortedCountList(this.data.osCounts);
  readonly screenItems = this.toSortedCountList(this.data.screenCounts);

  readonly browserTotal = this.totalCount(this.browserItems);
  readonly osTotal = this.totalCount(this.osItems);
  readonly screenTotal = this.totalCount(this.screenItems);

  constructor(
    @Inject(MAT_DIALOG_DATA)
    public data: SessionDistributionsDialogData
  ) {}

  private toSortedCountList(
    map?: Record<string, number>
  ): Array<{ key: string; count: number }> {
    const m = (map || {}) as Record<string, number>;
    return Object.entries(m)
      .map(([key, count]) => ({ key, count: Number(count) }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  private totalCount(list: Array<{ count: number }>): number {
    return list.reduce((sum, x) => sum + (Number(x.count) || 0), 0);
  }

  getPercent(count: number, total: number): number {
    const t = Number(total) || 0;
    if (t <= 0) {
      return 0;
    }
    return Math.round((Number(count) / t) * 1000) / 10;
  }

  getTooltip(label: string, count: number, total: number): string {
    return `${label}: ${count} (${this.getPercent(count, total)}%)`;
  }
}
