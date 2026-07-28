import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import {
  MatPaginatorIntl,
  MatPaginatorModule,
  PageEvent
} from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type {
  ItemMatrixCellFailureReason,
  ItemMatrixExportDiagnosticGroupDto,
  ItemMatrixExportDiagnosticsDto
} from '../../../../../../api-dto/coding/export-request.dto';
import { GermanPaginatorIntl } from '../../shared/services/german-paginator-intl.service';

@Component({
  selector: 'coding-box-item-matrix-diagnostics-dialog',
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
  templateUrl: './item-matrix-diagnostics-dialog.component.html',
  styleUrls: ['./item-matrix-diagnostics-dialog.component.scss']
})
export class ItemMatrixDiagnosticsDialogComponent {
  readonly data = inject<ItemMatrixExportDiagnosticsDto>(MAT_DIALOG_DATA);

  private readonly dialogRef = inject<
  MatDialogRef<ItemMatrixDiagnosticsDialogComponent>
  >(MatDialogRef);

  private readonly translateService = inject(TranslateService);

  readonly pageSizeOptions = [10, 25, 50];
  search = '';
  selectedReason = '';
  pageIndex = 0;
  pageSize = 25;
  readonly reasonOptions = this.buildReasonOptions();
  filteredGroups: ItemMatrixExportDiagnosticGroupDto[] = this.data.groups;
  visibleGroups: ItemMatrixExportDiagnosticGroupDto[] =
    this.filteredGroups.slice(0, this.pageSize);

  private buildReasonOptions(): Array<{
    reasonCode: ItemMatrixCellFailureReason;
    count: number;
  }> {
    const counts = new Map<ItemMatrixCellFailureReason, number>();
    this.data.groups.forEach(group => counts.set(
      group.reasonCode,
      (counts.get(group.reasonCode) || 0) + group.count
    ));
    return Array.from(counts, ([reasonCode, count]) => ({ reasonCode, count }))
      .sort((left, right) => right.count - left.count);
  }

  onFiltersChange(): void {
    const search = this.search.trim().toLocaleLowerCase();
    this.filteredGroups = this.data.groups.filter(group => (
      (!this.selectedReason || group.reasonCode === this.selectedReason) &&
      (!search || [
        group.reasonCode,
        this.getReasonLabel(group.reasonCode),
        this.getSuggestedAction(group.reasonCode),
        group.bookletName,
        group.columnName,
        group.sampleRowNumbers.join(' ')
      ].some(value => value.toLocaleLowerCase().includes(search)))
    ));
    this.pageIndex = 0;
    this.updateVisibleGroups();
  }

  onPageChange(event: PageEvent): void {
    this.pageIndex = event.pageIndex;
    this.pageSize = event.pageSize;
    this.updateVisibleGroups();
  }

  trackGroup(
    _index: number,
    group: ItemMatrixExportDiagnosticGroupDto
  ): string {
    return `${group.reasonCode}\u0000${group.bookletName}\u0000${group.columnName}`;
  }

  getReasonLabel(reason: ItemMatrixCellFailureReason): string {
    return this.translateService.instant(
      `export-toast.item-matrix-diagnostics.reasons.${reason}.label`
    );
  }

  getSuggestedAction(reason: ItemMatrixCellFailureReason): string {
    return this.translateService.instant(
      `export-toast.item-matrix-diagnostics.reasons.${reason}.action`
    );
  }

  downloadCsv(): void {
    const rows: Array<Array<string | number>> = [[
      'reason_code',
      'ursache',
      'booklet',
      'spalte',
      'anzahl',
      'beispielzeilen',
      'empfohlene_massnahme'
    ]];
    this.filteredGroups.forEach(group => rows.push([
      group.reasonCode,
      this.getReasonLabel(group.reasonCode),
      group.bookletName,
      group.columnName,
      group.count,
      group.sampleRowNumbers.join(', '),
      this.getSuggestedAction(group.reasonCode)
    ]));
    const csv = `\uFEFF${rows.map(row => (
      row.map(value => this.escapeCsv(value)).join(';')
    )).join('\r\n')}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], {
      type: 'text/csv;charset=utf-8'
    }));
    const link = document.createElement('a');
    link.href = url;
    link.download =
      `Itemdatensatz-Diagnose-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  close(): void {
    this.dialogRef.close();
  }

  private escapeCsv(value: string | number): string {
    const text = String(value);
    const spreadsheetSafe = /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
  }

  private updateVisibleGroups(): void {
    const start = this.pageIndex * this.pageSize;
    this.visibleGroups = this.filteredGroups.slice(
      start,
      start + this.pageSize
    );
  }
}
