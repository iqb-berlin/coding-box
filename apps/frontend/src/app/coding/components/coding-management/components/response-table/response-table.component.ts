import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  AfterViewInit,
  ChangeDetectionStrategy,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { MatSort, MatSortModule, MatSortHeader } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIcon } from '@angular/material/icon';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDivider } from '@angular/material/divider';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Success } from '../../../../models/success.model';
import { extractGeoGebraBase64 } from '../../../../utils/geogebra-value.util';
import { getResponseStatusLabel } from '../../../../../shared/utils/response-status-metadata.util';

@Component({
  selector: 'app-response-table',
  templateUrl: './response-table.component.html',
  styleUrls: ['./response-table.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
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
export class ResponseTableComponent implements AfterViewInit, OnChanges {
  @Input() data: Success[] = [];
  @Input() displayedColumns: string[] = [];
  @Input() totalRecords = 0;
  @Input() pageSize = 100;
  @Input() pageIndex = 0;
  @Input() pageSizeOptions: number[] = [100, 200, 500, 1000];
  @Input() isLoading = false;
  @Input() currentStatusFilter: string | null = null;
  @Input() selectedVersion: 'v1' | 'v2' | 'v3' = 'v1';
  @Input() isGeogebraFilterActive = false;
  @Input() isDerivedFilterActive = false;
  @Input() isReviewLoading = false;

  @Output() pageChange = new EventEmitter<PageEvent>();
  @Output() replayClick = new EventEmitter<Success>();
  @Output() showCodingScheme = new EventEmitter<number>();
  @Output() showUnitXml = new EventEmitter<number>();
  @Output() reviewClick = new EventEmitter<void>();

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  dataSource = new MatTableDataSource<Success>([]);

  constructor(private translateService: TranslateService) { }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.data) {
      this.dataSource.data = this.data;
    }
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  getColumnHeader(column: string): string {
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
    return this.translateService.instant(labels[this.selectedVersion]);
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

  onReplayClick(response: Success): void {
    this.replayClick.emit(response);
  }

  onShowCodingScheme(unitName: number): void {
    this.showCodingScheme.emit(unitName);
  }

  onShowUnitXml(unitName: number): void {
    this.showUnitXml.emit(unitName);
  }

  onReviewClick(): void {
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
    if (!this.currentStatusFilter || this.currentStatusFilter === 'null') {
      return '';
    }
    return this.mapStatusToString(this.currentStatusFilter);
  }

  private toSafeFileName(value: string): string {
    return value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'geogebra';
  }
}
