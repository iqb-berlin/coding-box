import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

export type ValidationStatus = 'not-run' | 'running' | 'success' | 'failed';

/**
 * Reusable component for displaying validation panel headers with status indicators
 */
@Component({
  selector: 'coding-box-validation-panel-header',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="validation-panel-header" [ngClass]="'validation-' + status">
      <div class="header-title">
        <mat-icon>{{ getStatusIcon() }}</mat-icon>
        <span class="title-text">{{ title }}</span>
      </div>
      <div class="header-badge">
        <span class="validation-badge" [ngClass]="'validation-' + status">
          {{ getBadgeText() }}
        </span>
      </div>
    </div>
  `,
  styles: [`
    .validation-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 10px;
      border-radius: 6px;
      border-left: 3px solid transparent;
    }

    .validation-panel-header.validation-running {
      background-color: rgba(33, 150, 243, 0.04);
      border-left-color: #2196F3;
    }

    .validation-panel-header.validation-success {
      background-color: rgba(76, 175, 80, 0.04);
      border-left-color: #4CAF50;
    }

    .validation-panel-header.validation-failed {
      background-color: rgba(244, 67, 54, 0.04);
      border-left-color: #F44336;
    }

    .validation-panel-header.validation-not-run {
      background-color: rgba(158, 158, 158, 0.03);
      border-left-color: #9E9E9E;
    }

    .header-title {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title-text {
      font-weight: 500;
    }

    .validation-badge {
      display: inline-flex;
      align-items: center;
      padding: 1px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 500;
      line-height: 18px;
      border: 1px solid rgba(0, 0, 0, 0.08);
    }

    .validation-badge.validation-running {
      background-color: rgba(33, 150, 243, 0.06);
      color: #0D47A1;
    }

    .validation-badge.validation-success {
      background-color: rgba(76, 175, 80, 0.06);
      color: #1B5E20;
    }

    .validation-badge.validation-failed {
      background-color: rgba(244, 67, 54, 0.06);
      color: #B71C1C;
    }

    .validation-badge.validation-not-run {
      background-color: rgba(158, 158, 158, 0.06);
      color: #616161;
    }
  `]
})
export class ValidationPanelHeaderComponent {
  @Input() title = '';
  @Input() status: ValidationStatus = 'not-run';
  @Input() badgeText?: string;
  @Input() errorCount?: number;

  getStatusIcon(): string {
    switch (this.status) {
      case 'running':
        return 'hourglass_empty';
      case 'failed':
        return 'error';
      case 'success':
        return 'check_circle';
      default:
        return 'radio_button_unchecked';
    }
  }

  getBadgeText(): string {
    if (this.badgeText) {
      return this.badgeText;
    }

    switch (this.status) {
      case 'running':
        return 'Läuft…';
      case 'failed':
        return this.errorCount !== undefined ? `${this.errorCount} Fehler` : 'Fehler';
      case 'success':
        return 'OK';
      default:
        return 'Nicht ausgeführt';
    }
  }
}
