import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslateModule } from '@ngx-translate/core';
import { ResetCodingPreviewState } from './reset-coding-preview-state.service';

@Component({
  selector: 'coding-box-reset-coding-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatButtonModule, MatProgressBarModule, TranslateModule],
  template: `
    <p>{{ 'ui-text.reset-version-dialog.preview-help' | translate }}</p>
    <button mat-stroked-button class="check-scope-button" (click)="preview.check()" [disabled]="!preview.hasScope() || preview.busy()">
      {{ 'ui-text.reset-version-dialog.check-scope' | translate }}
    </button>
    <div aria-live="polite" role="status">
      @if (preview.busy()) {
        <p>{{ 'ui-text.reset-version-dialog.preview-running' | translate }}</p>
        <mat-progress-bar mode="indeterminate"></mat-progress-bar>
      } @else if (preview.failed()) {
        <p>{{ 'ui-text.reset-version-dialog.preview-failed' | translate }}</p>
      } @else if (preview.result(); as result) {
        @if (result.unknownUnits.length) {
          <p>{{ 'ui-text.reset-version-dialog.unknown-units' | translate: { values: result.unknownUnits.join(', ') } }}</p>
        }
        @if (result.unknownVariables.length) {
          <p>{{ 'ui-text.reset-version-dialog.unknown-variables' | translate: { values: result.unknownVariables.join(', ') } }}</p>
        }
        @if (result.status === 'valid') {
          <p class="preview-count">{{ 'ui-text.reset-version-dialog.affected-responses' | translate: { count: result.affectedResponseCount | number } }}</p>
          @if (result.deletedGeneratedResponseCount) {
            <p>{{ 'ui-text.reset-version-dialog.generated-cleanup' | translate: { count: result.deletedGeneratedResponseCount | number } }}</p>
          }
          @if (!result.affectedResponseCount) {
            <p>{{ 'ui-text.reset-version-dialog.no-affected-responses' | translate }}</p>
          }
          <p>{{ 'ui-text.reset-version-dialog.preview-snapshot' | translate }}</p>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; overflow-wrap: anywhere; }
    .preview-count { font-weight: 600; }
  `]
})
export class ResetCodingPreviewComponent {
  protected readonly preview = inject(ResetCodingPreviewState);
}
