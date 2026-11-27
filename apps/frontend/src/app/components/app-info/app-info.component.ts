import {
  Component, inject, input, ChangeDetectionStrategy
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { catchError, map, of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SystemSettingsService } from '../../core/services/system-settings.service';
import { ImpressumDialogComponent } from '../../shared/dialogs/impressum-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-app-info',
  templateUrl: './app-info.component.html',
  styleUrls: ['./app-info.component.scss'],
  standalone: true,
  imports: [TranslateModule]
})
export class AppInfoComponent {
  private dialog = inject(MatDialog);

  readonly appVersion = input.required<string>();

  protected readonly imprintUrl = toSignal(inject(SystemSettingsService).getLegalNotice().pipe(
    map(notice => notice.imprintUrl),
    catchError(() => of(undefined))
  ));

  protected openNotice(section: 'imprint' | 'privacy'): void {
    this.dialog.open(ImpressumDialogComponent, {
      data: { section },
      width: '600px',
      maxHeight: '90vh'
    });
  }
}
