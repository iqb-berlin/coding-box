import {
  Component,
  Input,
  Output,
  EventEmitter,
  AfterViewInit,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';

export interface ValidationTableColumn {
  key: string;
  label: string;
  type?: 'text' | 'link' | 'checkbox';
  width?: string;
}

/**
 * Reusable component for displaying validation data in a table with pagination and selection
 */
@Component({
  selector: 'coding-box-validation-data-table',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatPaginatorModule,
    MatCheckboxModule,
    MatButtonModule,
    MatProgressBarModule
  ],
  template: `
    <div class="table-container" [class.table-loading]="loading">
      @if (loading) {
        <mat-progress-bar
          mode="indeterminate"
          class="loading-progress"
        ></mat-progress-bar>
      }
      <table mat-table [dataSource]="dataSource">
        @for (column of columns; track column.key) {
          <ng-container [matColumnDef]="column.key">
            <th mat-header-cell *matHeaderCellDef [style.width]="column.width">
              {{ column.label }}
            </th>
            <td mat-cell *matCellDef="let element">
              @if (column.type === 'checkbox') {
                <input
                  type="checkbox"
                  [checked]="isSelected(element)"
                  (change)="toggleSelection(element)"
                  [disabled]="!canSelect(element) || loading"
                />
              } @else if (column.type === 'link') {
                <a
                  class="table-link"
                  [class.disabled-link]="loading"
                  (click)="
                    $event.preventDefault();
                    !loading && onLinkClick(element, column.key)
                  "
                >
                  {{ getValue(element, column.key) }}
                </a>
              } @else {
                {{ getValue(element, column.key) }}
              }
            </td>
          </ng-container>
        }

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let _row; columns: displayedColumns"></tr>
      </table>

      <mat-paginator
        #paginator
        [pageSize]="pageSize"
        [pageSizeOptions]="pageSizeOptions"
        [length]="totalItems"
        [pageIndex]="currentPage - 1"
        [disabled]="loading"
        (page)="onPageChange($event)"
        aria-label="Seite auswählen"
      >
      </mat-paginator>
    </div>
  `,
  styles: [
    `
      .table-container {
        width: 100%;
        position: relative;
      }

      .table-loading {
        opacity: 0.6;
        pointer-events: none;
      }

      .loading-progress {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 10;
      }

      table {
        width: 100%;
      }

      mat-paginator {
        margin-top: 16px;
      }

      .table-link {
        cursor: pointer;
        color: #2196f3;
        text-decoration: underline;
      }

      .disabled-link {
        cursor: default;
        color: inherit;
        text-decoration: none;
        opacity: 0.5;
      }
    `
  ]
})
export class ValidationDataTableComponent<T>
implements AfterViewInit, OnChanges {
  @Input() data: T[] = [];
  @Input() columns: ValidationTableColumn[] = [];
  @Input() totalItems = 0;
  @Input() pageSize = 10;
  @Input() currentPage = 1;
  @Input() pageSizeOptions = [10, 25, 50, 100];
  @Input() selectedItems: Set<unknown> = new Set();
  @Input() selectionKey = 'id';
  @Input() loading = false;

  @Output() pageChange = new EventEmitter<PageEvent>();
  @Output() selectionChange = new EventEmitter<Set<unknown>>();
  @Output() linkClick = new EventEmitter<{ item: T; columnKey: string }>();

  dataSource = new MatTableDataSource<T>([]);

  ngAfterViewInit(): void {
    this.updateDataSource();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.data) {
      this.updateDataSource();
    }
  }

  get displayedColumns(): string[] {
    return this.columns.map(col => col.key);
  }

  getValue(item: T, key: string): unknown {
    return (item as Record<string, unknown>)[key];
  }

  isSelected(item: T): boolean {
    const itemKey = this.getValue(item, this.selectionKey);
    return this.selectedItems.has(itemKey);
  }

  canSelect(item: T): boolean {
    const itemKey = this.getValue(item, this.selectionKey);
    return itemKey !== null && itemKey !== undefined;
  }

  toggleSelection(item: T): void {
    const itemKey = this.getValue(item, this.selectionKey);
    if (itemKey === null || itemKey === undefined) {
      return;
    }

    const newSelection = new Set(this.selectedItems);
    if (newSelection.has(itemKey)) {
      newSelection.delete(itemKey);
    } else {
      newSelection.add(itemKey);
    }

    this.selectionChange.emit(newSelection);
  }

  onPageChange(event: PageEvent): void {
    this.pageChange.emit(event);
  }

  onLinkClick(item: T, columnKey: string): void {
    this.linkClick.emit({ item, columnKey });
  }

  private updateDataSource(): void {
    this.dataSource.data = this.data;
  }
}
