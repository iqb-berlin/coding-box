import { Component, Input, inject } from '@angular/core';
import { SafeUrl } from '@angular/platform-browser';
import { TranslateModule } from '@ngx-translate/core';
import { MatAnchor } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { ImpressumDialogComponent } from '../../shared/dialogs/impressum-dialog.component';

@Component({
  selector: 'coding-box-app-info',
  templateUrl: './app-info.component.html',
  styleUrls: ['./app-info.component.scss'],
  standalone: true,
  imports: [MatAnchor, TranslateModule]
})
export class AppInfoComponent {
  private dialog = inject(MatDialog);

  @Input() appTitle!: string;
  @Input() introHtml!: SafeUrl | undefined;
  @Input() appName!: string;
  @Input() appVersion!: string;
  @Input() userName!: string | undefined;
  @Input() userLongName!: string | undefined;
  @Input() isUserLoggedIn!: boolean;
  @Input() isAdmin!: boolean;
  openImpressumDialog(): void {
    this.dialog.open(ImpressumDialogComponent, {
      width: '600px',
      maxHeight: '90vh'
    });
  }
}
