import { CommonModule } from '@angular/common';
import { Component, Inject, ViewChild } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatOptionModule } from '@angular/material/core';
import { FormsModule } from '@angular/forms';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { TestResultsUploadIssueDto, TestResultsUploadResultDto } from '../../../../../../../api-dto/files/test-results-upload-result.dto';
import { buildCsv, downloadCsvFile } from '../validation-dialog/shared/validation-export.util';
import {
  CodingFreshnessState,
  CodingFreshnessSummaryItemDto,
  CodingFreshnessVersion
} from '../../../../../../../api-dto/coding/coding-freshness.dto';
import {
  CODING_FRESHNESS_TASK_RESULT_HELP,
  getCodingFreshnessAffectedResponseCount,
  getCodingFreshnessAffectedTaskResultCount,
  getCodingFreshnessAttentionTitle,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessStateLabel,
  getCodingFreshnessSummaryText,
  getCodingFreshnessVersionLabel,
  isCodingFreshnessOpenWarning
} from '../../../shared/utils/coding-freshness-text.util';

export type TestResultsUploadResultDialogData = {
  resultType: 'logs' | 'responses';
  result: TestResultsUploadResultDto;
};

type LogBookletDetail = { name: string; hasLog: boolean };
type LogUnitDetail = { bookletName: string; unitKey: string; hasLog: boolean };

@Component({
  selector: 'coding-box-test-results-upload-result-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatTabsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatOptionModule,
    ScrollingModule
  ],
  templateUrl: './test-results-upload-result-dialog.component.html',
  styleUrls: ['./test-results-upload-result-dialog.component.scss']
})
export class TestResultsUploadResultDialogComponent {
  @ViewChild('issuesViewport')
    issuesViewport?: CdkVirtualScrollViewport;

  private issueFilterText = '';
  private issueCategory: string | null = null;
  private readonly emptyIssues: TestResultsUploadIssueDto[] = [];
  private filteredIssuesCache: {
    source: TestResultsUploadIssueDto[];
    category: string | null;
    query: string;
    result: TestResultsUploadIssueDto[];
  } | null = null;

  constructor(
    private dialogRef: MatDialogRef<TestResultsUploadResultDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsUploadResultDialogData
  ) { }

  get result(): TestResultsUploadResultDto {
    return this.data.result;
  }

  get filterText(): string {
    return this.issueFilterText;
  }

  set filterText(value: string) {
    const nextValue = value || '';
    if (nextValue === this.issueFilterText) {
      return;
    }
    this.issueFilterText = nextValue;
    this.invalidateIssueFilter();
    this.scheduleIssueViewportRefresh(true);
  }

  get selectedCategory(): string | null {
    return this.issueCategory;
  }

  set selectedCategory(value: string | null) {
    if (value === this.issueCategory) {
      return;
    }
    this.issueCategory = value;
    this.invalidateIssueFilter();
    this.scheduleIssueViewportRefresh(true);
  }

  get issues(): TestResultsUploadIssueDto[] {
    return this.result.issues || this.emptyIssues;
  }

  get filteredIssues(): TestResultsUploadIssueDto[] {
    const source = this.issues;
    const category = this.selectedCategory;
    const query = (this.filterText || '').trim().toUpperCase();

    if (
      this.filteredIssuesCache &&
      this.filteredIssuesCache.source === source &&
      this.filteredIssuesCache.category === category &&
      this.filteredIssuesCache.query === query
    ) {
      return this.filteredIssuesCache.result;
    }

    let filtered = source;

    // Filter by category
    if (category) {
      filtered = filtered.filter(i => i.category === category);
    }

    // Filter by search text
    if (query) {
      filtered = filtered.filter(i => {
        const parts = [i.level, i.message, i.fileName, i.category, String(i.rowIndex ?? '')]
          .filter(Boolean)
          .map(s => String(s).toUpperCase());
        return parts.some(p => p.includes(query));
      });
    }

    this.filteredIssuesCache = {
      source,
      category,
      query,
      result: filtered
    };

    return filtered;
  }

  get hasActiveIssueFilter(): boolean {
    return !!this.selectedCategory ||
      (this.filterText || '').trim().length > 0;
  }

  get issueExportButtonLabel(): string {
    const count = this.filteredIssues.length;
    return this.hasActiveIssueFilter ?
      `Gefilterte exportieren (${count})` :
      `Probleme exportieren (${count})`;
  }

  get resultTypeLabel(): string {
    return this.data.resultType === 'logs' ? 'Logs' : 'Antworten';
  }

  get statusCounts(): Array<{ status: string; count: number }> {
    const map = (this.result.responseStatusCounts || {}) as Record<string, number>;
    return Object.entries(map)
      .map(([status, count]) => ({ status, count: Number(count) }))
      .sort((a, b) => a.status.localeCompare(b.status));
  }

  get hasZeroDelta(): boolean {
    const delta = this.result.delta;
    return (delta.testPersons || 0) === 0 &&
      (delta.testGroups || 0) === 0 &&
      (delta.uniqueBooklets || 0) === 0 &&
      (delta.uniqueUnits || 0) === 0 &&
      (delta.uniqueResponses || 0) === 0;
  }

  get codingFreshnessWarnings(): CodingFreshnessSummaryItemDto[] {
    return (this.result.codingFreshness?.items || [])
      .filter(isCodingFreshnessOpenWarning)
      .sort((a, b) => a.version.localeCompare(b.version) || a.state.localeCompare(b.state));
  }

  get hasCodingFreshnessWarning(): boolean {
    return this.codingFreshnessWarnings.length > 0;
  }

  get codingFreshnessAffectedUnitVersions(): number {
    return getCodingFreshnessAffectedTaskResultCount(this.codingFreshnessWarnings);
  }

  get codingFreshnessAffectedResponses(): number {
    return getCodingFreshnessAffectedResponseCount(this.codingFreshnessWarnings);
  }

  get codingFreshnessSummaryText(): string {
    return getCodingFreshnessSummaryText(this.codingFreshnessWarnings);
  }

  get codingFreshnessDialogTitle(): string {
    return getCodingFreshnessAttentionTitle(this.codingFreshnessWarnings);
  }

  get codingFreshnessExplanationText(): string {
    const guidanceText = getCodingFreshnessManualReviewGuidanceText(
      this.codingFreshnessWarnings
    );
    if (guidanceText) {
      return `${guidanceText} ${CODING_FRESHNESS_TASK_RESULT_HELP}`;
    }

    return CODING_FRESHNESS_TASK_RESULT_HELP;
  }

  getVersionLabel(version: CodingFreshnessVersion): string {
    return getCodingFreshnessVersionLabel(version);
  }

  getFreshnessStateLabel(state: CodingFreshnessState): string {
    return getCodingFreshnessStateLabel(state);
  }

  getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
    return getCodingFreshnessChipLabel(item);
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      log_format: 'Log-Format ungültig',
      unit_not_found: 'Unit nicht gefunden',
      invalid_unit: 'Ungültige Unit',
      laststate: 'Letzter Status Fehler',
      missing_booklet: 'Booklet fehlt',
      missing_status: 'Status fehlt',
      invalid_status: 'Status ungültig',
      csv_columns: 'CSV-Spalten fehlen',
      missing_identity: 'Zuordnung unvollständig',
      timestamp: 'Zeitstempel auffällig',
      missing_booklet_log: 'Booklet-Log fehlt',
      no_logs_saved: 'Keine Logs gespeichert',
      other: 'Sonstiges'
    };
    return labels[category] || category;
  }

  get issueSummaryEntries(): Array<{ category: string; label: string; count: number }> {
    const issueCounts = this.result.importSummary?.issueCounts || {};
    return Object.entries(issueCounts)
      .map(([category, count]) => ({
        category,
        label: category === 'uncategorized' ? 'Ohne Kategorie' : this.getCategoryLabel(category),
        count: Number(count || 0)
      }))
      .filter(entry => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  trackByIssue(index: number, item: TestResultsUploadIssueDto): string {
    return `${item.level}@@${item.fileName || ''}@@${item.rowIndex || ''}@@${item.message}@@${index}`;
  }

  exportIssues(): void {
    const issuesToExport = this.filteredIssues;
    if (issuesToExport.length === 0) {
      return;
    }

    downloadCsvFile(
      this.getIssueExportFileName(),
      this.buildIssueExportCsv(issuesToExport)
    );
  }

  buildIssueExportCsv(issues: TestResultsUploadIssueDto[] = this.filteredIssues): string {
    return buildCsv(
      issues.map((issue, index) => ({
        index: index + 1,
        resultType: this.resultTypeLabel,
        level: issue.level,
        category: issue.category || '',
        categoryLabel: issue.category ?
          this.getCategoryLabel(issue.category) :
          '',
        message: issue.message,
        fileName: issue.fileName || '',
        rowIndex: issue.rowIndex ?? ''
      })),
      [
        { header: 'Nr.', value: row => row.index },
        { header: 'Importart', value: row => row.resultType },
        { header: 'Typ', value: row => row.level },
        { header: 'Kategorie', value: row => row.category },
        { header: 'Kategorie (Text)', value: row => row.categoryLabel },
        { header: 'Meldung', value: row => row.message },
        { header: 'Datei', value: row => row.fileName },
        { header: 'Zeile', value: row => row.rowIndex }
      ]
    );
  }

  detailView: 'booklets' | 'units' = 'booklets';
  detailStatusFilter: 'all' | 'withLogs' | 'withoutLogs' = 'all';
  detailFilterText = '';

  get bookletDetails(): LogBookletDetail[] {
    return this.result.logMetrics?.bookletDetails || [];
  }

  get unitDetails(): LogUnitDetail[] {
    return this.result.logMetrics?.unitDetails || [];
  }

  get hasAnyLogDetails(): boolean {
    return this.bookletDetails.length > 0 || this.unitDetails.length > 0;
  }

  get detailTabLabel(): string {
    if (!this.hasAnyLogDetails) {
      return 'Details';
    }

    const count = this.detailView === 'booklets' ?
      this.filteredBookletDetails.length :
      this.filteredUnitDetails.length;

    return `Details (${count})`;
  }

  get emptyDetailMessage(): string {
    if (!this.hasAnyLogDetails) {
      return 'Detaildaten konnten nicht geladen werden.';
    }

    const hasFilter = (this.detailFilterText || '').trim().length > 0 ||
      this.detailStatusFilter !== 'all';

    if (hasFilter) {
      return this.detailView === 'booklets' ?
        'Keine Booklets passend zum Filter gefunden.' :
        'Keine Units passend zum Filter gefunden.';
    }

    return this.detailView === 'booklets' ?
      'Keine Booklets gefunden.' :
      'Keine Units gefunden.';
  }

  get emptyIssuesMessage(): string {
    return this.hasActiveIssueFilter ?
      'Keine passenden technischen Importprobleme gefunden.' :
      'Keine technischen Importprobleme gefunden.';
  }

  get filteredBookletDetails(): LogBookletDetail[] {
    const q = (this.detailFilterText || '').trim().toUpperCase();
    let list = this.applyLogDetailStatusFilter([...this.bookletDetails]);
    if (q) {
      list = list.filter(b => b.name.toUpperCase().includes(q));
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  get filteredUnitDetails(): LogUnitDetail[] {
    const q = (this.detailFilterText || '').trim().toUpperCase();
    let list = this.applyLogDetailStatusFilter([...this.unitDetails]);
    if (q) {
      list = list.filter(u => u.bookletName.toUpperCase().includes(q) ||
        u.unitKey.toUpperCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const cmpBooklet = a.bookletName.localeCompare(b.bookletName);
      if (cmpBooklet !== 0) return cmpBooklet;
      return a.unitKey.localeCompare(b.unitKey);
    });
  }

  trackByBookletDetail(index: number, item: LogBookletDetail): string {
    return `${item.name}-${item.hasLog}`;
  }

  trackByUnitDetail(index: number, item: LogUnitDetail): string {
    return `${item.bookletName}-${item.unitKey}-${item.hasLog}`;
  }

  private applyLogDetailStatusFilter<T extends { hasLog: boolean }>(items: T[]): T[] {
    if (this.detailStatusFilter === 'withLogs') {
      return items.filter(item => item.hasLog);
    }

    if (this.detailStatusFilter === 'withoutLogs') {
      return items.filter(item => !item.hasLog);
    }

    return items;
  }

  onCategoryChange(): void {
    this.invalidateIssueFilter();
    this.scheduleIssueViewportRefresh(true);
  }

  onTabChange(): void {
    this.scheduleIssueViewportRefresh();
  }

  close(): void {
    this.dialogRef.close();
  }

  private invalidateIssueFilter(): void {
    this.filteredIssuesCache = null;
  }

  private scheduleIssueViewportRefresh(resetScroll = false): void {
    window.setTimeout(() => {
      if (resetScroll) {
        this.issuesViewport?.scrollToIndex(0);
      }
      this.issuesViewport?.checkViewportSize();
    });
  }

  private getIssueExportFileName(): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const scope = this.hasActiveIssueFilter ? 'gefiltert' : 'alle';
    return `upload-probleme-${this.data.resultType}-${scope}-${timestamp}.csv`;
  }
}
