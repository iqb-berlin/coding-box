import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
  Component, inject, OnDestroy, OnInit
} from '@angular/core';
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
import { Subscription, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { AppService } from '../../../core/services/app.service';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';
import { JournalComponent } from '../journal/journal.component';
import { EditMissingsProfilesDialogComponent } from '../../../coding/components/edit-missings-profiles-dialog/edit-missings-profiles-dialog.component';
import { ReplayStatisticsDialogComponent } from '../replay-statistics-dialog/replay-statistics-dialog.component';
import { AccessRightsMatrixDialogComponent } from '../access-rights-matrix-dialog/access-rights-matrix-dialog.component';
import { WorkspaceSettingsService } from '../../services/workspace-settings.service';
import { ProcessOverviewComponent } from '../process-overview/process-overview.component';
import { SERVER_URL } from '../../../injection-tokens';

type DatabaseExportStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface DatabaseExportJobState {
  status: DatabaseExportStatus;
  progress: number;
  result?: {
    fileName: string;
    fileSize: number;
    createdAt: number;
    requestedByUserId: number;
    scope: 'system' | 'workspace';
    workspaceId?: number;
  };
  error?: string;
}

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
export class WsSettingsComponent implements OnInit, OnDestroy {
  private appService: AppService = inject(AppService);
  private http = inject(HttpClient);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private translateService = inject(TranslateService);
  private rawServerUrl = inject(SERVER_URL);
  private exportPollingSubscription: Subscription | null = null;

  authToken: string | null = null;
  duration = 60;
  readonly minTokenDurationDays = 1;
  readonly maxTokenDurationDays = 90;
  autoFetchCodingStatistics = true;
  autoRefreshManualCodingJobs = true;
  includeDeriveErrorInManualCoding = false;
  showTestResultsLogAnomalies = false;
  isExporting = false;
  databaseExportProgress = 0;
  databaseExportStatus: DatabaseExportStatus | null = null;
  databaseExportError: string | null = null;

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.workspaceSettingsService
        .getAutoFetchCodingStatistics(workspaceId)
        .subscribe(enabled => {
          this.autoFetchCodingStatistics = enabled;
        });
      this.workspaceSettingsService
        .getAutoRefreshManualCodingJobs(workspaceId)
        .subscribe(enabled => {
          this.autoRefreshManualCodingJobs = enabled;
        });
      this.workspaceSettingsService
        .getIncludeDeriveErrorInManualCoding(workspaceId)
        .subscribe(enabled => {
          this.includeDeriveErrorInManualCoding = enabled;
        });
      this.workspaceSettingsService
        .getShowTestResultsLogAnomalies(workspaceId)
        .subscribe(enabled => {
          this.showTestResultsLogAnomalies = enabled;
        });
    }
  }

  ngOnDestroy(): void {
    this.stopExportPolling();
  }

  openProcessOverview(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.dialog.open(ProcessOverviewComponent, {
        width: '1200px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        data: { workspaceId }
      });
    }
  }

  openReplayStatistics(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.dialog.open(ReplayStatisticsDialogComponent, {
        width: '88vw',
        maxWidth: '1400px',
        height: '85vh',
        maxHeight: '85vh',
        data: { workspaceId }
      });
    }
  }

  createToken(): void {
    if (!this.isTokenDurationValid()) {
      this.snackBar.open(
        this.translateService.instant('ws-settings.token-duration-invalid'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }

    this.appService
      .createOwnToken(
        this.appService.selectedWorkspaceId,
        Number(this.duration)
      )
      .subscribe({
        next: (authToken: string) => {
          this.authToken = authToken;
          this.snackBar.open(
            this.translateService.instant(
              'ws-settings.token-generated-successfully'
            ),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('ws-settings.token-generation-failed'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        }
      });
  }

  isTokenDurationValid(): boolean {
    const duration = Number(this.duration);
    return Number.isInteger(duration) &&
      duration >= this.minTokenDurationDays &&
      duration <= this.maxTokenDurationDays;
  }

  copyToken(): void {
    if (this.authToken) {
      this.clipboard.copy(this.authToken);
      this.snackBar.open(
        this.translateService.instant('ws-settings.token-copied-to-clipboard'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
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

  toggleAutoFetchCodingStatistics(toggleEvent: { checked: boolean }): void {
    this.autoFetchCodingStatistics = toggleEvent.checked;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setAutoFetchCodingStatistics(
          workspaceId,
          this.autoFetchCodingStatistics
        )
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.autoFetchCodingStatistics ?
                this.translateService.instant(
                  'ws-settings.auto-fetch-coding-statistics-enabled'
                ) :
                this.translateService.instant(
                  'ws-settings.auto-fetch-coding-statistics-disabled'
                ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.snackBar.open(
              this.translateService.instant('ws-settings.error-saving-setting'),
              this.translateService.instant('close'),
              {
                duration: 3000,
                panelClass: ['error-snackbar']
              }
            );
            this.autoFetchCodingStatistics = !this.autoFetchCodingStatistics;
          }
        });
    }
  }

  toggleAutoRefreshManualCodingJobs(toggleEvent: { checked: boolean }): void {
    this.autoRefreshManualCodingJobs = toggleEvent.checked;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setAutoRefreshManualCodingJobs(
          workspaceId,
          this.autoRefreshManualCodingJobs
        )
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.autoRefreshManualCodingJobs ?
                this.translateService.instant(
                  'ws-settings.auto-refresh-manual-coding-jobs-enabled'
                ) :
                this.translateService.instant(
                  'ws-settings.auto-refresh-manual-coding-jobs-disabled'
                ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.snackBar.open(
              this.translateService.instant('ws-settings.error-saving-setting'),
              this.translateService.instant('close'),
              {
                duration: 3000,
                panelClass: ['error-snackbar']
              }
            );
            this.autoRefreshManualCodingJobs = !this.autoRefreshManualCodingJobs;
          }
        });
    }
  }

  toggleIncludeDeriveErrorInManualCoding(toggleEvent: { checked: boolean }): void {
    this.includeDeriveErrorInManualCoding = toggleEvent.checked;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setIncludeDeriveErrorInManualCoding(
          workspaceId,
          this.includeDeriveErrorInManualCoding
        )
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.includeDeriveErrorInManualCoding ?
                this.translateService.instant(
                  'ws-settings.include-derive-error-in-manual-coding-enabled'
                ) :
                this.translateService.instant(
                  'ws-settings.include-derive-error-in-manual-coding-disabled'
                ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.snackBar.open(
              this.translateService.instant('ws-settings.error-saving-setting'),
              this.translateService.instant('close'),
              {
                duration: 3000,
                panelClass: ['error-snackbar']
              }
            );
            this.includeDeriveErrorInManualCoding =
              !this.includeDeriveErrorInManualCoding;
          }
        });
    }
  }

  toggleShowTestResultsLogAnomalies(toggleEvent: { checked: boolean }): void {
    this.showTestResultsLogAnomalies = toggleEvent.checked;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setShowTestResultsLogAnomalies(
          workspaceId,
          this.showTestResultsLogAnomalies
        )
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.showTestResultsLogAnomalies ?
                this.translateService.instant(
                  'ws-settings.show-test-results-log-anomalies-enabled'
                ) :
                this.translateService.instant(
                  'ws-settings.show-test-results-log-anomalies-disabled'
                ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.snackBar.open(
              this.translateService.instant('ws-settings.error-saving-setting'),
              this.translateService.instant('close'),
              {
                duration: 3000,
                panelClass: ['error-snackbar']
              }
            );
            this.showTestResultsLogAnomalies =
              !this.showTestResultsLogAnomalies;
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
      this.snackBar.open(
        this.translateService.instant('ws-settings.no-workspace-selected'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }

    const authHeaders = this.getAuthHeaders();
    if (!authHeaders) {
      this.snackBar.open(
        this.translateService.instant('ws-settings.authentication-required'),
        this.translateService.instant('close'),
        { duration: 5000 }
      );
      return;
    }

    this.isExporting = true;
    this.databaseExportProgress = 0;
    this.databaseExportStatus = 'queued';
    this.databaseExportError = null;

    const apiUrl = this.getWorkspaceDatabaseExportApiUrl(workspaceId);

    this.http
      .post<{ jobId: string; message: string }>(`${apiUrl}/job`, {}, { headers: authHeaders })
      .subscribe({
        next: ({ jobId }) => {
          this.startExportPolling(workspaceId, jobId, authHeaders);
        },
        error: error => {
          this.isExporting = false;
          const message = this.extractErrorMessage(
            error,
            this.translateService.instant('ws-settings.error-starting-workspace-database-export')
          );
          this.databaseExportError = message;
          this.databaseExportStatus = 'failed';
          this.snackBar.open(message, this.translateService.instant('close'), { duration: 5000 });
        }
      });
  }

  getDatabaseExportStatusLabel(): string {
    switch (this.databaseExportStatus) {
      case 'queued':
        return this.translateService.instant('ws-settings.export-status-queued');
      case 'running':
        return this.translateService.instant('ws-settings.export-status-running');
      case 'completed':
        return this.translateService.instant('ws-settings.export-status-completed');
      case 'failed':
        return this.translateService.instant('ws-settings.export-status-failed');
      case 'cancelled':
        return this.translateService.instant('ws-settings.export-status-cancelled');
      default:
        return this.translateService.instant('ws-settings.export-status-unknown');
    }
  }

  private startExportPolling(
    workspaceId: number,
    jobId: string,
    headers: HttpHeaders
  ): void {
    this.stopExportPolling();

    const apiUrl = this.getWorkspaceDatabaseExportApiUrl(workspaceId);

    this.exportPollingSubscription = timer(0, 2000)
      .pipe(
        switchMap(() => this.http.get<DatabaseExportJobState>(
          `${apiUrl}/job/${jobId}`,
          { headers }
        ))
      )
      .subscribe({
        next: state => {
          this.databaseExportStatus = state.status;
          this.databaseExportProgress = Math.max(0, Math.min(100, Math.round(state.progress || 0)));

          if (state.status === 'completed') {
            this.databaseExportProgress = 100;
            this.stopExportPolling();
            this.downloadExportFile(workspaceId, jobId, headers);
            return;
          }

          if (state.status === 'failed' || state.status === 'cancelled') {
            this.stopExportPolling();
            this.isExporting = false;
            const message =
              state.error ||
              this.translateService.instant('ws-settings.error-exporting-workspace-database-retry');
            this.databaseExportError = message;
            this.snackBar.open(
              message,
              this.translateService.instant('close'),
              { duration: 5000 }
            );
          }
        },
        error: error => {
          this.stopExportPolling();
          this.isExporting = false;
          const message = this.extractErrorMessage(
            error,
            this.translateService.instant('ws-settings.error-fetching-workspace-database-export-status')
          );
          this.databaseExportStatus = 'failed';
          this.databaseExportError = message;
          this.snackBar.open(message, this.translateService.instant('close'), { duration: 5000 });
        }
      });
  }

  private downloadExportFile(
    workspaceId: number,
    jobId: string,
    headers: HttpHeaders
  ): void {
    const apiUrl = this.getWorkspaceDatabaseExportApiUrl(workspaceId);

    this.http
      .get(`${apiUrl}/job/${jobId}/download`, {
        headers,
        responseType: 'blob'
      })
      .subscribe({
        next: blob => {
          this.saveBlob(
            blob,
            `workspace-${workspaceId}-export-${new Date().toISOString().split('T')[0]}.sqlite`
          );
          this.isExporting = false;
          this.databaseExportStatus = 'completed';
          this.databaseExportError = null;
          this.snackBar.open(
            this.translateService.instant('ws-settings.workspace-database-exported-successfully'),
            this.translateService.instant('close'),
            { duration: 3000 }
          );
        },
        error: error => {
          this.isExporting = false;
          this.databaseExportStatus = 'failed';
          this.databaseExportError = this.extractErrorMessage(
            error,
            this.translateService.instant('ws-settings.error-downloading-workspace-database-export')
          );
          this.snackBar.open(
            this.databaseExportError,
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      });
  }

  private stopExportPolling(): void {
    if (this.exportPollingSubscription) {
      this.exportPollingSubscription.unsubscribe();
      this.exportPollingSubscription = null;
    }
  }

  private getAuthHeaders(): HttpHeaders | null {
    const token = localStorage.getItem('id_token');
    if (!token) {
      return null;
    }

    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
      Accept: 'application/json'
    });
  }

  private getWorkspaceDatabaseExportApiUrl(workspaceId: number): string {
    return `${this.serverUrl}/admin/workspace/${workspaceId}/export/sqlite`;
  }

  private get serverUrl(): string {
    return this.rawServerUrl.endsWith('/') ?
      this.rawServerUrl.slice(0, -1) :
      this.rawServerUrl;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.style.display = 'none';
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
  }

  private extractErrorMessage(error: unknown, fallback: string): string {
    const payload = error as {
      error?: {
        message?: string | string[];
      };
      message?: string;
    };

    if (Array.isArray(payload?.error?.message)) {
      return payload.error.message.join(', ');
    }

    if (typeof payload?.error?.message === 'string') {
      return payload.error.message;
    }

    if (typeof payload?.message === 'string') {
      return payload.message;
    }

    return fallback;
  }
}
