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
import { responseStatesNumericMap } from '@iqbspecs/response/response.interface';
import { Success } from '../../../../models/success.model';

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

  @Output() pageChange = new EventEmitter<PageEvent>();
  @Output() replayClick = new EventEmitter<Success>();
  @Output() showCodingScheme = new EventEmitter<number>();
  @Output() showUnitXml = new EventEmitter<number>();
  @Output() reviewClick = new EventEmitter<void>();

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  dataSource = new MatTableDataSource<Success>([]);

  private responseStatusMap = new Map(
    responseStatesNumericMap.map(entry => [entry.key, entry.value])
  );

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

  getStatusString(status: string): string {
    if (!status) return '';
    const num = parseInt(status, 10);
    return Number.isNaN(num) ? status : this.mapStatusToString(num);
  }

  mapStatusToString(status: number): string {
    return this.responseStatusMap.get(status) || 'UNKNOWN';
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

  getFilterStatusLabel(): string {
    if (!this.currentStatusFilter || this.currentStatusFilter === 'null') {
      return '';
    }
    const num = parseInt(this.currentStatusFilter, 10);
    return Number.isNaN(num) ? this.currentStatusFilter : this.mapStatusToString(num);
  }
}
