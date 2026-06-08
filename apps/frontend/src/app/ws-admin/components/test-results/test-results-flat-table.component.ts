import { CommonModule } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import {
  Observable,
  Subject,
  Subscription,
  debounceTime,
  of,
  shareReplay,
  tap
} from 'rxjs';
import { FileService } from '../../../shared/services/file/file.service';
import { UnitNoteService } from '../../../shared/services/unit/unit-note.service';
import { CodingStatisticsService } from '../../../coding/services/coding-statistics.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { AppService } from '../../../core/services/app.service';
import {
  FlatResponseFilterOptionsResponse,
  FlatResponseFrequencyItem,
  BookletLogsForUnitResponse,
  FlatResponseFrequencyRequestCombo,
  FlatResponseFrequenciesResponse,
  LogAnomalySummary,
  TestResultService
} from '../../../shared/services/test-result/test-result.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData
} from '../../../shared/dialogs/confirm-dialog.component';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { LogDialogComponent } from '../booklet-log-dialog/log-dialog.component';
import { UnitLogsDialogComponent } from '../unit-logs-dialog/unit-logs-dialog.component';
import { NoteDialogComponent } from '../note-dialog/note-dialog.component';
import { UnitNoteDto } from '../../../../../../../api-dto/unit-notes/unit-note.dto';
import {
  TestResultsFlatTableSettingsDialogComponent,
  TestResultsFlatTableSettingsDialogResult
} from './test-results-flat-table-settings-dialog.component';

interface FlatResponseRow {
  bookletId: number;
  responseId: number;
  unitId: number;
  personId: number;
  code: string;
  group: string;
  login: string;
  booklet: string;
  unit: string;
  response: string;
  responseStatus: string;
  responseValue: string;
  tags: string[];
  logAnomalies?: LogAnomalySummary[];
}

export interface FlatResponseFilters {
  code: string;
  group: string;
  login: string;
  booklet: string;
  unit: string;
  response: string;
  responseStatus: string;
  responseValue: string;
  tags: string;
  geogebra: boolean;
  audioLow: boolean;
  nonEmptyResponse: boolean;
  sessionFilter: boolean;
  shortProcessing: boolean;
  longLoading: boolean;
  logAnomalies: string;
}

interface BookletLog {
  id: number;
  bookletid: number;
  ts: string;
  parameter: string;
  key: string;
}

interface BookletSession {
  id: number;
  browser: string;
  os: string;
  screen: string;
  ts: string;
}

interface UnitLog {
  id: number;
  unitid: number;
  ts: string;
  key: string;
  parameter: string;
}

interface UnitFromPersonTestResults {
  id: number;
  bookletid: number;
  name: string;
  alias: string | null;
  logs?: UnitLog[];
}

interface BookletFromPersonTestResults {
  id: number;
  name: string;
  logs: BookletLog[];
  sessions?: BookletSession[];
  units: UnitFromPersonTestResults[];
}

type FlatTableMediaFilter =
  | 'geogebra'
  | 'audioLow'
  | 'nonEmptyResponse'
  | 'sessionFilter'
  | 'shortProcessing'
  | 'longLoading'
  | 'processingDuration'
  | 'unitProgressComplete'
  | 'logAny'
  | 'logCritical'
  | 'logTechnical'
  | 'logIncomplete'
  | 'logConnectionLost'
  | 'logTimer'
  | 'logFocus'
  | 'logDebug'
  | 'logReloads';

const SPECIFIC_LOG_MEDIA_FILTERS: FlatTableMediaFilter[] = [
  'logCritical',
  'logTechnical',
  'logIncomplete',
  'logConnectionLost',
  'logTimer',
  'logFocus',
  'logDebug',
  'logReloads'
];

@Component({
  selector: 'coding-box-test-results-flat-table',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatPaginatorModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatAutocompleteModule,
    MatSelectModule
  ],
  templateUrl: './test-results-flat-table.component.html',
  styleUrls: ['./test-results-flat-table.component.scss']
})
export class TestResultsFlatTableComponent implements OnInit, OnChanges, OnDestroy {
  private fileService = inject(FileService);
  private unitNoteService = inject(UnitNoteService);
  private statisticsService = inject(CodingStatisticsService);
  private responseService = inject(ResponseService);
  private appService = inject(AppService);
  private testResultService = inject(TestResultService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  private readonly AUDIO_LOW_THRESHOLD_STORAGE_KEY =
    'coding-box-test-results-audio-low-threshold';

  private readonly SHORT_PROCESSING_THRESHOLD_STORAGE_KEY =
    'coding-box-test-results-short-processing-threshold-ms';

  private readonly LONG_LOADING_THRESHOLD_STORAGE_KEY =
    'coding-box-test-results-long-loading-threshold-ms';

  private readonly FOCUS_LOST_THRESHOLD_STORAGE_KEY =
    'coding-box-test-results-focus-lost-threshold-ms';

  private readonly SESSION_SPAN_THRESHOLD_STORAGE_KEY =
    'coding-box-test-results-session-span-threshold-ms';

  private readonly REPEATED_START_THRESHOLD_STORAGE_KEY =
    'coding-box-test-results-repeated-start-threshold';

  private readonly PROCESSING_DURATION_MIN_STORAGE_KEY =
    'coding-box-test-results-processing-duration-min';

  private readonly PROCESSING_DURATION_MAX_STORAGE_KEY =
    'coding-box-test-results-processing-duration-max';

  private readonly SESSION_BROWSERS_ALLOWLIST_STORAGE_KEY =
    'coding-box-test-results-session-browsers-allowlist';

  private readonly SESSION_OS_ALLOWLIST_STORAGE_KEY =
    'coding-box-test-results-session-os-allowlist';

  private readonly SESSION_SCREENS_ALLOWLIST_STORAGE_KEY =
    'coding-box-test-results-session-screens-allowlist';

  private unitIdsWithNotes = new Set<number>();

  private personTestResultsCache = new Map<
  number,
  Observable<BookletFromPersonTestResults[]>
  >();

  private personTestResultsCacheOrder: number[] = [];
  private readonly PERSON_TEST_RESULTS_CACHE_MAX = 5;

  private readonly baseFlatDisplayedColumns: string[] = [
    'code',
    'group',
    'login',
    'booklet',
    'unit',
    'response',
    'responseStatus',
    'responseValue',
    'frequencies',
    'tags',
    'actions'
  ];

  flatDisplayedColumns: string[] = [...this.baseFlatDisplayedColumns];
  showLogAnomaliesInTable = false;
  private logAnomalyTableSettingLoaded = false;
  private tableInitialized = false;
  private flatResponsesRequestSequence = 0;

  isLoadingFrequencies: boolean = false;
  private frequenciesByComboKey = new Map<
  string,
  { total: number; values: FlatResponseFrequencyItem[] }
  >();

  flatData: FlatResponseRow[] = [];
  flatTotalRecords: number = 0;
  flatPageSize: number = 100;
  flatPageIndex: number = 0;
  isLoadingFlat: boolean = false;

  flatFilters: FlatResponseFilters = this.createDefaultFlatFilters();

  mediaFilters: FlatTableMediaFilter[] = [];

  processingDurationEnabled: boolean = false;

  processingDurationsFilters: string[] = [];
  unitProgressFilters: string[] = [];

  audioLowThreshold: number = 0.9;

  shortProcessingThresholdMs: number = 60000;

  longLoadingThresholdMs: number = 5000;

  focusLostThresholdMs: number = 300000;

  sessionSpanThresholdMs: number = 24 * 60 * 60 * 1000;

  repeatedStartThreshold: number = 2;

  processingDurationMin: string = '00:00';
  processingDurationMax: string = '99:59';

  sessionBrowsersAllowlist: string = '';
  sessionOsAllowlist: string = '';
  sessionScreensAllowlist: string = '';

  flatFilterOptions: FlatResponseFilterOptionsResponse = {
    codes: [],
    groups: [],
    logins: [],
    booklets: [],
    units: [],
    responses: [],
    responseStatuses: [],
    tags: [],
    processingDurations: [],
    unitProgresses: [],
    sessionBrowsers: [],
    sessionOs: [],
    sessionScreens: [],
    sessionIds: []
  };

  private flatSearchSubject = new Subject<void>();
  private flatSearchSubscription: Subscription;
  private workspaceCacheInvalidatedSubscription: Subscription;
  private readonly FLAT_FILTER_DEBOUNCE_TIME = 400;

  private refreshFilterOptionsTimeoutIds: number[] = [];

  private suppressNextFlatFilterChange = false;

  @Input() initialFilters: Partial<FlatResponseFilters> | null = null;
  @Input() showWorkspaceLogAnomalies = false;
  @Input() forceShowLogAnomalies = false;
  @Output() responseDeleted = new EventEmitter<void>();

  constructor() {
    try {
      const raw = localStorage.getItem(this.AUDIO_LOW_THRESHOLD_STORAGE_KEY);
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.audioLowThreshold = parsed;
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(
        this.SHORT_PROCESSING_THRESHOLD_STORAGE_KEY
      );
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.shortProcessingThresholdMs = parsed;
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(this.LONG_LOADING_THRESHOLD_STORAGE_KEY);
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.longLoadingThresholdMs = parsed;
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(this.FOCUS_LOST_THRESHOLD_STORAGE_KEY);
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.focusLostThresholdMs = parsed;
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(this.SESSION_SPAN_THRESHOLD_STORAGE_KEY);
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.sessionSpanThresholdMs = parsed;
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(this.REPEATED_START_THRESHOLD_STORAGE_KEY);
      const parsed = raw != null ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) {
        this.repeatedStartThreshold = Math.max(2, Math.round(parsed));
      }
    } catch {
      // ignore
    }

    try {
      const rawMin = localStorage.getItem(
        this.PROCESSING_DURATION_MIN_STORAGE_KEY
      );
      if (rawMin != null && String(rawMin).trim()) {
        this.processingDurationMin = String(rawMin);
      }
    } catch {
      // ignore
    }

    try {
      const rawMax = localStorage.getItem(
        this.PROCESSING_DURATION_MAX_STORAGE_KEY
      );
      if (rawMax != null && String(rawMax).trim()) {
        this.processingDurationMax = String(rawMax);
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(
        this.SESSION_BROWSERS_ALLOWLIST_STORAGE_KEY
      );
      if (raw != null) {
        this.sessionBrowsersAllowlist = String(raw);
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(this.SESSION_OS_ALLOWLIST_STORAGE_KEY);
      if (raw != null) {
        this.sessionOsAllowlist = String(raw);
      }
    } catch {
      // ignore
    }

    try {
      const raw = localStorage.getItem(
        this.SESSION_SCREENS_ALLOWLIST_STORAGE_KEY
      );
      if (raw != null) {
        this.sessionScreensAllowlist = String(raw);
      }
    } catch {
      // ignore
    }

    this.flatSearchSubscription = this.flatSearchSubject
      .pipe(debounceTime(this.FLAT_FILTER_DEBOUNCE_TIME))
      .subscribe(() => {
        this.fetchFlatResponses(0, this.flatPageSize);
      });

    this.workspaceCacheInvalidatedSubscription =
      this.testResultService.workspaceCacheInvalidated$.subscribe(
        workspaceId => {
          if (!this.appService.selectedWorkspaceId) {
            return;
          }
          if (workspaceId !== this.appService.selectedWorkspaceId) {
            return;
          }
          this.refreshFlatResponseFilterOptionsWithRetry();
          this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
        }
      );

    this.syncMediaFiltersFromFlatFilters();
  }

  ngOnInit(): void {
    this.tableInitialized = true;
    this.fetchFlatResponseFilterOptions();
    this.logAnomalyTableSettingLoaded = true;
    this.updateLogAnomalyTableVisibility();
    this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
    this.syncMediaFiltersFromFlatFilters();
  }

  ngOnChanges(changes: SimpleChanges): void {
    let shouldFetch = false;

    if (changes.showWorkspaceLogAnomalies || changes.forceShowLogAnomalies) {
      shouldFetch = this.updateLogAnomalyTableVisibility() || shouldFetch;
    }

    if (changes.initialFilters) {
      this.flatFilters = {
        ...this.createDefaultFlatFilters(),
        ...(this.initialFilters || {})
      };
      this.processingDurationEnabled = false;
      this.processingDurationsFilters = [];
      this.unitProgressFilters = [];
      this.flatPageIndex = 0;
      this.syncMediaFiltersFromFlatFilters();
      shouldFetch = true;
    }

    if (shouldFetch && this.tableInitialized && this.logAnomalyTableSettingLoaded) {
      this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
    }
  }

  private createDefaultFlatFilters(): FlatResponseFilters {
    return {
      code: '',
      group: '',
      login: '',
      booklet: '',
      unit: '',
      response: '',
      responseStatus: '',
      responseValue: '',
      tags: '',
      geogebra: false,
      audioLow: false,
      nonEmptyResponse: false,
      sessionFilter: false,
      shortProcessing: false,
      longLoading: false,
      logAnomalies: ''
    };
  }

  private syncMediaFiltersFromFlatFilters(): void {
    const next: FlatTableMediaFilter[] = [];
    if (this.flatFilters.geogebra) {
      next.push('geogebra');
    }
    if (this.flatFilters.audioLow) {
      next.push('audioLow');
    }
    if (this.flatFilters.nonEmptyResponse) {
      next.push('nonEmptyResponse');
    }
    if (this.flatFilters.sessionFilter) {
      next.push('sessionFilter');
    }
    if (this.flatFilters.shortProcessing) {
      next.push('shortProcessing');
    }
    if (this.flatFilters.longLoading) {
      next.push('longLoading');
    }
    if (this.processingDurationEnabled) {
      next.push('processingDuration');
    }
    if (this.unitProgressFilters.includes('Vollständig')) {
      next.push('unitProgressComplete');
    }
    const selectedAnomalyGroups = new Set(
      String(this.flatFilters.logAnomalies || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
    );
    if (selectedAnomalyGroups.has('any') || selectedAnomalyGroups.has('all')) {
      next.push('logAny');
    }
    if (selectedAnomalyGroups.has('critical')) {
      next.push('logCritical');
    }
    if (selectedAnomalyGroups.has('technical')) {
      next.push('logTechnical');
    }
    if (selectedAnomalyGroups.has('incomplete')) {
      next.push('logIncomplete');
    }
    if (
      selectedAnomalyGroups.has('connection_lost') ||
      selectedAnomalyGroups.has('connection')
    ) {
      next.push('logConnectionLost');
    }
    if (selectedAnomalyGroups.has('timer')) {
      next.push('logTimer');
    }
    if (selectedAnomalyGroups.has('focus')) {
      next.push('logFocus');
    }
    if (selectedAnomalyGroups.has('debug')) {
      next.push('logDebug');
    }
    if (selectedAnomalyGroups.has('reloads')) {
      next.push('logReloads');
    }
    this.mediaFilters = next;
  }

  onMediaFiltersChanged(): void {
    const selected = new Set(this.mediaFilters || []);
    if (selected.has('logAny')) {
      SPECIFIC_LOG_MEDIA_FILTERS.forEach(filter => selected.delete(filter));
      this.mediaFilters = (this.mediaFilters || []).filter(filter => (
        selected.has(filter)
      ));
    }

    this.flatFilters.geogebra = selected.has('geogebra');
    this.flatFilters.audioLow = selected.has('audioLow');
    this.flatFilters.nonEmptyResponse = selected.has('nonEmptyResponse');
    this.flatFilters.sessionFilter = selected.has('sessionFilter');
    this.flatFilters.shortProcessing = selected.has('shortProcessing');
    this.flatFilters.longLoading = selected.has('longLoading');

    this.processingDurationEnabled = selected.has('processingDuration');

    if (selected.has('unitProgressComplete')) {
      if (!this.unitProgressFilters.includes('Vollständig')) {
        this.unitProgressFilters = ['Vollständig'];
      }
    } else {
      this.unitProgressFilters = this.unitProgressFilters.filter(
        f => f !== 'Vollständig'
      );
    }

    const anomalyGroups: string[] = [];
    if (selected.has('logAny')) {
      anomalyGroups.push('any');
    } else {
      if (selected.has('logCritical')) {
        anomalyGroups.push('critical');
      }
      if (selected.has('logTechnical')) {
        anomalyGroups.push('technical');
      }
      if (selected.has('logIncomplete')) {
        anomalyGroups.push('incomplete');
      }
      if (selected.has('logConnectionLost')) {
        anomalyGroups.push('connection_lost');
      }
      if (selected.has('logTimer')) {
        anomalyGroups.push('timer');
      }
      if (selected.has('logFocus')) {
        anomalyGroups.push('focus');
      }
      if (selected.has('logDebug')) {
        anomalyGroups.push('debug');
      }
      if (selected.has('logReloads')) {
        anomalyGroups.push('reloads');
      }
    }
    this.flatFilters.logAnomalies = anomalyGroups.join(',');

    this.onFlatFilterChanged();
  }

  private parseCsv(raw: string): string {
    return String(raw || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
      .join(',');
  }

  private loadFrequenciesForCurrentPage(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const combosToFetchMap = new Map<
    string,
    FlatResponseFrequencyRequestCombo
    >();
    (this.flatData || []).forEach(r => {
      const variableId = String(r.response || '').trim();
      const unitKey = String(r.unit || '').trim();
      const value = String(r.responseValue ?? '');
      if (!unitKey || !variableId) {
        return;
      }

      const key = `${encodeURIComponent(unitKey)}:${encodeURIComponent(
        variableId
      )}`;
      const cached = this.frequenciesByComboKey.get(key);
      const alreadyHave =
        !!cached &&
        Array.isArray(cached.values) &&
        cached.values.some(v => String(v.value ?? '') === value);
      if (alreadyHave) {
        return;
      }

      const existingReq = combosToFetchMap.get(key);
      if (existingReq) {
        if (!existingReq.values.includes(value)) {
          existingReq.values.push(value);
        }
      } else {
        combosToFetchMap.set(key, { unitKey, variableId, values: [value] });
      }
    });

    const combosToFetch = Array.from(combosToFetchMap.values());
    if (combosToFetch.length === 0) {
      return;
    }

    this.isLoadingFrequencies = true;
    const batchSize = 25;
    const batches: FlatResponseFrequencyRequestCombo[][] = [];
    for (let i = 0; i < combosToFetch.length; i += batchSize) {
      batches.push(combosToFetch.slice(i, i + batchSize));
    }

    let completedBatches = 0;
    batches.forEach(batch => {
      this.testResultService
        .getFlatResponseFrequencies(this.appService.selectedWorkspaceId, batch)
        .subscribe({
          next: (resp: FlatResponseFrequenciesResponse) => {
            Object.entries(resp || {}).forEach(([key, incoming]) => {
              const existing = this.frequenciesByComboKey.get(key);
              if (!existing) {
                this.frequenciesByComboKey.set(key, incoming);
                return;
              }

              const mergedValues = new Map<string, FlatResponseFrequencyItem>();
              (existing.values || []).forEach(v => mergedValues.set(String(v.value ?? ''), v)
              );
              (incoming.values || []).forEach(v => mergedValues.set(String(v.value ?? ''), v)
              );

              this.frequenciesByComboKey.set(key, {
                total: incoming.total ?? existing.total,
                values: Array.from(mergedValues.values())
              });
            });
            completedBatches += 1;
            if (completedBatches === batches.length) {
              this.isLoadingFrequencies = false;
            }
          },
          error: () => {
            completedBatches += 1;
            if (completedBatches === batches.length) {
              this.isLoadingFrequencies = false;
            }
          }
        });
    });
  }

  getFrequencySummary(row: FlatResponseRow): string {
    const comboKey = `${encodeURIComponent(
      String(row.unit || '').trim()
    )}:${encodeURIComponent(String(row.response || '').trim())}`;
    const entry = this.frequenciesByComboKey.get(comboKey);
    if (!entry || !Array.isArray(entry.values)) {
      return '';
    }

    const fmtP = (p: number) => {
      const clamped = Math.max(0, Math.min(1, Number(p || 0)));
      const s = clamped.toFixed(3);
      return s.startsWith('0') ? s.slice(1) : s;
    };

    const value = String(row.responseValue ?? '');
    const match = entry.values.find(v => String(v.value ?? '') === value);
    if (!match) {
      return '';
    }

    return `p=${fmtP(match.p)} (n=${match.count || 0})`;
  }

  onFlatFilterOptionSelected(): void {
    this.suppressNextFlatFilterChange = true;
    this.flatPageIndex = 0;
    this.fetchFlatResponses(0, this.flatPageSize);
  }

  private filterOptions(options: string[], value: string): string[] {
    const v = (value || '').trim().toLowerCase();
    if (!v) {
      return options || [];
    }
    return (options || []).filter(o => String(o).toLowerCase().includes(v));
  }

  filteredCodes(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.codes,
      this.flatFilters.code
    );
  }

  filteredGroups(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.groups,
      this.flatFilters.group
    );
  }

  filteredLogins(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.logins,
      this.flatFilters.login
    );
  }

  filteredBooklets(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.booklets,
      this.flatFilters.booklet
    );
  }

  filteredUnits(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.units,
      this.flatFilters.unit
    );
  }

  filteredResponses(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.responses,
      this.flatFilters.response
    );
  }

  filteredResponseStatuses(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.responseStatuses,
      this.flatFilters.responseStatus
    );
  }

  filteredTags(): string[] {
    return this.filterOptions(
      this.flatFilterOptions.tags,
      this.flatFilters.tags
    );
  }

  openBookletInfoFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId || !row.booklet) {
      return;
    }

    const normalizedBookletId = String(row.booklet).toUpperCase();

    const loadingSnackBar = this.snackBar.open(
      'Lade Testheft-Informationen...',
      '',
      { duration: 3000 }
    );

    this.fileService
      .getBookletInfo(this.appService.selectedWorkspaceId, normalizedBookletId)
      .subscribe({
        next: bookletInfo => {
          loadingSnackBar.dismiss();

          this.dialog.open(BookletInfoDialogComponent, {
            width: 'min(96vw, 1400px)',
            maxWidth: '96vw',
            height: '92vh',
            maxHeight: '92vh',
            data: {
              bookletInfo,
              bookletId: normalizedBookletId
            }
          });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Testheft-Informationen',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  openUnitInfoFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.getPersonTestResults(row.personId).subscribe({
      next: booklets => {
        const booklet = (booklets || []).find(b => b.name === row.booklet);
        if (!booklet) {
          this.snackBar.open('Testheft nicht gefunden', 'Info', {
            duration: 3000
          });
          return;
        }

        const unit = (booklet.units || []).find(u => u.id === row.unitId);
        const unitFileIdRaw = unit?.name || '';
        const unitFileId = String(unitFileIdRaw).trim().toUpperCase();
        if (!unitFileId) {
          this.snackBar.open('Aufgabe nicht gefunden', 'Info', {
            duration: 3000
          });
          return;
        }

        const loadingSnackBar = this.snackBar.open(
          'Lade Aufgaben-Informationen...',
          '',
          { duration: 3000 }
        );

        this.fileService
          .getUnitInfo(this.appService.selectedWorkspaceId, unitFileId)
          .subscribe({
            next: unitInfo => {
              loadingSnackBar.dismiss();

              this.dialog.open(UnitInfoDialogComponent, {
                width: 'min(96vw, 1400px)',
                maxWidth: '96vw',
                height: '92vh',
                maxHeight: '92vh',
                data: {
                  unitInfo,
                  unitId: unitFileId
                }
              });
            },
            error: () => {
              loadingSnackBar.dismiss();
              this.snackBar.open(
                'Fehler beim Laden der Aufgaben-Informationen',
                'Fehler',
                { duration: 3000 }
              );
            }
          });
      },
      error: () => {
        this.snackBar.open(
          'Fehler beim Laden der Aufgaben-Informationen',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  openBookletLogsFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService
      .getBookletLogsForUnit(this.appService.selectedWorkspaceId, row.unitId)
      .subscribe({
        next: (result: BookletLogsForUnitResponse | null) => {
          if (!result || !result.logs || result.logs.length === 0) {
            this.snackBar.open(
              'Keine Logs für dieses Testheft vorhanden',
              'Info',
              { duration: 3000 }
            );
            return;
          }

          this.dialog.open(LogDialogComponent, {
            width: '700px',
            data: {
              logs: result.logs,
              sessions: result.sessions,
              units: (result.units || []).map((u: BookletLogsForUnitResponse['units'][number]) => ({
                ...u,
                results: []
              }))
            }
          });
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Testheft-Logs', 'Fehler', {
            duration: 3000
          });
        }
      });
  }

  openNotesFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open('Lade Notizen...', '', {
      duration: 3000
    });

    this.unitNoteService
      .getUnitNotes(this.appService.selectedWorkspaceId, row.unitId)
      .subscribe({
        next: notes => {
          loadingSnackBar.dismiss();

          this.dialog.open(NoteDialogComponent, {
            width: '600px',
            data: {
              unitId: row.unitId,
              notes: (notes || []) as UnitNoteDto[],
              title: `Notizen für Aufgabe: ${row.unit || row.unitId}`
            }
          });
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open('Fehler beim Laden der Notizen', 'Fehler', {
            duration: 3000
          });
        }
      });
  }

  openUnitLogsFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService
      .getUnitLogs(this.appService.selectedWorkspaceId, row.unitId)
      .subscribe({
        next: logs => {
          if (!logs || logs.length === 0) {
            this.snackBar.open(
              'Keine Logs für diese Aufgabe vorhanden',
              'Info',
              { duration: 3000 }
            );
            return;
          }

          this.dialog.open(UnitLogsDialogComponent, {
            width: '700px',
            data: {
              logs,
              title: `Logs für Aufgabe: ${row.unit || row.unitId}`
            }
          });
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Aufgaben-Logs', 'Fehler', {
            duration: 3000
          });
        }
      });
  }

  ngOnDestroy(): void {
    this.flatSearchSubscription.unsubscribe();
    this.workspaceCacheInvalidatedSubscription.unsubscribe();
    this.refreshFilterOptionsTimeoutIds.forEach(id => window.clearTimeout(id)
    );
    this.refreshFilterOptionsTimeoutIds = [];
  }

  private refreshFlatResponseFilterOptionsWithRetry(): void {
    this.fetchFlatResponseFilterOptions();

    this.refreshFilterOptionsTimeoutIds.forEach(id => window.clearTimeout(id)
    );
    this.refreshFilterOptionsTimeoutIds = [
      window.setTimeout(() => this.fetchFlatResponseFilterOptions(), 1000),
      window.setTimeout(() => this.fetchFlatResponseFilterOptions(), 3000)
    ];
  }

  private getPersonTestResults(
    personId: number
  ): Observable<BookletFromPersonTestResults[]> {
    if (!this.appService.selectedWorkspaceId) {
      return of([]);
    }

    if (this.personTestResultsCache.has(personId)) {
      return this.personTestResultsCache.get(personId)!;
    }

    const req$ = (
      this.testResultService.getPersonTestResults(
        this.appService.selectedWorkspaceId,
        personId
      ) as unknown as Observable<BookletFromPersonTestResults[]>
    ).pipe(
      tap({
        error: () => {
          this.personTestResultsCache.delete(personId);
        }
      }),
      shareReplay(1)
    );

    this.personTestResultsCache.set(personId, req$);
    this.personTestResultsCacheOrder = this.personTestResultsCacheOrder.filter(
      id => id !== personId
    );
    this.personTestResultsCacheOrder.push(personId);
    if (
      this.personTestResultsCacheOrder.length >
      this.PERSON_TEST_RESULTS_CACHE_MAX
    ) {
      const evictId = this.personTestResultsCacheOrder.shift();
      if (evictId !== undefined) {
        this.personTestResultsCache.delete(evictId);
      }
    }
    return req$;
  }

  onFlatFilterChanged(): void {
    if (this.suppressNextFlatFilterChange) {
      this.suppressNextFlatFilterChange = false;
      return;
    }
    this.flatPageIndex = 0;
    this.flatSearchSubject.next();
  }

  clearFlatFilters(): void {
    this.flatFilters = this.createDefaultFlatFilters();
    this.syncMediaFiltersFromFlatFilters();

    this.processingDurationEnabled = false;
    this.processingDurationsFilters = [];
    this.unitProgressFilters = [];

    this.flatPageIndex = 0;
    this.fetchFlatResponses(0, this.flatPageSize);
    this.fetchFlatResponseFilterOptions();
  }

  onAudioLowThresholdChanged(): void {
    try {
      localStorage.setItem(
        this.AUDIO_LOW_THRESHOLD_STORAGE_KEY,
        String(this.audioLowThreshold)
      );
    } catch {
      // ignore
    }
    this.onFlatFilterChanged();
  }

  onShortProcessingThresholdChanged(): void {
    try {
      localStorage.setItem(
        this.SHORT_PROCESSING_THRESHOLD_STORAGE_KEY,
        String(this.shortProcessingThresholdMs)
      );
    } catch {
      // ignore
    }
    this.onFlatFilterChanged();
  }

  onLongLoadingThresholdChanged(): void {
    try {
      localStorage.setItem(
        this.LONG_LOADING_THRESHOLD_STORAGE_KEY,
        String(this.longLoadingThresholdMs)
      );
    } catch {
      // ignore
    }
    this.onFlatFilterChanged();
  }

  onFocusLostThresholdChanged(): void {
    try {
      localStorage.setItem(
        this.FOCUS_LOST_THRESHOLD_STORAGE_KEY,
        String(this.focusLostThresholdMs)
      );
    } catch {
      // ignore
    }
    this.onFlatFilterChanged();
  }

  onSessionSpanThresholdChanged(): void {
    try {
      localStorage.setItem(
        this.SESSION_SPAN_THRESHOLD_STORAGE_KEY,
        String(this.sessionSpanThresholdMs)
      );
    } catch {
      // ignore
    }
    this.onFlatFilterChanged();
  }

  onRepeatedStartThresholdChanged(): void {
    try {
      localStorage.setItem(
        this.REPEATED_START_THRESHOLD_STORAGE_KEY,
        String(this.repeatedStartThreshold)
      );
    } catch {
      // ignore
    }
    this.onFlatFilterChanged();
  }

  openFlatSettings(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService
      .getFlatResponseFilterOptions(this.appService.selectedWorkspaceId, {})
      .subscribe(opts => {
        const currentBrowsers = this.sessionBrowsersAllowlist
          .split(',')
          .map(v => v.trim())
          .filter(Boolean);
        const currentOs = this.sessionOsAllowlist
          .split(',')
          .map(v => v.trim())
          .filter(Boolean);
        const currentScreens = this.sessionScreensAllowlist
          .split(',')
          .map(v => v.trim())
          .filter(Boolean);

        const ref = this.dialog.open<
        TestResultsFlatTableSettingsDialogComponent,
        {
          audioLowThreshold: number;
          shortProcessingThresholdMs: number;
          longLoadingThresholdMs: number;
          focusLostThresholdMs: number;
          sessionSpanThresholdMs: number;
          repeatedStartThreshold: number;
          processingDurationMin: string;
          processingDurationMax: string;
          sessionBrowsersAllowlist: string[];
          sessionOsAllowlist: string[];
          sessionScreensAllowlist: string[];
          availableSessionBrowsers: string[];
          availableSessionOs: string[];
          availableSessionScreens: string[];
        },
        TestResultsFlatTableSettingsDialogResult | undefined
        >(TestResultsFlatTableSettingsDialogComponent, {
          width: '720px',
          maxWidth: '95vw',
          height: '560px',
          maxHeight: '90vh',
          data: {
            audioLowThreshold: this.audioLowThreshold,
            shortProcessingThresholdMs: this.shortProcessingThresholdMs,
            longLoadingThresholdMs: this.longLoadingThresholdMs,
            focusLostThresholdMs: this.focusLostThresholdMs,
            sessionSpanThresholdMs: this.sessionSpanThresholdMs,
            repeatedStartThreshold: this.repeatedStartThreshold,
            processingDurationMin: this.processingDurationMin,
            processingDurationMax: this.processingDurationMax,
            sessionBrowsersAllowlist:
              currentBrowsers.length > 0 ? currentBrowsers : [],
            sessionOsAllowlist: currentOs.length > 0 ? currentOs : [],
            sessionScreensAllowlist:
              currentScreens.length > 0 ? currentScreens : [],
            availableSessionBrowsers: opts.sessionBrowsers || [],
            availableSessionOs: opts.sessionOs || [],
            availableSessionScreens: opts.sessionScreens || []
          }
        });

        ref.afterClosed().subscribe(result => {
          if (!result) {
            return;
          }
          this.audioLowThreshold = result.audioLowThreshold;

          this.shortProcessingThresholdMs = result.shortProcessingThresholdMs;
          this.longLoadingThresholdMs = result.longLoadingThresholdMs;
          this.focusLostThresholdMs = result.focusLostThresholdMs;
          this.sessionSpanThresholdMs = result.sessionSpanThresholdMs;
          this.repeatedStartThreshold = result.repeatedStartThreshold;

          this.processingDurationMin = String(
            result.processingDurationMin ?? ''
          );
          this.processingDurationMax = String(
            result.processingDurationMax ?? ''
          );
          this.sessionBrowsersAllowlist = Array.isArray(
            result.sessionBrowsersAllowlist
          ) ?
            result.sessionBrowsersAllowlist.join(',') :
            '';
          this.sessionOsAllowlist = Array.isArray(result.sessionOsAllowlist) ?
            result.sessionOsAllowlist.join(',') :
            '';
          this.sessionScreensAllowlist = Array.isArray(
            result.sessionScreensAllowlist
          ) ?
            result.sessionScreensAllowlist.join(',') :
            '';

          try {
            localStorage.setItem(
              this.AUDIO_LOW_THRESHOLD_STORAGE_KEY,
              String(this.audioLowThreshold)
            );
            localStorage.setItem(
              this.SHORT_PROCESSING_THRESHOLD_STORAGE_KEY,
              String(this.shortProcessingThresholdMs)
            );
            localStorage.setItem(
              this.LONG_LOADING_THRESHOLD_STORAGE_KEY,
              String(this.longLoadingThresholdMs)
            );
            localStorage.setItem(
              this.FOCUS_LOST_THRESHOLD_STORAGE_KEY,
              String(this.focusLostThresholdMs)
            );
            localStorage.setItem(
              this.SESSION_SPAN_THRESHOLD_STORAGE_KEY,
              String(this.sessionSpanThresholdMs)
            );
            localStorage.setItem(
              this.REPEATED_START_THRESHOLD_STORAGE_KEY,
              String(this.repeatedStartThreshold)
            );
            localStorage.setItem(
              this.PROCESSING_DURATION_MIN_STORAGE_KEY,
              String(this.processingDurationMin)
            );
            localStorage.setItem(
              this.PROCESSING_DURATION_MAX_STORAGE_KEY,
              String(this.processingDurationMax)
            );
            localStorage.setItem(
              this.SESSION_BROWSERS_ALLOWLIST_STORAGE_KEY,
              String(this.sessionBrowsersAllowlist)
            );
            localStorage.setItem(
              this.SESSION_OS_ALLOWLIST_STORAGE_KEY,
              String(this.sessionOsAllowlist)
            );
            localStorage.setItem(
              this.SESSION_SCREENS_ALLOWLIST_STORAGE_KEY,
              String(this.sessionScreensAllowlist)
            );
          } catch {
            // ignore
          }

          this.onFlatFilterChanged();
        });
      });
  }

  private fetchFlatResponseFilterOptions(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    this.testResultService
      .getFlatResponseFilterOptions(this.appService.selectedWorkspaceId, {})
      .subscribe(opts => {
        this.flatFilterOptions = opts;
      });
  }

  private updateLogAnomalyTableVisibility(): boolean {
    return this.setShowLogAnomaliesInTable(this.showWorkspaceLogAnomalies);
  }

  private setShowLogAnomaliesInTable(enabled: boolean): boolean {
    const changed = this.showLogAnomaliesInTable !== enabled;
    this.showLogAnomaliesInTable = enabled;
    if (enabled) {
      this.flatDisplayedColumns = [
        'code',
        'group',
        'login',
        'booklet',
        'unit',
        'response',
        'responseStatus',
        'logStatus',
        'responseValue',
        'frequencies',
        'tags',
        'actions'
      ];
      return changed;
    }
    this.flatDisplayedColumns = [...this.baseFlatDisplayedColumns];
    return changed;
  }

  onFlatPaginatorChange(event: PageEvent): void {
    this.flatPageSize = event.pageSize;
    this.flatPageIndex = event.pageIndex;
    this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
  }

  private fetchFlatResponses(page: number, limit: number): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }
    if (!this.logAnomalyTableSettingLoaded) {
      return;
    }
    const validPage = Math.max(0, page);
    this.flatResponsesRequestSequence += 1;
    const requestSequence = this.flatResponsesRequestSequence;
    this.isLoadingFlat = true;

    const sessionFilterActive = this.flatFilters.sessionFilter;
    this.testResultService
      .getFlatResponses(this.appService.selectedWorkspaceId, {
        page: validPage + 1,
        limit,
        code: this.flatFilters.code,
        group: this.flatFilters.group,
        login: this.flatFilters.login,
        booklet: this.flatFilters.booklet,
        unit: this.flatFilters.unit,
        response: this.flatFilters.response,
        responseStatus: this.flatFilters.responseStatus,
        responseValue: this.flatFilters.responseValue,
        tags: this.flatFilters.tags,
        geogebra: this.flatFilters.geogebra ? 'true' : '',
        audioLow: this.flatFilters.audioLow ? 'true' : '',
        hasValue: this.flatFilters.nonEmptyResponse ? 'true' : '',
        audioLowThreshold: this.flatFilters.audioLow ?
          String(this.audioLowThreshold) :
          '',
        shortProcessing: this.flatFilters.shortProcessing ? 'true' : '',
        shortProcessingThresholdMs: this.flatFilters.shortProcessing ?
          String(this.shortProcessingThresholdMs) :
          '',
        longLoading: this.flatFilters.longLoading ? 'true' : '',
        longLoadingThresholdMs: String(this.longLoadingThresholdMs),
        focusLostThresholdMs: String(this.focusLostThresholdMs),
        sessionSpanThresholdMs: String(this.sessionSpanThresholdMs),
        repeatedStartThreshold: String(this.repeatedStartThreshold),
        processingDurations: '',
        processingDurationMin: this.processingDurationEnabled ?
          String(this.processingDurationMin) :
          '',
        processingDurationMax: this.processingDurationEnabled ?
          String(this.processingDurationMax) :
          '',
        unitProgress: (this.unitProgressFilters || []).join(','),
        sessionBrowsers: sessionFilterActive ?
          this.parseCsv(this.sessionBrowsersAllowlist) :
          '',
        sessionOs: sessionFilterActive ?
          this.parseCsv(this.sessionOsAllowlist) :
          '',
        sessionScreens: sessionFilterActive ?
          this.parseCsv(this.sessionScreensAllowlist) :
          '',
        logAnomalies: this.flatFilters.logAnomalies,
        includeLogAnomalies: this.showLogAnomaliesInTable ? 'true' : ''
      })
      .subscribe({
        next: resp => {
          if (requestSequence !== this.flatResponsesRequestSequence) {
            return;
          }
          this.isLoadingFlat = false;
          this.flatTotalRecords = resp.total;
          this.flatData = (resp.data || []).map(r => ({
            bookletId: r.bookletId,
            responseId: r.responseId,
            unitId: r.unitId,
            personId: r.personId,
            code: r.code,
            group: r.group,
            login: r.login,
            booklet: r.booklet,
            unit: r.unit,
            response: r.response,
            responseStatus: r.responseStatus,
            responseValue: r.responseValue,
            tags: Array.isArray(r.tags) ? r.tags : [],
            logAnomalies: Array.isArray(r.logAnomalies) ? r.logAnomalies : []
          }));

          this.loadFrequenciesForCurrentPage();
          this.loadNotesPresenceForCurrentPage();
        },
        error: () => {
          if (requestSequence === this.flatResponsesRequestSequence) {
            this.isLoadingFlat = false;
          }
        }
      });
  }

  hasNotesForRow(row: FlatResponseRow): boolean {
    return this.unitIdsWithNotes.has(row.unitId);
  }

  hasLogAnomaliesForRow(row: FlatResponseRow): boolean {
    return (row.logAnomalies || []).length > 0;
  }

  getLogAnomalySeverity(row: FlatResponseRow): LogAnomalySummary['severity'] | '' {
    const anomalies = row.logAnomalies || [];
    if (anomalies.some(anomaly => anomaly.severity === 'critical')) {
      return 'critical';
    }
    if (anomalies.some(anomaly => anomaly.severity === 'warning')) {
      return 'warning';
    }
    if (anomalies.some(anomaly => anomaly.severity === 'info')) {
      return 'info';
    }
    return '';
  }

  getLogAnomalySeverityLabel(row: FlatResponseRow): string {
    switch (this.getLogAnomalySeverity(row)) {
      case 'critical':
        return 'kritisch';
      case 'warning':
        return 'Warnung';
      case 'info':
        return 'Info';
      default:
        return 'unauffällig';
    }
  }

  getLogAnomalyTooltip(row: FlatResponseRow): string {
    const anomalies = row.logAnomalies || [];
    if (anomalies.length === 0) {
      return 'Keine Log-Auffälligkeiten für dieses Testheft erkannt.';
    }
    return anomalies
      .map(anomaly => {
        const count = anomaly.count > 1 ? ` (${anomaly.count}x)` : '';
        return `${anomaly.label}${count}: ${anomaly.evidence}`;
      })
      .join('\n');
  }

  private loadNotesPresenceForCurrentPage(): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const unitIds = Array.from(
      new Set((this.flatData || []).map(r => r.unitId).filter(id => !!id))
    );
    if (unitIds.length === 0) {
      this.unitIdsWithNotes = new Set<number>();
      return;
    }

    this.unitNoteService
      .getNotesForMultipleUnits(this.appService.selectedWorkspaceId, unitIds)
      .subscribe({
        next: notesByUnitId => {
          const nextSet = new Set<number>();
          Object.entries(notesByUnitId || {}).forEach(([unitId, notes]) => {
            if (Array.isArray(notes) && notes.length > 0) {
              nextSet.add(Number(unitId));
            }
          });
          this.unitIdsWithNotes = nextSet;
        },
        error: () => {
          this.unitIdsWithNotes = new Set<number>();
        }
      });
  }

  replayFromFlatRow(row: FlatResponseRow): void {
    if (!this.appService.selectedWorkspaceId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open('Lade Replay...', '', {
      duration: 3000
    });

    this.statisticsService
      .getReplayUrl(this.appService.selectedWorkspaceId, row.responseId)
      .subscribe({
        next: result => {
          loadingSnackBar.dismiss();
          if (result && result.replayUrl) {
            window.open(result.replayUrl, '_blank');
          } else {
            this.snackBar.open(
              'Replay-URL konnte nicht erzeugt werden',
              'Fehler',
              { duration: 3000 }
            );
          }
        },
        error: () => {
          loadingSnackBar.dismiss();
          this.snackBar.open(
            'Fehler beim Laden der Replay-URL',
            'Fehler',
            { duration: 3000 }
          );
        }
      });
  }

  deleteFromFlatRow(row: FlatResponseRow): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: <ConfirmDialogData>{
        title: 'Antwort löschen',
        content: `Möchten Sie die Antwort "${row.response}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      }
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      if (confirmed) {
        this.responseService
          .deleteResponse(this.appService.selectedWorkspaceId, row.responseId)
          .subscribe({
            next: result => {
              if (result.success) {
                this.snackBar.open(
                  `Antwort "${row.response}" wurde erfolgreich gelöscht.`,
                  'Erfolg',
                  { duration: 3000 }
                );
                this.fetchFlatResponses(this.flatPageIndex, this.flatPageSize);
                this.responseDeleted.emit();
              } else {
                this.snackBar.open(
                  `Fehler beim Löschen der Antwort: ${result.report.warnings.join(
                    ', '
                  )}`,
                  'Fehler',
                  { duration: 3000 }
                );
              }
            },
            error: () => {
              this.snackBar.open(
                'Fehler beim Löschen der Antwort. Bitte versuchen Sie es später erneut.',
                'Fehler',
                { duration: 3000 }
              );
            }
          });
      }
    });
  }

  trackByTag(index: number, item: string): string {
    return `${item}@@${index}`;
  }

  trackByRow(index: number, item: FlatResponseRow): number {
    return item.responseId;
  }
}
