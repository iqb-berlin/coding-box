import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA, MatDialogModule, MatDialogRef
} from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  MatPaginatorIntl, MatPaginatorModule, PageEvent
} from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type {
  ItemDatasetMappingIssueDto,
  ItemDatasetMappingWarningDto
} from '../../../../../../../api-dto/coding/export-request.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';

export type ItemDatasetMappingDiagnostic =
  ItemDatasetMappingIssueDto | ItemDatasetMappingWarningDto;
export type ItemDatasetMappingSeverity = 'warning' | 'error';

export interface ItemDatasetMappingDiagnosticsDialogData {
  severity: ItemDatasetMappingSeverity;
  diagnostics: ItemDatasetMappingDiagnostic[];
}

interface DiagnosticGroup {
  code: string;
  label: string;
  diagnostics: ItemDatasetMappingDiagnostic[];
}

interface DiagnosticPageState {
  pageIndex: number;
  pageSize: number;
}

const DIAGNOSTIC_CODE_TRANSLATION_KEYS: Record<string, string> = {
  'vomd-mapping': 'vomd-mapping',
  'ambiguous-vomd-fallback': 'ambiguous-vomd-fallback',
  'missing-vomd': 'missing-vomd',
  'missing-item-id': 'missing-item-id',
  'missing-variable-id': 'missing-variable-id',
  'variable-not-found': 'variable-not-found',
  'ambiguous-variable': 'ambiguous-variable',
  'ambiguous-item-fallback': 'ambiguous-item-fallback',
  'duplicate-vomd-item': 'duplicate-vomd-item',
  'ambiguous-variable-mapping': 'ambiguous-variable-mapping',
  'column-name-collision': 'column-name-collision',
  'unknown-selection': 'unknown-selection',
  'vomd-fallback-used': 'vomd-fallback-used',
  'vomd-fallback-ignored': 'vomd-fallback-ignored'
};

@Component({
  selector: 'coding-box-item-dataset-mapping-diagnostics-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    TranslateModule
  ],
  providers: [{ provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }],
  templateUrl: './item-dataset-mapping-diagnostics-dialog.component.html',
  styleUrls: ['./item-dataset-mapping-diagnostics-dialog.component.scss']
})
export class ItemDatasetMappingDiagnosticsDialogComponent {
  readonly pageSizeOptions = [10, 25, 50];
  search = '';
  selectedCode = '';
  expandedCode: string | null = null;
  availableCauses: Array<{ code: string; label: string; count: number }> = [];
  visibleGroups: DiagnosticGroup[] = [];
  private pageStates = new Map<string, DiagnosticPageState>();

  constructor(
    @Inject(MAT_DIALOG_DATA)
    readonly data: ItemDatasetMappingDiagnosticsDialogData,
    private dialogRef: MatDialogRef<
    ItemDatasetMappingDiagnosticsDialogComponent
    >,
    private translateService: TranslateService
  ) {
    this.availableCauses = this.groupDiagnostics(this.data.diagnostics)
      .map(group => ({
        code: group.code,
        label: group.label,
        count: group.diagnostics.length
      }));
    this.applyFilters();
  }

  get isWarning(): boolean {
    return this.data.severity === 'warning';
  }

  get totalCount(): number {
    return this.data.diagnostics.length;
  }

  get filteredCount(): number {
    return this.visibleGroups.reduce(
      (count, group) => count + group.diagnostics.length,
      0
    );
  }

  onFiltersChange(): void {
    this.pageStates.clear();
    this.applyFilters();
  }

  onGroupOpened(code: string): void {
    this.expandedCode = code;
  }

  getPageState(code: string): DiagnosticPageState {
    return this.pageStates.get(code) || { pageIndex: 0, pageSize: 25 };
  }

  getPageDiagnostics(group: DiagnosticGroup): ItemDatasetMappingDiagnostic[] {
    const page = this.getPageState(group.code);
    const start = page.pageIndex * page.pageSize;
    return group.diagnostics.slice(start, start + page.pageSize);
  }

  onPageChange(code: string, event: PageEvent): void {
    this.pageStates.set(code, {
      pageIndex: event.pageIndex,
      pageSize: event.pageSize
    });
  }

  getCauseLabel(code: string): string {
    const codeKey = DIAGNOSTIC_CODE_TRANSLATION_KEYS[code];
    if (!codeKey) return code;
    return this.translateService.instant(
      `ws-admin.export-options.item-dataset-diagnostic-code.${codeKey}`
    );
  }

  getSourceFileLabel(diagnostic: ItemDatasetMappingDiagnostic): string {
    const key = diagnostic.code === 'missing-vomd' ?
      'item-dataset-diagnostic-expected-file' :
      'item-dataset-diagnostic-file';
    return this.translateService.instant(`ws-admin.export-options.${key}`);
  }

  close(): void {
    this.dialogRef.close();
  }

  buildCsv(): string {
    const keys = [
      'severity',
      'cause',
      'message',
      'file',
      'unit',
      'item',
      'variable',
      'column',
      'action'
    ];
    const headers = keys.map(key => this.translateService.instant(
      `ws-admin.export-options.item-dataset-diagnostics-csv.${key}`
    ));
    const severity = this.translateService.instant(
      `ws-admin.export-options.item-dataset-diagnostics-severity-${this.data.severity}`
    );
    const rows = this.visibleGroups.flatMap(group => (
      group.diagnostics.map(diagnostic => [
        severity,
        group.label,
        diagnostic.message,
        diagnostic.sourceFile || '',
        diagnostic.unitId || '',
        diagnostic.itemId || '',
        diagnostic.variableId || '',
        diagnostic.columnName || '',
        diagnostic.suggestedAction || ''
      ])
    ));
    return `\uFEFF${[headers, ...rows]
      .map(row => row.map(value => this.escapeCsv(value)).join(';'))
      .join('\r\n')}\r\n`;
  }

  getDownloadFileName(date = new Date()): string {
    const kind = this.isWarning ? 'warnungen' : 'fehler';
    const datePart = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0')
    ].join('-');
    return `itemdatensatz-${kind}-${datePart}.csv`;
  }

  downloadCsv(): void {
    if (this.filteredCount === 0) return;
    const blob = new Blob([this.buildCsv()], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = this.getDownloadFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  private groupDiagnostics(
    diagnostics: ItemDatasetMappingDiagnostic[]
  ): DiagnosticGroup[] {
    const groups = new Map<string, ItemDatasetMappingDiagnostic[]>();
    diagnostics.forEach(diagnostic => {
      const group = groups.get(diagnostic.code) || [];
      group.push(diagnostic);
      groups.set(diagnostic.code, group);
    });
    return Array.from(groups, ([code, groupDiagnostics]) => ({
      code,
      label: this.getCauseLabel(code),
      diagnostics: groupDiagnostics
    })).sort((left, right) => (
      right.diagnostics.length - left.diagnostics.length ||
      left.label.localeCompare(right.label, 'de')
    ));
  }

  private applyFilters(): void {
    const normalizedSearch = this.search.trim().toLocaleLowerCase();
    const diagnostics = this.data.diagnostics.filter(diagnostic => (
      (!this.selectedCode || diagnostic.code === this.selectedCode) &&
      (!normalizedSearch || this.matchesSearch(diagnostic, normalizedSearch))
    ));
    this.visibleGroups = this.groupDiagnostics(diagnostics);
    this.expandedCode = this.visibleGroups[0]?.code || null;
  }

  private matchesSearch(
    diagnostic: ItemDatasetMappingDiagnostic,
    normalizedSearch: string
  ): boolean {
    return [
      diagnostic.message,
      diagnostic.sourceFile,
      diagnostic.unitId,
      diagnostic.itemId,
      diagnostic.variableId,
      diagnostic.columnName,
      diagnostic.suggestedAction
    ].some(value => value?.toLocaleLowerCase().includes(normalizedSearch));
  }

  private escapeCsv(value: string): string {
    const spreadsheetSafeValue = /^\s*[=+\-@]/.test(value) ?
      `'${value}` : value;
    return `"${spreadsheetSafeValue.replace(/"/g, '""')}"`;
  }
}
