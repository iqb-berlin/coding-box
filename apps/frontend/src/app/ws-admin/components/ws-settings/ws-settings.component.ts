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
import { WorkspaceSettingsSaveFacade } from './workspace-settings-save.facade';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { DatabaseExportService } from '../../../shared/services/database-export.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-ws-settings',
  templateUrl: './ws-settings.component.html',
  styleUrls: ['./ws-settings.component.scss'],
  standalone: true,
  providers: [DatabaseExportService, WorkspaceSettingsSaveFacade],
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
  protected readonly settingsSave = inject(WorkspaceSettingsSaveFacade);

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
  private readonly hasLoadedEvaluationMode = signal(false);
  readonly includeDeriveErrorInManualCoding = signal(false);
  readonly enableRegexSearch = signal(false);
  readonly showTestResultsLogAnomalies = signal(false);
  readonly isExporting = this.databaseExport.isExporting;
  protected readonly databaseExportProgress = this.databaseExport.progress;
  readonly databaseExportStatus = this.databaseExport.status;
  protected readonly databaseExportError = this.databaseExport.error;

  ngOnInit(): void {
    let workspaceId = this.appService.selectedWorkspaceId;
    this.loadWorkspaceSettings(workspaceId);
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      if (id === workspaceId) return;
      workspaceId = id;
      this.authToken.set(null);
      this.replayUrlExportMode.set(DEFAULT_REPLAY_URL_EXPORT_MODE);
      this.replayUrlExportTokenDurationDays.set(DEFAULT_EXTERNAL_REPLAY_TOKEN_DURATION_DAYS);
      this.authSessionIdleTimeoutMinutes.set(DEFAULT_AUTH_SESSION_IDLE_TIMEOUT_MINUTES);
      this.autoFetchCodingStatistics.set(true);
      this.autoRefreshManualCodingJobs.set(true);
      this.evaluationMode.set(false);
      this.includeDeriveErrorInManualCoding.set(false);
      this.enableRegexSearch.set(false);
      this.showTestResultsLogAnomalies.set(false);
      this.loadWorkspaceSettings(id);
    });
  }

  private loadWorkspaceSettings(workspaceId: number): void {
    this.hasLoadedEvaluationMode.set(false);
    this.settingsSave.whenSettled(workspaceId).pipe(
      takeUntilWorkspaceChanged(this.appService, workspaceId),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.readWorkspaceSettings(workspaceId));
  }

  private readWorkspaceSettings(workspaceId: number): void {
    this.loadWorkspaceTokenPolicy(workspaceId);
    if (workspaceId) {
      // Initial rollback values must not depend on an optimistic evaluation preset.
      let persistedEvaluationMode = false;
      this.workspaceSettingsService
        .getReplayUrlExportMode(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(mode => {
          this.settingsSave.initialize(this.replayUrlExportMode, mode);
        });
      this.workspaceSettingsService
        .getAuthSessionIdleTimeoutMinutes(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(timeoutMinutes => {
          this.settingsSave.initialize(this.authSessionIdleTimeoutMinutes, timeoutMinutes);
        });
      this.workspaceSettingsService
        .getEvaluationMode(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          persistedEvaluationMode = enabled;
          this.settingsSave.initialize(this.evaluationMode, enabled);
          if (enabled) {
            this.settingsSave.initialize(this.autoFetchCodingStatistics, false);
            this.settingsSave.initialize(this.autoRefreshManualCodingJobs, false);
          }
          this.hasLoadedEvaluationMode.set(true);
        });
      this.workspaceSettingsService
        .getAutoFetchCodingStatistics(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.settingsSave.initialize(this.autoFetchCodingStatistics, persistedEvaluationMode ?
            false :
            enabled);
        });
      this.workspaceSettingsService
        .getAutoRefreshManualCodingJobs(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.settingsSave.initialize(this.autoRefreshManualCodingJobs, persistedEvaluationMode ?
            false :
            enabled);
        });
      this.workspaceSettingsService
        .getIncludeDeriveErrorInManualCoding(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.settingsSave.initialize(this.includeDeriveErrorInManualCoding, enabled);
        });
      this.workspaceSettingsService
        .getEnableRegexSearch(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.settingsSave.initialize(this.enableRegexSearch, enabled);
        });
      this.workspaceSettingsService
        .getShowTestResultsLogAnomalies(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
        .subscribe(enabled => {
          this.settingsSave.initialize(this.showTestResultsLogAnomalies, enabled);
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
      ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
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
    this.appService.getWorkspaceTokenPolicy().pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef)).subscribe({
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
      ).pipe(takeUntilWorkspaceChanged(this.appService), takeUntilDestroyed(this.destroyRef))
      .subscribe(durationDays => {
        this.settingsSave.initialize(this.replayUrlExportTokenDurationDays, durationDays);
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
    const mode: ReplayUrlExportMode = toggleEvent.checked ? 'auth' : 'workspaceId';
    this.settingsSave.change(
      [{ state: this.replayUrlExportMode, value: mode }],
      workspaceId => this.workspaceSettingsService.setReplayUrlExportMode(workspaceId, mode),
      'ws-settings.replay-url-export-mode-saved'
    );
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
    const value = Number(this.replayUrlExportTokenDurationDays());
    const maxDurationDays = this.maxTokenDurationDays();
    this.settingsSave.change(
      [{ state: this.replayUrlExportTokenDurationDays, value }],
      workspaceId => this.workspaceSettingsService.setReplayUrlExportTokenDurationDays(workspaceId, value, maxDurationDays),
      'ws-settings.replay-url-export-token-duration-saved'
    );
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
    const value = Number(this.authSessionIdleTimeoutMinutes());
    this.settingsSave.change(
      [{ state: this.authSessionIdleTimeoutMinutes, value }],
      workspaceId => this.workspaceSettingsService.setAuthSessionIdleTimeoutMinutes(workspaceId, value),
      'ws-settings.auth-session-idle-timeout-saved'
    );
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
    const enabled = toggleEvent.checked;
    this.settingsSave.change(
      [
        { state: this.evaluationMode, value: enabled },
        { state: this.autoFetchCodingStatistics, value: false },
        { state: this.autoRefreshManualCodingJobs, value: !enabled }
      ],
      workspaceId => this.workspaceSettingsService.setEvaluationMode(workspaceId, enabled),
      enabled ? 'ws-settings.evaluation-mode-enabled' : 'ws-settings.evaluation-mode-disabled'
    );
  }

  protected isSavingEvaluationMode(): boolean {
    return this.settingsSave.isPending(this.evaluationMode);
  }

  protected isAutomaticRefreshDisabled(): boolean {
    return !this.hasLoadedEvaluationMode() || this.evaluationMode() || this.isSavingEvaluationMode();
  }

  toggleAutoFetchCodingStatistics(toggleEvent: { checked: boolean }): void {
    if (this.isAutomaticRefreshDisabled()) return;
    const enabled = toggleEvent.checked;
    this.settingsSave.change(
      [{ state: this.autoFetchCodingStatistics, value: enabled }],
      workspaceId => this.workspaceSettingsService.setAutoFetchCodingStatistics(workspaceId, enabled),
      enabled ? 'ws-settings.auto-fetch-coding-statistics-enabled' : 'ws-settings.auto-fetch-coding-statistics-disabled'
    );
  }

  toggleAutoRefreshManualCodingJobs(toggleEvent: { checked: boolean }): void {
    if (this.isAutomaticRefreshDisabled()) return;
    const enabled = toggleEvent.checked;
    this.settingsSave.change(
      [{ state: this.autoRefreshManualCodingJobs, value: enabled }],
      workspaceId => this.workspaceSettingsService.setAutoRefreshManualCodingJobs(workspaceId, enabled),
      enabled ? 'ws-settings.auto-refresh-manual-coding-jobs-enabled' : 'ws-settings.auto-refresh-manual-coding-jobs-disabled'
    );
  }

  toggleIncludeDeriveErrorInManualCoding(toggleEvent: { checked: boolean }): void {
    const enabled = toggleEvent.checked;
    this.settingsSave.change(
      [{ state: this.includeDeriveErrorInManualCoding, value: enabled }],
      workspaceId => this.workspaceSettingsService.setIncludeDeriveErrorInManualCoding(workspaceId, enabled),
      enabled ? 'ws-settings.include-derive-error-in-manual-coding-enabled' : 'ws-settings.include-derive-error-in-manual-coding-disabled'
    );
  }

  toggleEnableRegexSearch(toggleEvent: { checked: boolean }): void {
    const enabled = toggleEvent.checked;
    this.settingsSave.change(
      [{ state: this.enableRegexSearch, value: enabled }],
      workspaceId => this.workspaceSettingsService.setEnableRegexSearch(workspaceId, enabled),
      enabled ? 'ws-settings.enable-regex-search-enabled' : 'ws-settings.enable-regex-search-disabled'
    );
  }

  toggleShowTestResultsLogAnomalies(toggleEvent: { checked: boolean }): void {
    const enabled = toggleEvent.checked;
    this.settingsSave.change(
      [{ state: this.showTestResultsLogAnomalies, value: enabled }],
      workspaceId => this.workspaceSettingsService.setShowTestResultsLogAnomalies(workspaceId, enabled),
      enabled ? 'ws-settings.show-test-results-log-anomalies-enabled' : 'ws-settings.show-test-results-log-anomalies-disabled'
    );
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
