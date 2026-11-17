import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import type { ResetVersionDialogResult } from './reset-version-dialog.component';

@Component({
  selector: 'coding-box-reset-filter-details-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, TranslateModule],
  template: `
    <h2 mat-dialog-title>{{ 'ui-text.reset-version-dialog.filter-details-title' | translate }}</h2>
    <mat-dialog-content tabindex="0">
      <h3>{{ 'coding-management.reset-dialog.units-label' | translate }}</h3>
      @if (data.unitFilters.length) {
        <ul data-cy="reset-unit-details">
          @for (unit of data.unitFilters; track unit) {
            <li>{{ unit }}</li>
          }
        </ul>
      } @else {
        <p>{{ 'coding-management.reset-dialog.all-units' | translate }}</p>
      }
      <h3>{{ 'ui-text.reset-version-dialog.variables-title' | translate }}</h3>
      @if (data.variableFilters.length) {
        <ul data-cy="reset-variable-details">
          @for (variable of data.variableFilters; track variable) {
            <li>{{ variable }}</li>
          }
        </ul>
      } @else {
        <p>{{ 'coding-management.reset-dialog.all-variables' | translate }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'deferred-view.close' | translate }}</button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host {
      display: block;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    mat-dialog-content {
      overscroll-behavior: contain;
    }

    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      list-style: none;
      padding: 0;
    }

    li {
      max-width: 100%;
    }
  `]
})
export class ResetFilterDetailsDialogComponent {
  protected readonly data = inject<ResetVersionDialogResult>(MAT_DIALOG_DATA);
}
