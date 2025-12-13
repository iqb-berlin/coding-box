import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { Clipboard } from '@angular/cdk/clipboard';

import { AppService } from '../../../services/app.service';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';
import { JournalComponent } from '../journal/journal.component';
import { EditMissingsProfilesDialogComponent } from '../../../coding/components/edit-missings-profiles-dialog/edit-missings-profiles-dialog.component';
import { ReplayStatisticsDialogComponent } from '../replay-statistics-dialog/replay-statistics-dialog.component';
import { AccessRightsMatrixDialogComponent } from '../access-rights-matrix-dialog/access-rights-matrix-dialog.component';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';

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
    MatSlideToggleModule,
    MatProgressBarModule,
    MatTooltipModule,
    CdkTextareaAutosize,
    WsAccessRightsComponent,
    JournalComponent
  ]
})
export class WsSettingsComponent implements OnInit {
  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private translateService = inject(TranslateService);

  authToken: string | null = null;
  duration = 60;
  autoFetchCodingStatistics = true;
  isExporting = false;

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.workspaceSettingsService.getAutoFetchCodingStatistics(workspaceId)
        .subscribe(enabled => {
          this.autoFetchCodingStatistics = enabled;
        });
    }
  }

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
        this.snackBar.open(this.translateService.instant('ws-settings.token-generated-successfully'), this.translateService.instant('close'), { duration: 3000 });
      });
  }

  copyToken(): void {
    if (this.authToken) {
      this.clipboard.copy(this.authToken);
      this.snackBar.open(this.translateService.instant('ws-settings.token-copied-to-clipboard'), this.translateService.instant('close'), { duration: 3000 });
    }
  }

  editMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.dialog.open(EditMissingsProfilesDialogComponent, {
        width: '1600px',
        data: { workspaceId }
      });
    }
  }

  openAccessRightsMatrix(): void {
    this.dialog.open(AccessRightsMatrixDialogComponent, {
      width: '1200px',
      maxHeight: '90vh'
    });
  }

  toggleAutoFetchCodingStatistics(toggleEvent: { checked: boolean }
  ): void {
    this.autoFetchCodingStatistics = toggleEvent.checked;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService.setAutoFetchCodingStatistics(workspaceId, this.autoFetchCodingStatistics)
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.autoFetchCodingStatistics ?
                this.translateService.instant('ws-settings.auto-fetch-coding-statistics-enabled') :
                this.translateService.instant('ws-settings.auto-fetch-coding-statistics-disabled'),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.snackBar.open(this.translateService.instant('ws-settings.error-saving-setting'), this.translateService.instant('close'), {
              duration: 3000,
              panelClass: ['error-snackbar']
            });
            this.autoFetchCodingStatistics = !this.autoFetchCodingStatistics;
          }
        });
    }
  }

  exportWorkspaceDatabase(): void {
    if (this.isExporting) {
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('ws-settings.no-workspace-selected'), this.translateService.instant('close'), { duration: 3000 });
      return;
    }

    this.isExporting = true;
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    document.body.appendChild(anchor);

    const apiUrl = `${window.location.origin}/api/admin/workspace/${workspaceId}/export/sqlite`;
    const token = localStorage.getItem('id_token');

    if (!token) {
      this.snackBar.open(this.translateService.instant('ws-settings.authentication-required'), this.translateService.instant('close'), { duration: 5000 });
      this.isExporting = false;
      return;
    }

    fetch(apiUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/x-sqlite3'
      }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        const url = window.URL.createObjectURL(blob);
        anchor.href = url;
        anchor.download = `workspace-${workspaceId}-export-${new Date().toISOString().split('T')[0]}.sqlite`;
        anchor.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(anchor);

        this.snackBar.open(this.translateService.instant('ws-settings.workspace-database-exported-successfully'), this.translateService.instant('close'), { duration: 3000 });
      })
      .catch(() => {
        this.snackBar.open(this.translateService.instant('ws-settings.error-exporting-workspace-database-retry'), this.translateService.instant('close'), { duration: 5000 });
        if (document.body.contains(anchor)) {
          document.body.removeChild(anchor);
        }
      })
      .finally(() => {
        this.isExporting = false;
      });
  }
}
