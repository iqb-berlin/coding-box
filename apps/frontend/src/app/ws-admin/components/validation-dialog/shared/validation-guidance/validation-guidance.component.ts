import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

/**
 * Component for displaying validation guidance with "why" and "how to fix" information
 */
@Component({
  selector: 'coding-box-validation-guidance',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  template: `
    <div class="validation-details">
      <p class="validation-details-intro" *ngIf="description">{{ description }}</p>

      <div class="validation-guidance">
        <div class="info-banner" *ngIf="whyText">
          <mat-icon>help</mat-icon>
          <span><strong>Warum ist das wichtig?</strong> {{ whyText }}</span>
        </div>
        <div class="info-banner" *ngIf="fixHint">
          <mat-icon>build</mat-icon>
          <span><strong>So beheben Sie es:</strong> {{ fixHint }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .validation-details {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 6px 2px 2px 2px;
    }

    .validation-details-intro {
      margin: 0;
      opacity: 0.9;
    }

    .validation-guidance {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    @media (max-width: 900px) {
      .validation-guidance {
        grid-template-columns: 1fr;
      }
    }

    .validation-guidance .info-banner {
      margin: 0;
    }

    .info-banner {
      display: flex;
      align-items: flex-start;
      padding: 8px 16px;
      border-radius: 4px;
      background-color: rgba(33, 150, 243, 0.1);
      color: #2196F3;
      border: 1px solid #2196F3;
    }

    .info-banner span {
      flex: 1 1 auto;
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      line-height: 1.35;
    }

    .info-banner mat-icon {
      flex: 0 0 auto;
      width: 24px;
      height: 24px;
      line-height: 24px;
      margin-right: 8px;
    }
  `]
})
export class ValidationGuidanceComponent {
  @Input() description?: string;
  @Input() whyText?: string;
  @Input() fixHint?: string;
}
