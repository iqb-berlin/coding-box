import {
  Component, inject, OnDestroy, OnInit, signal, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

import { AppService, WorkspaceTokenPolicy } from '../../../core/services/app.service';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';
import { JournalComponent } from '../journal/journal.component';
import { EditMissingsProfilesDialogComponent } from '../../../coding/components/edit-missings-profiles-dialog/edit-missings-profiles-dialog.component';
import { ReplayStatisticsDialogComponent } from '../replay-statistics-dialog/replay-statistics-dialog.component';
import {
  DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  DEFAULT_REPLAY_URL_EXPORT_MODE,
  DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS,
  EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES,
  MAX_AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  MIN_AUTH_SESSION_IDLE_TIMEOUT_MINUTES,
  type ReplayUrlExportMode,
  WorkspaceTokenScope
} from '../../../core/services/auth-session.config';
import { AccessRightsMatrixDialogComponent } from '../access-rights-matrix-dialog/access-rights-matrix-dialog.component';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { ProcessOverviewComponent } from '../process-overview/process-overview.component';
import { DatabaseExportService } from '../../../shared/services/database-export.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-ws-settings',
  templateUrl: './ws-settings.component.html',
  styleUrls: ['./ws-settings.component.scss'],
  standalone: true,
  providers: [DatabaseExportService],
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
  private readonly destroyRef = inject(DestroyRef);

  private appService: AppService = inject(AppService);
  private readonly databaseExport = inject(DatabaseExportService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private clipboard = inject(Clipboard);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private translateService = inject(TranslateService);

  readonly authToken = signal<string | null>(null);
  readonly duration = signal(DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS);
  protected readonly minTokenDurationDays = 1;
  readonly maxTokenDurationDays = signal(DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS);
  protected readonly minAuthSessionIdleTimeoutMinutes = MIN_AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
  protected readonly maxAuthSessionIdleTimeoutMinutes = MAX_AUTH_SESSION_IDLE_TIMEOUT_MINUTES;
  readonly externalReplayTokenScopes = EXTERNAL_REPLAY_WORKSPACE_TOKEN_SCOPES;
  readonly replayUrlExportMode = signal<ReplayUrlExportMode>(DEFAULT_REPLAY_URL_EXPORT_MODE);
  readonly replayUrlExportTokenDurationDays = signal(DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS);
  readonly authSessionIdleTimeoutMinutes = signal(DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES);
  readonly autoFetchCodingStatistics = signal(true);
  readonly autoRefreshManualCodingJobs = signal(true);
  readonly evaluationMode = signal(false);
  readonly includeDeriveErrorInManualCoding = signal(false);
  readonly enableRegexSearch = signal(false);
  readonly showTestResultsLogAnomalies = signal(false);
  readonly isExporting = this.databaseExport.isExporting;
  protected readonly databaseExportProgress = this.databaseExport.progress;
  readonly databaseExportStatus = this.databaseExport.status;
  protected readonly databaseExportError = this.databaseExport.error;

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.loadWorkspaceTokenPolicy(workspaceId);
    if (workspaceId) {
      this.workspaceSettingsService
        .getReplayUrlExportMode(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(mode => {
          this.replayUrlExportMode.set(mode);
        });
      this.workspaceSettingsService
        .getAuthSessionIdleTimeoutMinutes(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(timeoutMinutes => {
          this.authSessionIdleTimeoutMinutes.set(timeoutMinutes);
        });
      this.workspaceSettingsService
        .getEvaluationMode(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.evaluationMode.set(enabled);
          if (enabled) {
            this.applyEvaluationModeLocalPreset(true);
          }
        });
      this.workspaceSettingsService
        .getAutoFetchCodingStatistics(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.autoFetchCodingStatistics.set(this.evaluationMode() ?
            false :
            enabled);
        });
      this.workspaceSettingsService
        .getAutoRefreshManualCodingJobs(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.autoRefreshManualCodingJobs.set(this.evaluationMode() ?
            false :
            enabled);
        });
      this.workspaceSettingsService
        .getIncludeDeriveErrorInManualCoding(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.includeDeriveErrorInManualCoding.set(enabled);
        });
      this.workspaceSettingsService
        .getEnableRegexSearch(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.enableRegexSearch.set(enabled);
        });
      this.workspaceSettingsService
        .getShowTestResultsLogAnomalies(workspaceId).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.showTestResultsLogAnomalies.set(enabled);
        });
    }
  }

  ngOnDestroy(): void {
    this.databaseExport.cancel();
  }

  protected openProcessOverview(): void {
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
        Number(this.duration()),
        this.externalReplayTokenScopes
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (authToken: string) => {
          this.authToken.set(authToken);
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
    const duration = Number(this.duration());
    return this.isDurationWithinReplayTokenPolicy(duration);
  }

  protected isReplayUrlExportTokenDurationValid(): boolean {
    const duration = Number(this.replayUrlExportTokenDurationDays());
    return this.isDurationWithinReplayTokenPolicy(duration);
  }

  protected isAuthSessionIdleTimeoutValid(): boolean {
    const duration = Number(this.authSessionIdleTimeoutMinutes());
    return Number.isInteger(duration) &&
      duration >= this.minAuthSessionIdleTimeoutMinutes &&
      duration <= this.maxAuthSessionIdleTimeoutMinutes;
  }

  private isDurationWithinReplayTokenPolicy(duration: number): boolean {
    return Number.isInteger(duration) &&
      duration >= this.minTokenDurationDays &&
      duration <= this.maxTokenDurationDays();
  }

  private loadWorkspaceTokenPolicy(workspaceId?: number): void {
    this.appService.getWorkspaceTokenPolicy().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: policy => {
        this.maxTokenDurationDays.set(this.getMaxTokenDurationDaysForScopes(policy, this.externalReplayTokenScopes));
        if (Number(this.duration()) > this.maxTokenDurationDays()) {
          this.duration.set(this.maxTokenDurationDays());
        }
        if (workspaceId) {
          this.loadReplayUrlExportTokenDuration(workspaceId);
        }
      }
    });
  }

  private loadReplayUrlExportTokenDuration(workspaceId: number): void {
    this.workspaceSettingsService
      .getReplayUrlExportTokenDurationDays(
        workspaceId,
        this.maxTokenDurationDays()
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(durationDays => {
        this.replayUrlExportTokenDurationDays.set(durationDays);
      });
  }

  private getMaxTokenDurationDaysForScopes(
    policy: WorkspaceTokenPolicy,
    scopes: WorkspaceTokenScope[]
  ): number {
    const maxDurations = scopes
      .map(scope => policy.scopes[scope]?.maxDurationDays)
      .filter((duration): duration is number => (
        Number.isInteger(duration) &&
        duration >= this.minTokenDurationDays
      ));

    return maxDurations.length ? Math.min(...maxDurations) : this.maxTokenDurationDays();
  }

  copyToken(): void {
    const authTokenSnapshot = this.authToken();

    if (authTokenSnapshot) {
      this.clipboard.copy(authTokenSnapshot);
      this.snackBar.open(
        this.translateService.instant('ws-settings.token-copied-to-clipboard'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
    }
  }

  toggleReplayUrlExportMode(toggleEvent: { checked: boolean }): void {
    const previousMode = this.replayUrlExportMode();
    const mode: ReplayUrlExportMode = toggleEvent.checked ?
      'auth' :
      'workspaceId';
    this.replayUrlExportMode.set(mode);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setReplayUrlExportMode(workspaceId, mode).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.translateService.instant(
                'ws-settings.replay-url-export-mode-saved'
              ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.replayUrlExportMode.set(previousMode);
            this.snackBar.open(
              this.translateService.instant('ws-settings.error-saving-setting'),
              this.translateService.instant('close'),
              {
                duration: 3000,
                panelClass: ['error-snackbar']
              }
            );
          }
        });
    }
  }

  saveReplayUrlExportTokenDuration(): void {
    if (!this.isReplayUrlExportTokenDurationValid()) {
      this.snackBar.open(
        this.translateService.instant('ws-settings.token-duration-invalid'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.workspaceSettingsService
      .setReplayUrlExportTokenDurationDays(
        workspaceId,
        Number(this.replayUrlExportTokenDurationDays()),
        this.maxTokenDurationDays()
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant(
              'ws-settings.replay-url-export-token-duration-saved'
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
        }
      });
  }

  saveAuthSessionIdleTimeout(): void {
    if (!this.isAuthSessionIdleTimeoutValid()) {
      this.snackBar.open(
        this.translateService.instant('ws-settings.auth-session-idle-timeout-invalid'),
        this.translateService.instant('close'),
        { duration: 3000 }
      );
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.workspaceSettingsService
      .setAuthSessionIdleTimeoutMinutes(
        workspaceId,
        Number(this.authSessionIdleTimeoutMinutes())
      ).pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.snackBar.open(
            this.translateService.instant(
              'ws-settings.auth-session-idle-timeout-saved'
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
        }
      });
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

  toggleEvaluationMode(toggleEvent: { checked: boolean }): void {
    const previousState = {
      evaluationMode: this.evaluationMode(),
      autoFetchCodingStatistics: this.autoFetchCodingStatistics(),
      autoRefreshManualCodingJobs: this.autoRefreshManualCodingJobs()
    };
    const enabled = toggleEvent.checked;
    this.applyEvaluationModeLocalPreset(enabled);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setEvaluationMode(workspaceId, enabled).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              enabled ?
                this.translateService.instant(
                  'ws-settings.evaluation-mode-enabled'
                ) :
                this.translateService.instant(
                  'ws-settings.evaluation-mode-disabled'
                ),
              this.translateService.instant('close'),
              { duration: 3000 }
            );
          },
          error: () => {
            this.evaluationMode.set(previousState.evaluationMode);
            this.autoFetchCodingStatistics.set(previousState.autoFetchCodingStatistics);
            this.autoRefreshManualCodingJobs.set(previousState.autoRefreshManualCodingJobs);
            this.snackBar.open(
              this.translateService.instant('ws-settings.error-saving-setting'),
              this.translateService.instant('close'),
              {
                duration: 3000,
                panelClass: ['error-snackbar']
              }
            );
          }
        });
    }
  }

  toggleAutoFetchCodingStatistics(toggleEvent: { checked: boolean }): void {
    if (this.evaluationMode()) {
      return;
    }

    this.autoFetchCodingStatistics.set(toggleEvent.checked);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setAutoFetchCodingStatistics(
          workspaceId,
          this.autoFetchCodingStatistics()
        ).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.autoFetchCodingStatistics() ?
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
            this.autoFetchCodingStatistics.set(!this.autoFetchCodingStatistics());
          }
        });
    }
  }

  toggleAutoRefreshManualCodingJobs(toggleEvent: { checked: boolean }): void {
    if (this.evaluationMode()) {
      return;
    }

    this.autoRefreshManualCodingJobs.set(toggleEvent.checked);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setAutoRefreshManualCodingJobs(
          workspaceId,
          this.autoRefreshManualCodingJobs()
        ).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.autoRefreshManualCodingJobs() ?
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
            this.autoRefreshManualCodingJobs.set(!this.autoRefreshManualCodingJobs());
          }
        });
    }
  }

  private applyEvaluationModeLocalPreset(enabled: boolean): void {
    this.evaluationMode.set(enabled);
    this.autoFetchCodingStatistics.set(false);
    this.autoRefreshManualCodingJobs.set(!enabled);
  }

  toggleIncludeDeriveErrorInManualCoding(toggleEvent: { checked: boolean }): void {
    this.includeDeriveErrorInManualCoding.set(toggleEvent.checked);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setIncludeDeriveErrorInManualCoding(
          workspaceId,
          this.includeDeriveErrorInManualCoding()
        ).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.includeDeriveErrorInManualCoding() ?
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
            this.includeDeriveErrorInManualCoding.set(!this.includeDeriveErrorInManualCoding());
          }
        });
    }
  }

  toggleEnableRegexSearch(toggleEvent: { checked: boolean }): void {
    this.enableRegexSearch.set(toggleEvent.checked);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setEnableRegexSearch(workspaceId, this.enableRegexSearch()).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.enableRegexSearch() ?
                this.translateService.instant(
                  'ws-settings.enable-regex-search-enabled'
                ) :
                this.translateService.instant(
                  'ws-settings.enable-regex-search-disabled'
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
            this.enableRegexSearch.set(!this.enableRegexSearch());
          }
        });
    }
  }

  toggleShowTestResultsLogAnomalies(toggleEvent: { checked: boolean }): void {
    this.showTestResultsLogAnomalies.set(toggleEvent.checked);
    const workspaceId = this.appService.selectedWorkspaceId;

    if (workspaceId) {
      this.workspaceSettingsService
        .setShowTestResultsLogAnomalies(
          workspaceId,
          this.showTestResultsLogAnomalies()
        ).pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.snackBar.open(
              this.showTestResultsLogAnomalies() ?
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
            this.showTestResultsLogAnomalies.set(!this.showTestResultsLogAnomalies());
          }
        });
    }
  }

  exportWorkspaceDatabase(): void {
    if (this.isExporting()) {
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

    this.databaseExport.start({ kind: 'workspace', workspaceId });
  }

  protected getDatabaseExportStatusLabel(): string {
    return this.databaseExport.getStatusLabel();
  }
}
