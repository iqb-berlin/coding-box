import { Component, inject, input } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ImpressumDialogComponent } from '../../shared/dialogs/impressum-dialog.component';

@Component({
  selector: 'coding-box-app-info',
  templateUrl: './app-info.component.html',
  styleUrls: ['./app-info.component.scss'],
  standalone: true,
  imports: [MatAnchor, TranslateModule, MatButton]
})
export class AppInfoComponent {
  private dialog = inject(MatDialog);

  readonly appTitle = input.required<string>();
  readonly introHtml = input.required<SafeUrl | undefined>();
  readonly appName = input.required<string>();
  readonly appVersion = input.required<string>();
  readonly userName = input.required<string | undefined>();
  readonly userLongName = input.required<string | undefined>();
  readonly isUserLoggedIn = input.required<boolean>();
  readonly isAdmin = input.required<boolean>();
  openImpressumDialog(): void {
    this.dialog.open(ImpressumDialogComponent, {
      width: '600px',
      maxHeight: '90vh'
    });
  }
}
