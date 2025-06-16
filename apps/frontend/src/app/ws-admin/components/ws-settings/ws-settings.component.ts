import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { Clipboard } from '@angular/cdk/clipboard';

import { AppService } from '../../../services/app.service';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';

@Component({
  selector: 'coding-box-ws-settings',
  templateUrl: './ws-settings.component.html',
  styleUrls: ['./ws-settings.component.scss'],
  imports: [
    FormsModule,
    TranslateModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatIconModule,
    CdkTextareaAutosize,
    WsAccessRightsComponent
  ]
})
export class WsSettingsComponent {
  private appService = inject(AppService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);

  authToken: string | null = null;
  duration = 60;

  createToken(): void {
    this.appService
      .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', this.duration)
      .subscribe(authToken => {
        this.authToken = authToken;
        this.snackBar.open('Token erfolgreich generiert', 'Schließen', { duration: 3000 });
      });
  }

  copyToken(): void {
    if (this.authToken) {
      this.clipboard.copy(this.authToken);
      this.snackBar.open('Token in die Zwischenablage kopiert', 'Schließen', { duration: 3000 });
    }
  }
}
