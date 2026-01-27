import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

export type OverallValidationStatus = 'not-run' | 'running' | 'success' | 'failed' | 'partial';

/**
 * Component for displaying overall validation status banner
 */
@Component({
  selector: 'coding-box-validation-result-banner',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="validation-result" [ngClass]="'validation-' + status">
      <mat-icon>{{ getStatusIcon() }}</mat-icon>
      <div class="result-content">
        <div class="headline"><strong>{{ headline }}</strong></div>
        <div class="subline" *ngIf="subline">{{ subline }}</div>
        <div class="recommendation" *ngIf="recommendation">{{ recommendation }}</div>
      </div>
    </div>
  `,
  styles: [`
    .validation-result {
      display: flex;
      align-items: center;
      margin: 10px 0;
      padding: 8px 16px;
      border-radius: 4px;
      font-weight: 500;
    }

    .validation-running {
      background-color: rgba(33, 150, 243, 0.1);
      color: #2196F3;
      border: 1px solid #2196F3;
    }

    .validation-failed {
      background-color: rgba(244, 67, 54, 0.1);
      color: #F44336;
      border: 1px solid #F44336;
    }

    .validation-success {
      background-color: rgba(76, 175, 80, 0.1);
      color: #4CAF50;
      border: 1px solid #4CAF50;
    }

    .validation-not-run {
      background-color: rgba(158, 158, 158, 0.1);
      color: #9E9E9E;
      border: 1px solid #9E9E9E;
    }

    .validation-partial {
      background-color: rgba(255, 152, 0, 0.1);
      color: #FF9800;
      border: 1px solid #FF9800;
    }

    .validation-result mat-icon {
      margin-right: 8px;
      flex-shrink: 0;
    }

    .result-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }

    .headline {
      font-size: 16px;
    }

    .subline {
      font-size: 14px;
      font-weight: normal;
    }

    .recommendation {
      font-size: 13px;
      font-weight: normal;
      opacity: 0.9;
    }
  `]
})
export class ValidationResultBannerComponent {
  @Input() status: OverallValidationStatus = 'not-run';
  @Input() headline = '';
  @Input() subline = '';
  @Input() recommendation = '';

  getStatusIcon(): string {
    switch (this.status) {
      case 'running':
        return 'hourglass_empty';
      case 'failed':
        return 'error';
      case 'success':
        return 'check_circle';
      case 'partial':
        return 'warning';
      default:
        return 'radio_button_unchecked';
    }
  }
}
