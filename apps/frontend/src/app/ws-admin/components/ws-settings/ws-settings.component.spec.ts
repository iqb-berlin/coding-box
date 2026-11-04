/* eslint-disable max-classes-per-file */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { of, Subject, throwError } from 'rxjs';
import { Clipboard } from '@angular/cdk/clipboard';
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { WorkspaceSettings } from '../../../shared/models/workspace-settings.model';
import { JournalComponent } from '../journal/journal.component';
import { WsAccessRightsComponent } from '../ws-access-rights/ws-access-rights.component';
import { WsSettingsComponent } from './ws-settings.component';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../shared/services/workspace/workspace-settings.service';
import { SERVER_URL } from '../../../injection-tokens';

@Component({
  selector: 'coding-box-ws-access-rights',
  template: '',
  standalone: true
})
class MockWsAccessRightsComponent { }

@Component({
  selector: 'coding-box-journal',
  template: '',
  standalone: true
})
class MockJournalComponent { }

describe('WsSettingsComponent', () => {
  let component: WsSettingsComponent;
  let fixture: ComponentFixture<WsSettingsComponent>;
  let mockAppService: jest.Mocked<AppService>;
  let mockWorkspaceSettingsService: jest.Mocked<WorkspaceSettingsService>;
  let mockClipboard: jest.Mocked<Clipboard>;
  let mockSnackBar: jest.Mocked<MatSnackBar>;
  let mockDialog: jest.Mocked<MatDialog>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    mockAppService = {
      selectedWorkspaceId: 1,
      selectedWorkspaceId$: new Subject<number>(),
      loggedUser: { sub: 'test-user' },
      createOwnToken: jest.fn().mockReturnValue(of('test-token')),
      getWorkspaceTokenPolicy: jest.fn().mockReturnValue(of({
        scopes: {
          'replay:read': { maxDurationDays: 90 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      }))
    } as unknown as jest.Mocked<AppService>;

    mockWorkspaceSettingsService = {
      getAutoFetchCodingStatistics: jest.fn().mockReturnValue(of(true)),
      setAutoFetchCodingStatistics: jest.fn().mockReturnValue(of({})),
      getAutoRefreshManualCodingJobs: jest.fn().mockReturnValue(of(true)),
      setAutoRefreshManualCodingJobs: jest.fn().mockReturnValue(of({})),
      getEvaluationMode: jest.fn().mockReturnValue(of(false)),
      setEvaluationMode: jest.fn().mockReturnValue(of([])),
      getIncludeDeriveErrorInManualCoding: jest.fn().mockReturnValue(of(false)),
      setIncludeDeriveErrorInManualCoding: jest.fn().mockReturnValue(of({})),
      getShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of(false)),
      setShowTestResultsLogAnomalies: jest.fn().mockReturnValue(of({})),
      getEnableRegexSearch: jest.fn().mockReturnValue(of(false)),
      setEnableRegexSearch: jest.fn().mockReturnValue(of({})),
      getReplayUrlExportMode: jest.fn().mockReturnValue(of('auth')),
      setReplayUrlExportMode: jest.fn().mockReturnValue(of({})),
      getReplayUrlExportTokenDurationDays: jest.fn((_: number, maxDurationDays: number) => of(maxDurationDays)),
      setReplayUrlExportTokenDurationDays: jest.fn().mockReturnValue(of({})),
      getAuthSessionIdleTimeoutMinutes: jest.fn().mockReturnValue(of(45)),
      setAuthSessionIdleTimeoutMinutes: jest.fn().mockReturnValue(of({}))
    } as unknown as jest.Mocked<WorkspaceSettingsService>;

    mockClipboard = {
      copy: jest.fn()
    } as unknown as jest.Mocked<Clipboard>;

    mockSnackBar = {
      open: jest.fn()
    } as unknown as jest.Mocked<MatSnackBar>;

    mockDialog = {
      open: jest.fn().mockReturnValue({ afterClosed: () => of(null) }),
      closeAll: jest.fn(),
      openDialogs: []
    } as unknown as jest.Mocked<MatDialog>;

    await TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot(),
        WsSettingsComponent
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AppService, useValue: mockAppService },
        { provide: WorkspaceSettingsService, useValue: mockWorkspaceSettingsService },
        { provide: Clipboard, useValue: mockClipboard },
        { provide: MatSnackBar, useValue: mockSnackBar },
        { provide: MatDialog, useValue: mockDialog },
        { provide: SERVER_URL, useValue: 'http://test-url' }
      ]
    }).overrideComponent(WsSettingsComponent, {
      remove: { imports: [WsAccessRightsComponent, JournalComponent] },
      add: {
        imports: [MockWsAccessRightsComponent, MockJournalComponent],
        providers: [{ provide: MatDialog, useValue: mockDialog }]
      }
    }).compileComponents();

    fixture = TestBed.createComponent(WsSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    jest.restoreAllMocks();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a delayed replay URL setting without another UI event', async () => {
    const mode = new Subject<'auth' | 'workspaceId'>();
    mockWorkspaceSettingsService.getReplayUrlExportMode.mockReturnValueOnce(mode.asObservable());
    component.ngOnInit();
    fixture.detectChanges();

    mode.next('workspaceId');
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.replay-url-export-token-duration')).toBeNull();
    expect(fixture.nativeElement.querySelector('.replay-url-export-mode').textContent)
      .toContain('ws-settings.replay-url-export-mode-workspace');
  });

  describe('queued settings writes', () => {
    const numericSettings = [
      {
        field: 'authSessionIdleTimeoutMinutes',
        save: 'saveAuthSessionIdleTimeout',
        setter: 'setAuthSessionIdleTimeoutMinutes',
        selector: '.auth-session-timeout',
        loaded: 45,
        submitted: 60,
        newer: 90
      },
      {
        field: 'replayUrlExportTokenDurationDays',
        save: 'saveReplayUrlExportTokenDuration',
        setter: 'setReplayUrlExportTokenDurationDays',
        selector: '.replay-url-export-token-duration',
        loaded: 90,
        submitted: 45,
        newer: 60
      }
    ] as const;

    it.each(numericSettings)('preserves newer $field drafts after a rejected save', async setting => {
      await fixture.whenStable();
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService[setting.setter].mockReturnValueOnce(saving);
      const input = fixture.nativeElement.querySelector(`${setting.selector} input`) as HTMLInputElement;
      input.value = String(setting.submitted);
      input.dispatchEvent(new Event('input'));
      component[setting.save]();
      input.value = String(setting.newer);
      input.dispatchEvent(new Event('input'));
      saving.error(new Error('save rejected'));
      await fixture.whenStable();

      expect(component[setting.field]()).toBe(setting.newer);
      expect(input.value).toBe(String(setting.newer));
      component[setting.save]();
      expect(mockWorkspaceSettingsService[setting.setter].mock.calls.at(-1)?.[1]).toBe(setting.newer);
    });

    it.each(numericSettings)('restores the confirmed $field value after a rejected save', setting => {
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService[setting.setter].mockReturnValueOnce(saving);
      component[setting.field].set(setting.submitted);
      component[setting.save]();
      saving.error(new Error('save rejected'));

      expect(component[setting.field]()).toBe(setting.loaded);
    });

    it('preserves a newer numeric draft even if it returns to the submitted value', async () => {
      await fixture.whenStable();
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setAuthSessionIdleTimeoutMinutes.mockReturnValueOnce(saving);
      const input = fixture.nativeElement.querySelector('.auth-session-timeout input') as HTMLInputElement;
      input.value = '60';
      input.dispatchEvent(new Event('input'));
      component.saveAuthSessionIdleTimeout();
      input.value = '90';
      input.dispatchEvent(new Event('input'));
      input.value = '60';
      input.dispatchEvent(new Event('input'));
      saving.error(new Error('save rejected'));
      await fixture.whenStable();

      expect(component.authSessionIdleTimeoutMinutes()).toBe(60);
      expect(input.value).toBe('60');
    });

    it('preserves numeric drafts updated directly while a save is pending', () => {
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setAuthSessionIdleTimeoutMinutes.mockReturnValueOnce(saving);
      component.authSessionIdleTimeoutMinutes.set(60);
      component.saveAuthSessionIdleTimeout();
      component.authSessionIdleTimeoutMinutes.set(90);
      saving.error(new Error('save rejected'));

      expect(component.authSessionIdleTimeoutMinutes()).toBe(90);
    });

    it('retains a numeric draft across a delayed initial read and uses the loaded rollback value', async () => {
      fixture.destroy();
      const initial = new Subject<number>();
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.getAuthSessionIdleTimeoutMinutes.mockReturnValueOnce(initial);
      mockWorkspaceSettingsService.setAuthSessionIdleTimeoutMinutes.mockReturnValueOnce(saving);
      fixture = TestBed.createComponent(WsSettingsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();
      const input = fixture.nativeElement.querySelector('.auth-session-timeout input') as HTMLInputElement;
      input.value = '90';
      input.dispatchEvent(new Event('input'));
      initial.next(45);
      initial.complete();
      await fixture.whenStable();
      expect(component.authSessionIdleTimeoutMinutes()).toBe(90);
      expect(input.value).toBe('90');

      component.saveAuthSessionIdleTimeout();
      saving.error(new Error('save rejected'));
      expect(component.authSessionIdleTimeoutMinutes()).toBe(45);
    });

    const initialReadOrders = [
      ['mode', 'fetch', 'refresh'], ['mode', 'refresh', 'fetch'],
      ['fetch', 'mode', 'refresh'], ['fetch', 'refresh', 'mode'],
      ['refresh', 'mode', 'fetch'], ['refresh', 'fetch', 'mode']
    ] as const;
    const presetCases = [false, true].flatMap(persistedMode => initialReadOrders.map(order => ({ persistedMode, order })));

    it.each(presetCases)('rolls back to confirmed mode $persistedMode with initial reads $order', ({ persistedMode, order }) => {
      fixture.destroy();
      const initial = { mode: new Subject<boolean>(), fetch: new Subject<boolean>(), refresh: new Subject<boolean>() };
      const saving = new Subject<WorkspaceSettings[]>();
      mockWorkspaceSettingsService.getEvaluationMode.mockReturnValueOnce(initial.mode);
      mockWorkspaceSettingsService.getAutoFetchCodingStatistics.mockReturnValueOnce(initial.fetch);
      mockWorkspaceSettingsService.getAutoRefreshManualCodingJobs.mockReturnValueOnce(initial.refresh);
      mockWorkspaceSettingsService.setEvaluationMode.mockReturnValueOnce(saving);
      fixture = TestBed.createComponent(WsSettingsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      component.toggleEvaluationMode({ checked: true });
      order.forEach(key => {
        initial[key].next(key === 'mode' ? persistedMode : true);
        initial[key].complete();
      });
      saving.error(new Error('preset rejected'));

      expect(component.evaluationMode()).toBe(persistedMode);
      expect(component.autoFetchCodingStatistics()).toBe(!persistedMode);
      expect(component.autoRefreshManualCodingJobs()).toBe(!persistedMode);
    });

    it('keeps the latest input when an earlier write fails, then persists it in order', async () => {
      const first = new Subject<WorkspaceSettings>();
      const second = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setEnableRegexSearch
        .mockReturnValueOnce(first).mockReturnValueOnce(second);

      component.toggleEnableRegexSearch({ checked: true });
      component.toggleEnableRegexSearch({ checked: false });
      expect(mockWorkspaceSettingsService.setEnableRegexSearch).toHaveBeenCalledTimes(1);
      first.error(new Error('first write failed'));

      expect(component.enableRegexSearch()).toBe(false);
      expect(mockWorkspaceSettingsService.setEnableRegexSearch.mock.calls).toEqual([[1, true], [1, false]]);
      second.complete();
      await fixture.whenStable();
      const setting = Array.from(fixture.nativeElement.querySelectorAll('.setting-item'))
        .find(item => (item as HTMLElement).textContent?.includes('ws-settings.enable-regex-search')) as HTMLElement;
      expect(setting.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    });

    it('restores the last successful value when the latest write fails', () => {
      const first = new Subject<WorkspaceSettings>();
      const second = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setEnableRegexSearch
        .mockReturnValueOnce(first).mockReturnValueOnce(second);
      component.toggleEnableRegexSearch({ checked: true });
      component.toggleEnableRegexSearch({ checked: false });

      first.next({ id: 1, key: 'enable-regex-search', value: '{"enabled":true}' });
      first.complete();
      second.error(new Error('latest write failed'));

      expect(component.enableRegexSearch()).toBe(true);
      component.toggleEnableRegexSearch({ checked: false });
      expect(mockWorkspaceSettingsService.setEnableRegexSearch).toHaveBeenCalledTimes(3);
      expect(component.enableRegexSearch()).toBe(false);
    });

    it('restores the loaded value when every queued write fails', () => {
      const first = new Subject<WorkspaceSettings>();
      const second = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setEnableRegexSearch
        .mockReturnValueOnce(first).mockReturnValueOnce(second);
      component.toggleEnableRegexSearch({ checked: true });
      component.toggleEnableRegexSearch({ checked: false });
      first.error(new Error('first failed'));
      second.error(new Error('second failed'));
      expect(component.enableRegexSearch()).toBe(false);
    });

    it('ignores delayed initial settings after a successful write', () => {
      const initial = new Subject<boolean>();
      mockWorkspaceSettingsService.getEnableRegexSearch.mockReturnValueOnce(initial);
      component.ngOnInit();
      component.toggleEnableRegexSearch({ checked: true });
      initial.next(false);
      initial.complete();
      expect(component.enableRegexSearch()).toBe(true);
    });

    it('uses a delayed initial value as rollback while a write is pending', () => {
      const initial = new Subject<boolean>();
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.getEnableRegexSearch.mockReturnValueOnce(initial);
      mockWorkspaceSettingsService.setEnableRegexSearch.mockReturnValueOnce(saving);
      component.ngOnInit();
      component.toggleEnableRegexSearch({ checked: false });
      initial.next(true);
      saving.error(new Error('failed'));
      expect(component.enableRegexSearch()).toBe(true);
    });

    it('finishes writes for their original workspace after a round trip without stale feedback', () => {
      const saving = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setEnableRegexSearch.mockReturnValueOnce(saving);
      component.toggleEnableRegexSearch({ checked: true });
      component.toggleEnableRegexSearch({ checked: false });
      mockAppService.selectedWorkspaceId = 2;
      (mockAppService.selectedWorkspaceId$ as Subject<number>).next(2);
      mockAppService.selectedWorkspaceId = 1;
      (mockAppService.selectedWorkspaceId$ as Subject<number>).next(1);
      mockSnackBar.open.mockClear();
      expect(saving.observed).toBe(true);
      saving.complete();
      expect(mockWorkspaceSettingsService.setEnableRegexSearch.mock.calls).toEqual([[1, true], [1, false]]);
      expect(component.enableRegexSearch()).toBe(false);
      expect(mockSnackBar.open).not.toHaveBeenCalled();
    });

    it('blocks dependent refresh changes until the evaluation-mode write settles', async () => {
      component.toggleEvaluationMode({ checked: true });
      const disable = new Subject<WorkspaceSettings[]>();
      mockWorkspaceSettingsService.setEvaluationMode.mockReturnValueOnce(disable);
      component.toggleEvaluationMode({ checked: false });
      component.toggleAutoRefreshManualCodingJobs({ checked: true });
      component.toggleAutoFetchCodingStatistics({ checked: true });
      await fixture.whenStable();
      const automaticSettings = Array.from(fixture.nativeElement.querySelectorAll('.setting-item'))
        .filter(item => ['ws-settings.auto-fetch-coding-statistics', 'ws-settings.auto-refresh-manual-coding-jobs']
          .some(key => (item as HTMLElement).textContent?.includes(key))) as HTMLElement[];
      expect(automaticSettings).toHaveLength(2);
      automaticSettings.forEach(setting => expect(setting.querySelector('button')?.disabled).toBe(true));
      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).not.toHaveBeenCalled();
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).not.toHaveBeenCalled();
      disable.error(new Error('mode change failed'));
      expect(component.evaluationMode()).toBe(true);
      expect(component.autoFetchCodingStatistics()).toBe(false);
      expect(component.autoRefreshManualCodingJobs()).toBe(false);

      component.toggleEvaluationMode({ checked: false });
      component.toggleAutoRefreshManualCodingJobs({ checked: true });
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1, true);
    });

    it('captures numeric inputs when enqueued and persists them in order', () => {
      const first = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setReplayUrlExportTokenDurationDays.mockReturnValueOnce(first);
      component.replayUrlExportTokenDurationDays.set(45);
      component.saveReplayUrlExportTokenDuration();
      component.replayUrlExportTokenDurationDays.set(60);
      component.saveReplayUrlExportTokenDuration();
      expect(mockWorkspaceSettingsService.setReplayUrlExportTokenDurationDays).toHaveBeenCalledTimes(1);
      first.next({ id: 1, key: 'replay-url-export-token-duration-days', value: '{"durationDays":45}' });
      first.complete();
      expect(mockWorkspaceSettingsService.setReplayUrlExportTokenDurationDays.mock.calls)
        .toEqual([[1, 45, 90], [1, 60, 90]]);
      expect(component.replayUrlExportTokenDurationDays()).toBe(60);
    });

    it('persists the final toggle after the view is destroyed without changing the old view', () => {
      const saving = new Subject<WorkspaceSettings>();
      const stored = { enabled: false };
      mockWorkspaceSettingsService.setEnableRegexSearch.mockImplementation((_id, enabled) => {
        if (enabled) return saving;
        stored.enabled = false;
        return of({ id: 1, key: 'enable-regex-search', value: '{"enabled":false}' });
      });
      component.toggleEnableRegexSearch({ checked: true });
      component.toggleEnableRegexSearch({ checked: false });
      fixture.destroy();
      mockSnackBar.open.mockClear();
      expect(saving.observed).toBe(true);
      stored.enabled = true;
      saving.next({ id: 1, key: 'enable-regex-search', value: '{"enabled":true}' });
      saving.complete();
      expect(mockWorkspaceSettingsService.setEnableRegexSearch.mock.calls).toEqual([[1, true], [1, false]]);
      expect(stored.enabled).toBe(false);
      expect(component.enableRegexSearch()).toBe(false);
      expect(mockSnackBar.open).not.toHaveBeenCalled();
    });

    it('waits for all writes from the previous view before loading settings again', () => {
      const first = new Subject<WorkspaceSettings>();
      const last = new Subject<WorkspaceSettings>();
      mockWorkspaceSettingsService.setEnableRegexSearch.mockReturnValueOnce(first).mockReturnValueOnce(last);
      component.toggleEnableRegexSearch({ checked: true });
      component.toggleEnableRegexSearch({ checked: false });
      fixture.destroy();
      mockWorkspaceSettingsService.getEnableRegexSearch.mockClear();
      fixture = TestBed.createComponent(WsSettingsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      expect(mockWorkspaceSettingsService.getEnableRegexSearch).not.toHaveBeenCalled();
      first.complete();
      expect(mockWorkspaceSettingsService.getEnableRegexSearch).not.toHaveBeenCalled();
      last.complete();
      expect(mockWorkspaceSettingsService.getEnableRegexSearch).toHaveBeenCalledTimes(1);
      expect(component.enableRegexSearch()).toBe(false);
    });

    it.each([false, true])('blocks dependent saves until the initial evaluation mode %s is loaded', async enabled => {
      fixture.destroy();
      const mode = new Subject<boolean>();
      mockWorkspaceSettingsService.getEvaluationMode.mockReturnValueOnce(mode);
      fixture = TestBed.createComponent(WsSettingsComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();
      const switches = Array.from(fixture.nativeElement.querySelectorAll('.setting-item'))
        .filter(item => ['ws-settings.auto-fetch-coding-statistics', 'ws-settings.auto-refresh-manual-coding-jobs']
          .some(key => (item as HTMLElement).textContent?.includes(key))) as HTMLElement[];
      expect(switches).toHaveLength(2);
      switches.forEach(setting => expect(setting.querySelector('button')?.disabled).toBe(true));
      component.toggleAutoFetchCodingStatistics({ checked: true });
      component.toggleAutoRefreshManualCodingJobs({ checked: true });
      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).not.toHaveBeenCalled();
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).not.toHaveBeenCalled();
      mode.next(enabled);
      mode.complete();
      await fixture.whenStable();
      switches.forEach(setting => expect(setting.querySelector('button')?.disabled).toBe(enabled));
      expect(component.autoFetchCodingStatistics()).toBe(!enabled);
      expect(component.autoRefreshManualCodingJobs()).toBe(!enabled);
      if (!enabled) {
        component.toggleAutoRefreshManualCodingJobs({ checked: false });
        expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1, false);
      }
    });
  });

  describe('ngOnInit', () => {
    it('should load workspace settings on init', () => {
      expect(mockAppService.getWorkspaceTokenPolicy).toHaveBeenCalled();
      expect(mockWorkspaceSettingsService.getEvaluationMode).toHaveBeenCalledWith(1);
      expect(component.evaluationMode()).toBe(false);
      expect(mockWorkspaceSettingsService.getAutoFetchCodingStatistics).toHaveBeenCalledWith(1);
      expect(component.autoFetchCodingStatistics()).toBe(true);
      expect(mockWorkspaceSettingsService.getAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1);
      expect(component.autoRefreshManualCodingJobs()).toBe(true);
      expect(mockWorkspaceSettingsService.getIncludeDeriveErrorInManualCoding).toHaveBeenCalledWith(1);
      expect(component.includeDeriveErrorInManualCoding()).toBe(false);
      expect(mockWorkspaceSettingsService.getShowTestResultsLogAnomalies).toHaveBeenCalledWith(1);
      expect(component.showTestResultsLogAnomalies()).toBe(false);
      expect(mockWorkspaceSettingsService.getEnableRegexSearch).toHaveBeenCalledWith(1);
      expect(component.enableRegexSearch()).toBe(false);
      expect(mockWorkspaceSettingsService.getReplayUrlExportMode).toHaveBeenCalledWith(1);
      expect(component.replayUrlExportMode()).toBe('auth');
      expect(mockWorkspaceSettingsService.getReplayUrlExportTokenDurationDays).toHaveBeenCalledWith(1, 90);
      expect(component.replayUrlExportTokenDurationDays()).toBe(90);
      expect(mockWorkspaceSettingsService.getAuthSessionIdleTimeoutMinutes).toHaveBeenCalledWith(1);
      expect(component.authSessionIdleTimeoutMinutes()).toBe(45);
    });
  });

  describe('openReplayStatistics', () => {
    it('should open replay statistics dialog', () => {
      component.openReplayStatistics();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('createToken', () => {
    it('should call appService.createOwnToken and show snackbar', () => {
      component.createToken();
      expect(mockAppService.createOwnToken).toHaveBeenCalledWith(
        1,
        component.duration(),
        ['replay:read']
      );
      expect(component.authToken()).toBe('test-token');
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should use the token policy maximum for duration validation', () => {
      mockAppService.getWorkspaceTokenPolicy.mockReturnValueOnce(of({
        scopes: {
          'replay:read': { maxDurationDays: 60 },
          'replay-statistics:write': { maxDurationDays: 1 },
          'coding-job:operate': { maxDurationDays: 1 }
        }
      }));

      component.ngOnInit();

      expect(component.maxTokenDurationDays()).toBe(60);
      expect(component.duration()).toBe(60);
      expect(component.isTokenDurationValid()).toBe(true);

      component.duration.set(61);
      expect(component.isTokenDurationValid()).toBe(false);
    });

    it('should reject decimal durations before requesting a token', () => {
      component.duration.set(1.5);

      component.createToken();

      expect(mockAppService.createOwnToken).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should show an error when token generation fails', () => {
      mockAppService.createOwnToken.mockReturnValue(throwError(() => new Error('failed')));

      component.createToken();

      expect(component.authToken()).toBeNull();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('copyToken', () => {
    it('should copy token to clipboard if it exists', () => {
      component.authToken.set('test-token');
      component.copyToken();
      expect(mockClipboard.copy).toHaveBeenCalledWith('test-token');
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should not copy if no token exists', () => {
      component.authToken.set(null);
      component.copyToken();
      expect(mockClipboard.copy).not.toHaveBeenCalled();
    });
  });

  describe('toggleReplayUrlExportMode', () => {
    it('should persist auth mode', () => {
      component.toggleReplayUrlExportMode({ checked: true });

      expect(component.replayUrlExportMode()).toBe('auth');
      expect(mockWorkspaceSettingsService.setReplayUrlExportMode).toHaveBeenCalledWith(1, 'auth');
    });

    it('should persist workspaceId mode', () => {
      component.toggleReplayUrlExportMode({ checked: false });

      expect(component.replayUrlExportMode()).toBe('workspaceId');
      expect(mockWorkspaceSettingsService.setReplayUrlExportMode).toHaveBeenCalledWith(1, 'workspaceId');
    });

    it('should revert replay URL export mode on error', () => {
      component.replayUrlExportMode.set('auth');
      mockWorkspaceSettingsService.setReplayUrlExportMode.mockReturnValue(
        throwError(() => new Error('error'))
      );

      component.toggleReplayUrlExportMode({ checked: false });

      expect(component.replayUrlExportMode()).toBe('auth');
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('saveReplayUrlExportTokenDuration', () => {
    it('should persist replay URL export token duration', () => {
      component.replayUrlExportTokenDurationDays.set(45);

      component.saveReplayUrlExportTokenDuration();

      expect(mockWorkspaceSettingsService.setReplayUrlExportTokenDurationDays).toHaveBeenCalledWith(1, 45, 90);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should reject invalid replay URL export token durations before saving', () => {
      component.replayUrlExportTokenDurationDays.set(91);

      component.saveReplayUrlExportTokenDuration();

      expect(mockWorkspaceSettingsService.setReplayUrlExportTokenDurationDays).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should show an error when replay URL export token duration cannot be saved', () => {
      mockWorkspaceSettingsService.setReplayUrlExportTokenDurationDays.mockReturnValue(
        throwError(() => new Error('error'))
      );
      component.replayUrlExportTokenDurationDays.set(45);

      component.saveReplayUrlExportTokenDuration();

      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('saveAuthSessionIdleTimeout', () => {
    it('should persist auth session idle timeout minutes', () => {
      component.authSessionIdleTimeoutMinutes.set(60);

      component.saveAuthSessionIdleTimeout();

      expect(mockWorkspaceSettingsService.setAuthSessionIdleTimeoutMinutes).toHaveBeenCalledWith(1, 60);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should reject invalid auth session idle timeout minutes before saving', () => {
      component.authSessionIdleTimeoutMinutes.set(481);

      component.saveAuthSessionIdleTimeout();

      expect(mockWorkspaceSettingsService.setAuthSessionIdleTimeoutMinutes).not.toHaveBeenCalled();
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should show an error when auth session idle timeout cannot be saved', () => {
      mockWorkspaceSettingsService.setAuthSessionIdleTimeoutMinutes.mockReturnValue(
        throwError(() => new Error('error'))
      );
      component.authSessionIdleTimeoutMinutes.set(60);

      component.saveAuthSessionIdleTimeout();

      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('editMissingsProfiles', () => {
    it('should open edit missings profiles dialog', () => {
      component.editMissingsProfiles();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('openAccessRightsMatrix', () => {
    it('should open access rights matrix dialog', () => {
      component.openAccessRightsMatrix();
      expect(mockDialog.open).toHaveBeenCalled();
    });
  });

  describe('toggleEvaluationMode', () => {
    it('should enable evaluation mode and turn off expensive automatic refreshes', () => {
      component.toggleEvaluationMode({ checked: true });

      expect(component.evaluationMode()).toBe(true);
      expect(component.autoFetchCodingStatistics()).toBe(false);
      expect(component.autoRefreshManualCodingJobs()).toBe(false);
      expect(mockWorkspaceSettingsService.setEvaluationMode).toHaveBeenCalledWith(1, true);
    });

    it('should disable evaluation mode and restore normal automatic refresh defaults', () => {
      component.evaluationMode.set(true);
      component.autoFetchCodingStatistics.set(false);
      component.autoRefreshManualCodingJobs.set(false);

      component.toggleEvaluationMode({ checked: false });

      expect(component.evaluationMode()).toBe(false);
      expect(component.autoFetchCodingStatistics()).toBe(false);
      expect(component.autoRefreshManualCodingJobs()).toBe(true);
      expect(mockWorkspaceSettingsService.setEvaluationMode).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setEvaluationMode.mockReturnValue(
        throwError(() => new Error('error'))
      );
      component.evaluationMode.set(false);
      component.autoFetchCodingStatistics.set(true);
      component.autoRefreshManualCodingJobs.set(true);

      component.toggleEvaluationMode({ checked: true });

      expect(component.evaluationMode()).toBe(false);
      expect(component.autoFetchCodingStatistics()).toBe(true);
      expect(component.autoRefreshManualCodingJobs()).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('toggleAutoFetchCodingStatistics', () => {
    it('should call service with true', () => {
      component.toggleAutoFetchCodingStatistics({ checked: true });
      expect(component.autoFetchCodingStatistics()).toBe(true);
      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).toHaveBeenCalledWith(1, true);
    });

    it('should call service with false', () => {
      component.toggleAutoFetchCodingStatistics({ checked: false });
      expect(component.autoFetchCodingStatistics()).toBe(false);
      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setAutoFetchCodingStatistics.mockReturnValue(throwError(() => new Error('error')));
      component.autoFetchCodingStatistics.set(true);
      component.toggleAutoFetchCodingStatistics({ checked: false });
      expect(component.autoFetchCodingStatistics()).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should ignore changes while evaluation mode is active', () => {
      component.evaluationMode.set(true);

      component.toggleAutoFetchCodingStatistics({ checked: true });

      expect(mockWorkspaceSettingsService.setAutoFetchCodingStatistics).not.toHaveBeenCalled();
    });
  });

  describe('toggleAutoRefreshManualCodingJobs', () => {
    it('should call service with true', () => {
      component.toggleAutoRefreshManualCodingJobs({ checked: true });
      expect(component.autoRefreshManualCodingJobs()).toBe(true);
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1, true);
    });

    it('should call service with false', () => {
      component.toggleAutoRefreshManualCodingJobs({ checked: false });
      expect(component.autoRefreshManualCodingJobs()).toBe(false);
      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs.mockReturnValue(throwError(() => new Error('error')));
      component.autoRefreshManualCodingJobs.set(true);
      component.toggleAutoRefreshManualCodingJobs({ checked: false });
      expect(component.autoRefreshManualCodingJobs()).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });

    it('should ignore changes while evaluation mode is active', () => {
      component.evaluationMode.set(true);

      component.toggleAutoRefreshManualCodingJobs({ checked: true });

      expect(mockWorkspaceSettingsService.setAutoRefreshManualCodingJobs).not.toHaveBeenCalled();
    });
  });

  describe('toggleIncludeDeriveErrorInManualCoding', () => {
    it('should call service with true', () => {
      component.toggleIncludeDeriveErrorInManualCoding({ checked: true });
      expect(component.includeDeriveErrorInManualCoding()).toBe(true);
      expect(mockWorkspaceSettingsService.setIncludeDeriveErrorInManualCoding).toHaveBeenCalledWith(1, true);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setIncludeDeriveErrorInManualCoding.mockReturnValue(throwError(() => new Error('error')));
      mockWorkspaceSettingsService.getIncludeDeriveErrorInManualCoding.mockReturnValueOnce(of(true));
      component.ngOnInit();
      component.toggleIncludeDeriveErrorInManualCoding({ checked: false });
      expect(component.includeDeriveErrorInManualCoding()).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('toggleShowTestResultsLogAnomalies', () => {
    it('should call service with true', () => {
      component.toggleShowTestResultsLogAnomalies({ checked: true });
      expect(component.showTestResultsLogAnomalies()).toBe(true);
      expect(mockWorkspaceSettingsService.setShowTestResultsLogAnomalies).toHaveBeenCalledWith(1, true);
    });

    it('should call service with false', () => {
      component.toggleShowTestResultsLogAnomalies({ checked: false });
      expect(component.showTestResultsLogAnomalies()).toBe(false);
      expect(mockWorkspaceSettingsService.setShowTestResultsLogAnomalies).toHaveBeenCalledWith(1, false);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setShowTestResultsLogAnomalies.mockReturnValue(throwError(() => new Error('error')));
      mockWorkspaceSettingsService.getShowTestResultsLogAnomalies.mockReturnValueOnce(of(true));
      component.ngOnInit();
      component.toggleShowTestResultsLogAnomalies({ checked: false });
      expect(component.showTestResultsLogAnomalies()).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('toggleEnableRegexSearch', () => {
    it('should call service with true', () => {
      component.toggleEnableRegexSearch({ checked: true });
      expect(component.enableRegexSearch()).toBe(true);
      expect(mockWorkspaceSettingsService.setEnableRegexSearch).toHaveBeenCalledWith(1, true);
    });

    it('should revert state on error', () => {
      mockWorkspaceSettingsService.setEnableRegexSearch.mockReturnValue(throwError(() => new Error('error')));
      mockWorkspaceSettingsService.getEnableRegexSearch.mockReturnValueOnce(of(true));
      component.ngOnInit();
      component.toggleEnableRegexSearch({ checked: false });
      expect(component.enableRegexSearch()).toBe(true);
      expect(mockSnackBar.open).toHaveBeenCalled();
    });
  });

  describe('exportWorkspaceDatabase', () => {
    beforeEach(() => {
      if (typeof window.URL.createObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'createObjectURL', { value: jest.fn(), configurable: true });
      }
      if (typeof window.URL.revokeObjectURL === 'undefined') {
        Object.defineProperty(window.URL, 'revokeObjectURL', { value: jest.fn(), configurable: true });
      }

      jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('test-token');
    });

    it('should start export job, poll status and download file', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        const anchor = document.createElement('a');
        const clickSpy = jest.spyOn(anchor, 'click').mockImplementation(() => {});
        const createElement = document.createElement.bind(document);
        const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation(
          (tagName, options) => (tagName === 'a' ? anchor : createElement(tagName, options))
        );

        const appendChildSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(node => node);
        const removeChildSpy = jest.spyOn(document.body, 'removeChild').mockImplementation(node => node);

        component.exportWorkspaceDatabase();

        const startRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job');
        expect(startRequest.request.method).toBe('POST');
        startRequest.flush({ jobId: 'job-1', message: 'started' });

        await jest.advanceTimersByTimeAsync(0);

        const statusRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job/job-1');
        expect(statusRequest.request.method).toBe('GET');
        statusRequest.flush({ status: 'completed', progress: 100 });

        const downloadRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job/job-1/download');
        expect(downloadRequest.request.method).toBe('GET');
        downloadRequest.flush(new Blob(['test']));

        expect(clickSpy).toHaveBeenCalled();
        expect(component.isExporting()).toBe(false);
        expect(component.databaseExportStatus()).toBe('completed');

        appendChildSpy.mockRestore();
        removeChildSpy.mockRestore();
        createElementSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('renders background export progress after polling without another UI event', async () => {
      jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
      try {
        component.exportWorkspaceDatabase();
        fixture.detectChanges();

        httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job')
          .flush({ jobId: 'job-1', message: 'started' });
        await jest.advanceTimersByTimeAsync(0);
        httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job/job-1')
          .flush({ status: 'running', progress: 42 });
        await jest.advanceTimersByTimeAsync(0);

        expect(fixture.nativeElement.querySelector('.database-export-card .progress-text').textContent)
          .toContain('42');
        component.ngOnDestroy();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should start export without a local token because auth is handled by the interceptor', () => {
      jest.spyOn(localStorage, 'getItem').mockReturnValue(null);

      component.exportWorkspaceDatabase();

      const startRequest = httpMock.expectOne('http://test-url/admin/workspace/1/export/sqlite/job');
      expect(startRequest.request.method).toBe('POST');
      expect(startRequest.request.headers.get('Authorization')).toBeNull();
      expect(startRequest.request.headers.get('Accept')).toBe('application/json');
      startRequest.flush(
        { message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' }
      );

      expect(mockSnackBar.open).toHaveBeenCalled();
      expect(component.isExporting()).toBe(false);
    });
  });
});
