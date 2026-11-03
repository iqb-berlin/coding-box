import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component, DestroyRef, OnChanges, OnInit, SimpleChanges, inject, signal, computed, input, output, ChangeDetectionStrategy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, switchMap, timer } from 'rxjs';
import { AppService } from '../../../core/services/app.service';
import { TestResultService, LogAnomalySummary } from '../../../shared/services/test-result/test-result.service';
import { hasInvalidPostgresRegexFilter } from '../../../shared/utils/regex-filter.util';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import {
  FlatResponseRow, FlatResponseFilters, FlatTableMediaFilter, RegexFlatResponseFilterField,
  REGEX_FLAT_RESPONSE_FILTER_FIELDS, SPECIFIC_LOG_MEDIA_FILTERS
} from './test-results-flat-table.models';
import { TestResultsFlatTableDataFacade } from './test-results-flat-table-data.facade';
import { TestResultsFlatTableSettingsFacade } from './test-results-flat-table-settings.facade';
import { TestResultsFlatTableActionsFacade } from './test-results-flat-table-actions.facade';

export { FlatResponseFilters } from './test-results-flat-table.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    MatSelectModule,
    TranslateModule
  ],
  providers: [TestResultsFlatTableDataFacade, TestResultsFlatTableSettingsFacade, TestResultsFlatTableActionsFacade],
  templateUrl: './test-results-flat-table.component.html',
  styleUrls: ['./test-results-flat-table.component.scss']
})
export class TestResultsFlatTableComponent implements OnInit, OnChanges {
  private readonly destroyRef = inject(DestroyRef);

  private appService = inject(AppService);

  private testResultService = inject(TestResultService);

  private snackBar = inject(MatSnackBar);

  private translateService = inject(TranslateService);
  private readonly data = inject(TestResultsFlatTableDataFacade);
  private readonly settings = inject(TestResultsFlatTableSettingsFacade);
  private readonly actions = inject(TestResultsFlatTableActionsFacade);

  readonly flatData = this.data.rows;
  readonly flatFilterOptions = this.data.options;
  readonly isLoadingFrequencies = this.data.loadingFrequencies;
  protected readonly flatTotalRecords = this.data.total;
  protected readonly isLoadingFlat = this.data.loading;
  readonly audioLowThreshold = computed(() => this.settings.value().audioLowThreshold);
  readonly shortProcessingThresholdMs = computed(() => this.settings.value().shortProcessingThresholdMs);
  readonly longLoadingThresholdMs = computed(() => this.settings.value().longLoadingThresholdMs);
  readonly focusLostThresholdMs = computed(() => this.settings.value().focusLostThresholdMs);
  readonly sessionSpanThresholdMs = computed(() => this.settings.value().sessionSpanThresholdMs);
  readonly repeatedStartThreshold = computed(() => this.settings.value().repeatedStartThreshold);
  readonly processingDurationMin = computed(() => this.settings.value().processingDurationMin);
  readonly processingDurationMax = computed(() => this.settings.value().processingDurationMax);
  readonly sessionBrowsersAllowlist = computed(() => this.settings.value().sessionBrowsersAllowlist);
  readonly sessionOsAllowlist = computed(() => this.settings.value().sessionOsAllowlist);
  readonly sessionScreensAllowlist = computed(() => this.settings.value().sessionScreensAllowlist);

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

  readonly flatDisplayedColumns = signal<string[]>([...this.baseFlatDisplayedColumns]);

  readonly showLogAnomaliesInTable = signal(false);

  private logAnomalyTableSettingLoaded = false;

  private tableInitialized = false;

  protected readonly flatPageSize = signal<number>(100);

  protected readonly flatPageIndex = signal<number>(0);

  readonly flatFilters = signal<FlatResponseFilters>(this.createDefaultFlatFilters());

  readonly mediaFilters = signal<FlatTableMediaFilter[]>([]);

  readonly processingDurationEnabled = signal<boolean>(false);

  readonly unitProgressFilters = signal<string[]>([]);

  private readonly backendInvalidRegexFields =
    new Set<RegexFlatResponseFilterField>();

  private suppressNextFlatFilterChange = false;

  readonly initialFilters = input<Partial<FlatResponseFilters> | null>(null);

  readonly showWorkspaceLogAnomalies = input(false);

  readonly forceShowLogAnomalies = input(false);

  readonly enableRegexSearch = input(false);

  readonly responseDeleted = output<void>();
  private readonly flatSearchSubject = new Subject<void>();

  constructor() {
    this.flatSearchSubject.pipe(
      switchMap(() => timer(400).pipe(takeUntilWorkspaceChanged(this.appService))),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      if (!this.hasInvalidRegexFilters()) this.fetchFlatResponses(0, this.flatPageSize());
    });
    this.data.errors$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(error => this.showFlatResponseLoadError(error));
    this.settings.changed$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.onFlatFilterChanged());
    this.actions.deleted$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.data.invalidateCaches();
      this.fetchFlatResponses(this.flatPageIndex(), this.flatPageSize());
      this.responseDeleted.emit();
    });
    this.testResultService.workspaceCacheInvalidated$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(workspaceId => {
      if (!workspaceId || workspaceId !== this.appService.selectedWorkspaceId) return;
      this.data.invalidateCaches();
      this.data.loadOptions(true);
      this.fetchFlatResponses(this.flatPageIndex(), this.flatPageSize());
    });
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.backendInvalidRegexFields.clear();
      this.flatFilters.set(this.createDefaultFlatFilters());
      this.processingDurationEnabled.set(false);
      this.unitProgressFilters.set([]);
      this.syncMediaFiltersFromFlatFilters();
      this.flatPageIndex.set(0);
      if (this.tableInitialized) {
        this.fetchFlatResponseFilterOptions();
        this.fetchFlatResponses(0, this.flatPageSize());
      }
    });
    this.syncMediaFiltersFromFlatFilters();
  }

  ngOnInit(): void {
    this.tableInitialized = true;
    this.fetchFlatResponseFilterOptions();
    this.logAnomalyTableSettingLoaded = true;
    this.updateLogAnomalyTableVisibility();
    this.fetchFlatResponses(this.flatPageIndex(), this.flatPageSize());
    this.syncMediaFiltersFromFlatFilters();
  }

  ngOnChanges(changes: SimpleChanges): void {
    let shouldFetch = false;

    if (changes.showWorkspaceLogAnomalies || changes.forceShowLogAnomalies) {
      shouldFetch = this.updateLogAnomalyTableVisibility() || shouldFetch;
    }

    if (changes.enableRegexSearch) {
      this.backendInvalidRegexFields.clear();
      this.flatPageIndex.set(0);
      shouldFetch = true;
    }

    if (changes.initialFilters) {
      this.backendInvalidRegexFields.clear();
      this.flatFilters.set({
        ...this.createDefaultFlatFilters(),
        ...(this.initialFilters() || {})
      });
      this.processingDurationEnabled.set(false);
      this.unitProgressFilters.set([]);
      this.flatPageIndex.set(0);
      this.syncMediaFiltersFromFlatFilters();
      shouldFetch = true;
    }

    if (shouldFetch &&
      this.tableInitialized &&
      this.logAnomalyTableSettingLoaded &&
      !this.hasInvalidRegexFilters()) {
      this.fetchFlatResponses(this.flatPageIndex(), this.flatPageSize());
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
    if (this.flatFilters().geogebra) {
      next.push('geogebra');
    }
    if (this.flatFilters().audioLow) {
      next.push('audioLow');
    }
    if (this.flatFilters().nonEmptyResponse) {
      next.push('nonEmptyResponse');
    }
    if (this.flatFilters().sessionFilter) {
      next.push('sessionFilter');
    }
    if (this.flatFilters().shortProcessing) {
      next.push('shortProcessing');
    }
    if (this.flatFilters().longLoading) {
      next.push('longLoading');
    }
    if (this.processingDurationEnabled()) {
      next.push('processingDuration');
    }
    if (this.unitProgressFilters().includes('Vollständig')) {
      next.push('unitProgressComplete');
    }
    const selectedAnomalyGroups = new Set(
      String(this.flatFilters().logAnomalies || '')
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
    this.mediaFilters.set(next);
  }

  onMediaFiltersChanged(): void {
    const selected = new Set(this.mediaFilters() || []);
    if (selected.has('logAny')) {
      SPECIFIC_LOG_MEDIA_FILTERS.forEach(filter => selected.delete(filter));
      this.mediaFilters.set((this.mediaFilters() || []).filter(filter => (selected.has(filter))));
    }

    this.flatFilters.update(value => ({ ...value, geogebra: selected.has('geogebra') }));
    this.flatFilters.update(value => ({ ...value, audioLow: selected.has('audioLow') }));
    this.flatFilters.update(value => ({ ...value, nonEmptyResponse: selected.has('nonEmptyResponse') }));
    this.flatFilters.update(value => ({ ...value, sessionFilter: selected.has('sessionFilter') }));
    this.flatFilters.update(value => ({ ...value, shortProcessing: selected.has('shortProcessing') }));
    this.flatFilters.update(value => ({ ...value, longLoading: selected.has('longLoading') }));

    this.processingDurationEnabled.set(selected.has('processingDuration'));

    if (selected.has('unitProgressComplete')) {
      if (!this.unitProgressFilters().includes('Vollständig')) {
        this.unitProgressFilters.set(['Vollständig']);
      }
    } else {
      this.unitProgressFilters.set(this.unitProgressFilters().filter(f => f !== 'Vollständig'));
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
    this.flatFilters.update(value => ({ ...value, logAnomalies: anomalyGroups.join(',') }));

    this.onFlatFilterChanged();
  }

  private parseCsv(raw: string): string {
    return String(raw || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
      .join(',');
  }

  protected onFlatFilterOptionSelected(): void {
    this.suppressNextFlatFilterChange = true;
    this.flatPageIndex.set(0);
    this.fetchFlatResponses(0, this.flatPageSize());
  }

  private filterOptions(
    options: string[],
    value: string,
    disableForRegex = false
  ): string[] {
    if (disableForRegex && this.enableRegexSearch()) {
      return [];
    }
    const v = (value || '').trim().toLowerCase();
    if (!v) {
      return options || [];
    }
    return (options || []).filter(o => String(o).toLowerCase().includes(v));
  }

  filteredCodes(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().codes,
      this.flatFilters().code,
      true
    );
  }

  protected filteredGroups(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().groups,
      this.flatFilters().group,
      true
    );
  }

  protected filteredLogins(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().logins,
      this.flatFilters().login,
      true
    );
  }

  protected filteredBooklets(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().booklets,
      this.flatFilters().booklet,
      true
    );
  }

  protected filteredUnits(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().units,
      this.flatFilters().unit,
      true
    );
  }

  protected filteredResponses(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().responses,
      this.flatFilters().response,
      true
    );
  }

  protected filteredResponseStatuses(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().responseStatuses,
      this.flatFilters().responseStatus
    );
  }

  protected filteredTags(): string[] {
    return this.filterOptions(
      this.flatFilterOptions().tags,
      this.flatFilters().tags
    );
  }

  isRegexFilterInvalid(field: RegexFlatResponseFilterField): boolean {
    const enableRegexSearch = this.enableRegexSearch();
    return enableRegexSearch && (
      this.backendInvalidRegexFields.has(field) ||
      hasInvalidPostgresRegexFilter(
        this.flatFilters()[field],
        enableRegexSearch
      )
    );
  }

  private hasInvalidRegexFilters(): boolean {
    return REGEX_FLAT_RESPONSE_FILTER_FIELDS.some(
      field => this.isRegexFilterInvalid(field)
    );
  }

  onFlatFilterChanged(): void {
    if (this.suppressNextFlatFilterChange) {
      this.suppressNextFlatFilterChange = false;
      return;
    }
    this.backendInvalidRegexFields.clear();
    this.data.cancelPage();
    this.flatPageIndex.set(0);
    this.flatSearchSubject.next();
  }

  protected clearFlatFilters(): void {
    this.backendInvalidRegexFields.clear();
    this.flatFilters.set(this.createDefaultFlatFilters());
    this.syncMediaFiltersFromFlatFilters();

    this.processingDurationEnabled.set(false);
    this.unitProgressFilters.set([]);

    this.flatPageIndex.set(0);
    this.fetchFlatResponses(0, this.flatPageSize());
    this.fetchFlatResponseFilterOptions();
  }

  private updateLogAnomalyTableVisibility(): boolean {
    return this.setShowLogAnomaliesInTable(this.showWorkspaceLogAnomalies());
  }

  private setShowLogAnomaliesInTable(enabled: boolean): boolean {
    const changed = this.showLogAnomaliesInTable() !== enabled;
    this.showLogAnomaliesInTable.set(enabled);
    if (enabled) {
      this.flatDisplayedColumns.set([
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
      ]);
      return changed;
    }
    this.flatDisplayedColumns.set([...this.baseFlatDisplayedColumns]);
    return changed;
  }

  onFlatPaginatorChange(event: PageEvent): void {
    this.flatPageSize.set(event.pageSize);
    this.flatPageIndex.set(event.pageIndex);
    this.fetchFlatResponses(this.flatPageIndex(), this.flatPageSize());
  }

  private fetchFlatResponses(page: number, limit: number): void {
    if (!this.appService.selectedWorkspaceId || !this.logAnomalyTableSettingLoaded) return;
    if (this.hasInvalidRegexFilters()) {
      this.data.cancelPage();
      return;
    }
    const validPage = Math.max(0, page);
    const sessionFilterActive = this.flatFilters().sessionFilter;
    this.data.loadPage({
      page: validPage + 1,
      limit,
      code: this.flatFilters().code,
      group: this.flatFilters().group,
      login: this.flatFilters().login,
      booklet: this.flatFilters().booklet,
      unit: this.flatFilters().unit,
      response: this.flatFilters().response,
      responseStatus: this.flatFilters().responseStatus,
      responseValue: this.flatFilters().responseValue,
      tags: this.flatFilters().tags,
      regexSearch: this.enableRegexSearch(),
      geogebra: this.flatFilters().geogebra ? 'true' : '',
      audioLow: this.flatFilters().audioLow ? 'true' : '',
      hasValue: this.flatFilters().nonEmptyResponse ? 'true' : '',
      audioLowThreshold: this.flatFilters().audioLow ?
        String(this.audioLowThreshold()) :
        '',
      shortProcessing: this.flatFilters().shortProcessing ? 'true' : '',
      shortProcessingThresholdMs: this.flatFilters().shortProcessing ?
        String(this.shortProcessingThresholdMs()) :
        '',
      longLoading: this.flatFilters().longLoading ? 'true' : '',
      longLoadingThresholdMs: String(this.longLoadingThresholdMs()),
      focusLostThresholdMs: String(this.focusLostThresholdMs()),
      sessionSpanThresholdMs: String(this.sessionSpanThresholdMs()),
      repeatedStartThreshold: String(this.repeatedStartThreshold()),
      processingDurations: '',
      processingDurationMin: this.processingDurationEnabled() ?
        String(this.processingDurationMin()) :
        '',
      processingDurationMax: this.processingDurationEnabled() ?
        String(this.processingDurationMax()) :
        '',
      unitProgress: (this.unitProgressFilters() || []).join(','),
      sessionBrowsers: sessionFilterActive ?
        this.parseCsv(this.sessionBrowsersAllowlist()) :
        '',
      sessionOs: sessionFilterActive ?
        this.parseCsv(this.sessionOsAllowlist()) :
        '',
      sessionScreens: sessionFilterActive ?
        this.parseCsv(this.sessionScreensAllowlist()) :
        '',
      logAnomalies: this.flatFilters().logAnomalies,
      includeLogAnomalies: this.showLogAnomaliesInTable() ? 'true' : ''
    });
  }

  private showFlatResponseLoadError(error: HttpErrorResponse): void {
    const backendMessage = typeof error.error?.message === 'string' ?
      error.error.message :
      '';
    const errorCode = typeof error.error?.code === 'string' ?
      error.error.code :
      '';
    const errorField = typeof error.error?.field === 'string' ?
      error.error.field :
      '';
    let messageKey = 'search-filter.test-results-load-error';

    if (error.status === 400 && errorCode === 'SEARCH_TIMEOUT') {
      messageKey = 'search-filter.response-value-timeout';
    } else if (error.status === 400 && errorCode === 'REGEX_TIMEOUT') {
      messageKey = 'search-filter.regex-timeout';
    } else if (error.status === 400 && errorCode === 'INVALID_REGEX') {
      messageKey = 'search-filter.invalid-postgres-regex';
      if (this.isRegexFilterField(errorField)) {
        this.backendInvalidRegexFields.add(errorField);
      }
    } else if (error.status === 400 && /timed out/i.test(backendMessage)) {
      messageKey = this.flatFilters().responseValue.trim() ?
        'search-filter.response-value-timeout' :
        'search-filter.regex-timeout';
    } else if (error.status === 400 && this.enableRegexSearch()) {
      messageKey = 'search-filter.invalid-postgres-regex';
    }

    this.snackBar.open(
      this.translateService.instant(messageKey),
      this.translateService.instant('close'),
      { duration: 5000, panelClass: ['error-snackbar'] }
    );
  }

  private isRegexFilterField(
    field: string
  ): field is RegexFlatResponseFilterField {
    return REGEX_FLAT_RESPONSE_FILTER_FIELDS.includes(
      field as RegexFlatResponseFilterField
    );
  }

  protected hasLogAnomaliesForRow(row: FlatResponseRow): boolean {
    return (row.logAnomalies || []).length > 0;
  }

  protected getLogAnomalySeverity(row: FlatResponseRow): LogAnomalySummary['severity'] | '' {
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

  protected getLogAnomalySeverityLabel(row: FlatResponseRow): string {
    switch (this.getLogAnomalySeverity(row)) {
      case 'critical':
        return this.translateService.instant('test-results-table.severity-critical');
      case 'warning':
        return this.translateService.instant('test-results-table.severity-warning');
      case 'info':
        return this.translateService.instant('common.info');
      default:
        return this.translateService.instant('test-results-table.severity-none');
    }
  }

  protected getLogAnomalyTooltip(row: FlatResponseRow): string {
    const anomalies = row.logAnomalies || [];
    if (anomalies.length === 0) {
      return this.translateService.instant('test-results-table.no-anomalies');
    }
    return anomalies
      .map(anomaly => {
        const count = anomaly.count > 1 ? ` (${anomaly.count}x)` : '';
        return `${anomaly.label}${count}: ${anomaly.evidence}`;
      })
      .join('\n');
  }

  protected trackByTag(index: number, item: string): string {
    return `${item}@@${index}`;
  }

  protected trackByRow(index: number, item: FlatResponseRow): number {
    return item.responseId;
  }

  protected setFlatFiltersField<K extends keyof FlatResponseFilters>(key: K, value: FlatResponseFilters[K]): void {
    this.flatFilters.update(current => (current ? { ...current, [key]: value } : current));
  }

  private fetchFlatResponseFilterOptions(): void { this.data.loadOptions(); }

  protected openFlatSettings(): void { this.settings.open(); }

  getFrequencySummary(row: FlatResponseRow): string { return this.data.frequencySummary(row); }

  protected hasNotesForRow(row: FlatResponseRow): boolean { return this.data.noteIds().has(row.unitId); }

  openBookletInfoFromFlatRow(row: FlatResponseRow): void { this.actions.openBookletInfoFromFlatRow(row); }

  openUnitInfoFromFlatRow(row: FlatResponseRow): void { this.actions.openUnitInfoFromFlatRow(row); }

  protected openBookletLogsFromFlatRow(row: FlatResponseRow): void { this.actions.openBookletLogsFromFlatRow(row); }

  protected openNotesFromFlatRow(row: FlatResponseRow): void { this.actions.openNotesFromFlatRow(row); }

  protected openUnitLogsFromFlatRow(row: FlatResponseRow): void { this.actions.openUnitLogsFromFlatRow(row); }

  protected replayFromFlatRow(row: FlatResponseRow): void { this.actions.replayFromFlatRow(row); }

  protected deleteFromFlatRow(row: FlatResponseRow): void { this.actions.deleteFromFlatRow(row); }
}
