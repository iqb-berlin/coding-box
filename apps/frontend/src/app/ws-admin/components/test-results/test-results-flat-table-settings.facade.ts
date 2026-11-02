import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, finalize } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import {
  TestResultsFlatTableSettingsDialogComponent, TestResultsFlatTableSettingsDialogData,
  TestResultsFlatTableSettingsDialogResult
} from './test-results-flat-table-settings-dialog.component';

type ListSetting = 'sessionBrowsersAllowlist' | 'sessionOsAllowlist' | 'sessionScreensAllowlist';
export type FlatTableSettings = Omit<TestResultsFlatTableSettingsDialogResult, ListSetting> & Record<ListSetting, string>;

const DEFAULT_SETTINGS: FlatTableSettings = {
  audioLowThreshold: 0.9,
  shortProcessingThresholdMs: 60000,
  longLoadingThresholdMs: 5000,
  focusLostThresholdMs: 300000,
  sessionSpanThresholdMs: 86400000,
  repeatedStartThreshold: 2,
  processingDurationMin: '00:00',
  processingDurationMax: '99:59',
  sessionBrowsersAllowlist: '',
  sessionOsAllowlist: '',
  sessionScreensAllowlist: ''
};

const STORAGE_KEYS: Record<keyof FlatTableSettings, string> = {
  audioLowThreshold: 'audio-low-threshold',
  shortProcessingThresholdMs: 'short-processing-threshold-ms',
  longLoadingThresholdMs: 'long-loading-threshold-ms',
  focusLostThresholdMs: 'focus-lost-threshold-ms',
  sessionSpanThresholdMs: 'session-span-threshold-ms',
  repeatedStartThreshold: 'repeated-start-threshold',
  processingDurationMin: 'processing-duration-min',
  processingDurationMax: 'processing-duration-max',
  sessionBrowsersAllowlist: 'session-browsers-allowlist',
  sessionOsAllowlist: 'session-os-allowlist',
  sessionScreensAllowlist: 'session-screens-allowlist'
};

function loadSettings(): FlatTableSettings {
  const settings = { ...DEFAULT_SETTINGS };
  (Object.keys(STORAGE_KEYS) as Array<keyof FlatTableSettings>).forEach(key => {
    try {
      const raw = localStorage.getItem(`coding-box-test-results-${STORAGE_KEYS[key]}`);
      if (raw === null) return;
      const fallback = DEFAULT_SETTINGS[key];
      if (typeof fallback === 'number') {
        const number = Number(raw);
        if (Number.isFinite(number)) Object.assign(settings, { [key]: key === 'repeatedStartThreshold' ? Math.max(2, Math.round(number)) : number });
      } else if (raw.trim() || fallback === '') Object.assign(settings, { [key]: raw });
    } catch {
      // Browser privacy settings can make local storage unavailable.
    }
  });
  return settings;
}

/** Owns preferences and the lifetime of the table's settings workflow. */
@Injectable()
export class TestResultsFlatTableSettingsFacade {
  private readonly app = inject(AppService);
  private readonly backend = inject(TestResultService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = signal(loadSettings());
  private readonly changes = new Subject<void>();
  private preparation?: Subscription;
  private dialogResult?: Subscription;
  readonly value = this.state.asReadonly();
  readonly changed$ = this.changes.asObservable();

  constructor() {
    this.destroyRef.onDestroy(() => this.changes.complete());
  }

  open(): void {
    this.preparation?.unsubscribe();
    this.dialogResult?.unsubscribe();
    const workspaceId = this.app.selectedWorkspaceId;
    if (!workspaceId) return;
    this.preparation = this.backend.getFlatResponseFilterOptions(workspaceId, {}).pipe(
      takeUntilWorkspaceChanged(this.app, workspaceId),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(options => {
      const settings = this.state();
      const list = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
      const ref = this.dialog.open<TestResultsFlatTableSettingsDialogComponent, TestResultsFlatTableSettingsDialogData, TestResultsFlatTableSettingsDialogResult>(
        TestResultsFlatTableSettingsDialogComponent, {
          width: '720px',
          maxWidth: '95vw',
          height: '560px',
          maxHeight: '90vh',
          data: {
            ...settings,
            sessionBrowsersAllowlist: list(settings.sessionBrowsersAllowlist),
            sessionOsAllowlist: list(settings.sessionOsAllowlist),
            sessionScreensAllowlist: list(settings.sessionScreensAllowlist),
            availableSessionBrowsers: options.sessionBrowsers || [],
            availableSessionOs: options.sessionOs || [],
            availableSessionScreens: options.sessionScreens || []
          }
        }
      );
      this.dialogResult = ref.afterClosed().pipe(
        takeUntilWorkspaceChanged(this.app, workspaceId),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => ref.close())
      ).subscribe(result => {
        if (!result) return;
        this.save(result);
        this.changes.next();
      });
    });
  }

  private save(result: TestResultsFlatTableSettingsDialogResult): void {
    const settings: FlatTableSettings = {
      ...result,
      sessionBrowsersAllowlist: (result.sessionBrowsersAllowlist || []).join(','),
      sessionOsAllowlist: (result.sessionOsAllowlist || []).join(','),
      sessionScreensAllowlist: (result.sessionScreensAllowlist || []).join(',')
    };
    this.state.set(settings);
    (Object.keys(STORAGE_KEYS) as Array<keyof FlatTableSettings>).forEach(key => {
      try {
        localStorage.setItem(`coding-box-test-results-${STORAGE_KEYS[key]}`, String(settings[key]));
      } catch {
        // Applying settings remains possible without persistent browser storage.
      }
    });
  }
}
