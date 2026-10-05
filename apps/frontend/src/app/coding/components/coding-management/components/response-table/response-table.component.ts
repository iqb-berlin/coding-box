import {
  Component, ChangeDetectionStrategy, OnChanges, SimpleChanges, input, output, inject
} from '@angular/core';

import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import {
  MatSortModule,
  MatSortHeader,
  Sort,
  SortDirection
} from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDivider } from '@angular/material/divider';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { activateOnKeyboard } from '../../../../../shared/utils/keyboard-activation.util';
import { Success } from '../../../../models/success.model';
import { extractGeoGebraBase64 } from '../../../../utils/geogebra-value.util';
import { getResponseStatusLabel } from '../../../../../shared/utils/response-status-metadata.util';
import { CodingResponseSortBy } from '../../../../../models/coding-interfaces';

@Component({
  selector: 'coding-box-response-table',
  templateUrl: './response-table.component.html',
  styleUrls: ['./response-table.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatRowDef,
    MatHeaderRowDef,
    MatCellDef,
    MatHeaderCellDef,
    MatSortModule,
    MatSortHeader,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatIcon,
    MatButton,
    MatIconButton,
    MatTooltipModule,
    MatDivider,
    TranslateModule
  ]
})
export class ResponseTableComponent implements OnChanges {
  private translateService = inject(TranslateService);

  protected readonly onActionKeydown = activateOnKeyboard;

  readonly data = input<Success[]>([]);
  readonly displayedColumns = input<string[]>([]);
  readonly totalRecords = input(0);
  readonly pageSize = input(100);
  readonly pageIndex = input(0);
  readonly pageSizeOptions = input<number[]>([100, 200, 500, 1000]);
  readonly isLoading = input(false);
  readonly currentStatusFilter = input<string | null>(null);
  readonly selectedVersion = input<'v1' | 'v2' | 'v3'>('v1');
  readonly isGeogebraFilterActive = input(false);
  readonly isDerivedFilterActive = input(false);
  readonly isReviewLoading = input(false);
  readonly sortBy = input<CodingResponseSortBy | ''>('');
  readonly sortDirection = input<SortDirection>('');

  readonly pageChange = output<PageEvent>();
  readonly replayClick = output<Success>();
  readonly showCodingScheme = output<number>();
  readonly showUnitXml = output<number>();
  readonly reviewClick = output<void>();
  readonly sortChange = output<Sort>();

  dataSource = new MatTableDataSource<Success>([]);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.data) {
      this.dataSource.data = this.data();
    }
  }

  protected getColumnHeader(column: string): string {
    const headers: Record<string, string> = {
      unitname: 'coding-management.columns.unitname',
      variableid: 'coding-management.columns.variableid',
      value: 'coding-management.columns.value',
      codedstatus: 'coding-management.columns.codedstatus',
      code: 'coding-management.columns.code',
      score: 'coding-management.columns.score',
      person_code: 'coding-management.columns.person-code',
      person_login: 'coding-management.columns.person-login',
      person_group: 'coding-management.columns.person-group',
      booklet_id: 'coding-management.columns.booklet-id',
      actions: 'coding-management.columns.actions'
    };
    return this.translateService.instant(headers[column] || column);
  }

  getSelectedVersionLabel(): string {
    const labels: Record<'v1' | 'v2' | 'v3', string> = {
      v1: 'coding-management.statistics.first-autocode-run',
      v2: 'coding-management.statistics.manual-coding-run',
      v3: 'coding-management.statistics.second-autocode-run'
    };
    return this.translateService.instant(labels[this.selectedVersion()]);
  }

  getStatusString(status: string): string {
    if (!status) return '';
    return this.mapStatusToString(status);
  }

  mapStatusToString(status: string | number): string {
    return getResponseStatusLabel(status) || 'UNKNOWN';
  }

  onPageChange(event: PageEvent): void {
    this.pageChange.emit(event);
  }

  onSortChange(sort: Sort): void {
    this.sortChange.emit(sort);
  }

  onReplayClick(response: Success): void {
    this.replayClick.emit(response);
  }

  onShowCodingScheme(unitName: number): void {
    this.showCodingScheme.emit(unitName);
  }

  onShowUnitXml(unitName: number): void {
    this.showUnitXml.emit(unitName);
  }

  protected onReviewClick(): void {
    this.reviewClick.emit();
  }

  isGeoGebraValue(value: unknown): boolean {
    return !!extractGeoGebraBase64(value);
  }

  downloadGeoGebraValue(response: Success): void {
    const base64 = response.geoGebraBase64 || extractGeoGebraBase64(response.value);
    if (!base64) {
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    } catch {
      return;
    }

    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/vnd.geogebra.file' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.toSafeFileName(response.unitname || 'geogebra')}-${this.toSafeFileName(response.variableid || 'response')}.ggb`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  getFilterStatusLabel(): string {
    const currentStatusFilter = this.currentStatusFilter();
    if (!currentStatusFilter || currentStatusFilter === 'null') {
      return '';
    }
    return this.mapStatusToString(currentStatusFilter);
  }

  private toSafeFileName(value: string): string {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'geogebra';
  }
}
