import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { Clipboard } from '@angular/cdk/clipboard';

import { AppService } from '../../../services/app.service';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';
import { JournalComponent } from '../journal/journal.component';
import { EditMissingsProfilesDialogComponent } from '../../../coding/components/edit-missings-profiles-dialog/edit-missings-profiles-dialog.component';
import { ReplayStatisticsDialogComponent } from '../replay-statistics-dialog/replay-statistics-dialog.component';

@Component({
  selector: 'coding-box-ws-settings',
  templateUrl: './ws-settings.component.html',
  styleUrls: ['./ws-settings.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    TranslateModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCardModule,
    MatIconModule,
    MatDialogModule,
    CdkTextareaAutosize,
    WsAccessRightsComponent,
    JournalComponent
  ]
})
export class WsSettingsComponent {
  private appService = inject(AppService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  authToken: string | null = null;
  duration = 60;

  openReplayStatistics(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.dialog.open(ReplayStatisticsDialogComponent, {
        width: '900px',
        data: { workspaceId }
      });
    }
  }

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

  editMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.dialog.open(EditMissingsProfilesDialogComponent, {
        width: '900px',
        data: { workspaceId }
      });
    }
  }
}
