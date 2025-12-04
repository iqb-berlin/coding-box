import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { TranslateModule } from '@ngx-translate/core';

export interface ResetVersionDialogData {
  version: 'v1' | 'v2' | 'v3';
  versionLabel: string;
  affectedCount?: number;
  cascadeVersions?: string[];
}

@Component({
  selector: 'app-reset-version-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    TranslateModule
  ],
  template: `
    <div class="reset-dialog-container">
      <div class="dialog-header">
        <mat-icon class="warning-icon">warning</mat-icon>
        <h2 class="dialog-title">{{ 'coding-management.reset-dialog.title' | translate }}</h2>
      </div>

      <mat-divider></mat-divider>

      <div class="dialog-content">
        <p class="warning-text">
          {{ 'coding-management.reset-dialog.warning-message' | translate }}
        </p>

        <div class="version-info">
          <p class="version-label">{{ 'coding-management.reset-dialog.version-to-reset' | translate }}</p>
          <p class="version-value">{{ versionLabel | translate }}</p>
        </div>

        @if (cascadeVersions && cascadeVersions.length > 0) {
          <div class="cascade-info">
            <p class="cascade-warning">
              <mat-icon class="info-icon">info</mat-icon>
              {{ 'coding-management.reset-dialog.cascade-warning' | translate }}
            </p>
            <p class="cascade-versions">
              {{ 'coding-management.reset-dialog.cascade-versions' | translate }}: <strong>{{ cascadeVersions.join(', ') }}</strong>
            </p>
            <p class="cascade-explanation">
              {{ 'coding-management.reset-dialog.cascade-explanation' | translate }}
            </p>
          </div>
        }

        <p class="irreversible-warning">
          <mat-icon class="danger-icon">error</mat-icon>
          {{ 'coding-management.reset-dialog.irreversible-warning' | translate }}
        </p>
      </div>

      <mat-divider></mat-divider>

      <div class="dialog-actions">
        <button
          mat-raised-button
          (click)="onCancel()"
          class="cancel-button"
        >
          <mat-icon>cancel</mat-icon>
          {{ 'coding-management.reset-dialog.cancel-button' | translate }}
        </button>
        <button
          mat-raised-button
          color="warn"
          (click)="onConfirm()"
          class="confirm-button"
        >
          <mat-icon>restart_alt</mat-icon>
          {{ 'coding-management.reset-dialog.confirm-button' | translate }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .reset-dialog-container {
      display: flex;
      flex-direction: column;
      gap: 0;
      min-width: 450px;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 24px 24px 16px 24px;
      background: linear-gradient(135deg, #fff3e0 0%, #ffe0b2 100%);

      .warning-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        color: #f57c00;
      }

      .dialog-title {
        margin: 0;
        font-size: 20px;
        font-weight: 500;
        color: #d84315;
      }
    }

    .dialog-content {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;

      .warning-text {
        margin: 0;
        font-size: 14px;
        line-height: 1.6;
        color: #424242;
      }

      .version-info {
        background-color: #f5f5f5;
        padding: 12px 16px;
        border-radius: 4px;
        border-left: 4px solid #ff9800;

        .version-label {
          margin: 0 0 4px 0;
          font-size: 12px;
          font-weight: 500;
          color: #666666;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .version-value {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: #d84315;
        }
      }

      .cascade-info {
        background-color: #e3f2fd;
        padding: 12px 16px;
        border-radius: 4px;
        border-left: 4px solid #2196f3;

        .cascade-warning {
          margin: 0 0 8px 0;
          font-size: 13px;
          font-weight: 500;
          color: #1565c0;
          display: flex;
          align-items: center;
          gap: 8px;

          .info-icon {
            font-size: 18px;
            width: 18px;
            height: 18px;
            flex-shrink: 0;
          }
        }

        .cascade-versions {
          margin: 0;
          font-size: 13px;
          color: #0d47a1;
        }

        .cascade-explanation {
          margin: 8px 0 0 0;
          font-size: 12px;
          color: #0d47a1;
          line-height: 1.5;
          font-style: italic;
        }
      }

      .irreversible-warning {
        margin: 0;
        padding: 8px 12px;
        background-color: #ffebee;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        color: #c62828;
        display: flex;
        align-items: flex-start;
        gap: 8px;

        .danger-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          margin-top: 2px;
        }
      }
    }

    .dialog-actions {
      display: flex;
      gap: 12px;
      padding: 16px 24px;
      justify-content: flex-end;

      button {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 140px;

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }
      }

      .cancel-button {
        background-color: #e0e0e0;
        color: #424242;

        &:hover {
          background-color: #bdbdbd;
        }
      }

      .confirm-button {
        background-color: #d32f2f;

        &:hover {
          background-color: #b71c1c;
        }
      }
    }
  `]
})
export class ResetVersionDialogComponent {
  versionLabel: string;
  cascadeVersions: string[] = [];

  constructor(
    public dialogRef: MatDialogRef<ResetVersionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ResetVersionDialogData
  ) {
    this.versionLabel = data.versionLabel;
    this.cascadeVersions = data.cascadeVersions || [];
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
