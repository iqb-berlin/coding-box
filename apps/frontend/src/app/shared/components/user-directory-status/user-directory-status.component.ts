import {
  ChangeDetectionStrategy, Component, input, output
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslateModule } from '@ngx-translate/core';
import type { UserDirectoryStatus } from '../../services/user/user-directory.facade';

@Component({
  selector: 'coding-box-user-directory-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, TranslateModule],
  template: `
    @if (status() === 'loading') {
      <p role="status">{{ 'admin.user-directory-loading' | translate }}</p>
    }
    @if (status() === 'error') {
      <div role="alert">
        <p>{{ 'admin.user-directory-error' | translate }}</p>
        <button mat-button type="button" (click)="retry.emit()">{{ 'admin.user-directory-retry' | translate }}</button>
      </div>
    }
    @if (status() === 'loaded' && empty()) {
      <p role="status">{{ 'admin.user-directory-empty' | translate }}</p>
    }
  `
})
export class UserDirectoryStatusComponent {
  readonly status = input.required<UserDirectoryStatus>();
  readonly empty = input.required<boolean>();
  readonly retry = output<void>();
}
