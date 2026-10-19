import {
  ChangeDetectionStrategy, Component, DestroyRef, inject, signal
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule } from '@angular/material/paginator';
import { TranslateModule } from '@ngx-translate/core';
import type { ItemMatrixDiagnosticsArchiveEntryDto } from '../../../../../../../api-dto/coding/export-request.dto';
import { AppService } from '../../../core/services/app.service';
import { ExportJobService } from '../../../shared/services/file/export-job.service';
import { ItemMatrixDiagnosticsDialogComponent } from '../../../components/export-toast/item-matrix-diagnostics-dialog.component';

@Component({
  selector: 'coding-box-item-matrix-diagnostics-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, MatButtonModule, MatPaginatorModule, TranslateModule],
  template: `
    <section aria-labelledby="diagnostics-history-title">
      <h3 id="diagnostics-history-title">{{ 'ws-admin.diagnostics-history.title' | translate }}</h3>
      <p>{{ 'ws-admin.diagnostics-history.description' | translate }}</p>
      <button mat-stroked-button data-cy="load-saved-diagnostics" [disabled]="loading()" (click)="refresh()">
        {{ 'ws-admin.diagnostics-history.refresh' | translate }}
      </button>
      @if (failed()) {
        <p role="alert">{{ 'ws-admin.diagnostics-history.failed' | translate }}</p>
      }
      @if (loaded() && entries().length === 0) {
        <p>{{ 'ws-admin.diagnostics-history.empty' | translate }}</p>
      }
      <ul>
        @for (entry of entries().slice(pageIndex() * 10, (pageIndex() + 1) * 10); track entry.archiveId) {
          <li>
            <span>{{ entry.createdAt | date:'dd.MM.yyyy HH:mm:ss' }} · {{ entry.version }} · {{ entry.matrixValue }} ·
              {{ 'ws-admin.diagnostics-history.cells' | translate: { count: entry.total } }}</span>
            <button mat-button data-cy="open-saved-diagnostics" (click)="open(entry)">
              {{ 'ws-admin.diagnostics-history.open' | translate }}
            </button>
            <button mat-button data-cy="download-saved-diagnostics" (click)="download(entry)">
              {{ 'export-toast.item-matrix-diagnostics.download-full' | translate }}
            </button>
          </li>
        }
      </ul>
      @if (entries().length > 10) {
        <mat-paginator [length]="entries().length" [pageSize]="10" [pageIndex]="pageIndex()"
          (page)="pageIndex.set($event.pageIndex)" />
      }
    </section>
  `
})
export class ItemMatrixDiagnosticsHistoryComponent {
  private readonly app = inject(AppService);
  private readonly backend = inject(ExportJobService);
  private readonly dialog = inject(MatDialog);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly entries = signal<ItemMatrixDiagnosticsArchiveEntryDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly loaded = signal(false);
  protected readonly pageIndex = signal(0);
  private generation = 0;

  constructor() {
    this.app.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.generation += 1;
      this.entries.set([]);
      this.loading.set(false);
      this.loaded.set(false);
      this.failed.set(false);
      this.pageIndex.set(0);
    });
  }

  protected refresh(): void {
    const workspaceId = this.app.selectedWorkspaceId;
    if (!workspaceId) return;
    this.generation += 1;
    const generation = this.generation;
    this.loading.set(true);
    this.failed.set(false);
    this.backend.listArchivedItemMatrixDiagnostics(workspaceId)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: entries => {
          if (generation !== this.generation) return;
          this.entries.set(entries);
          this.pageIndex.set(0);
          this.loaded.set(true);
          this.loading.set(false);
        },
        error: () => {
          if (generation !== this.generation) return;
          this.failed.set(true);
          this.loading.set(false);
        }
      });
  }

  protected open(entry: ItemMatrixDiagnosticsArchiveEntryDto): void {
    const workspaceId = this.app.selectedWorkspaceId;
    const generation = this.generation;
    this.backend.getArchivedItemMatrixDiagnostics(workspaceId, entry.archiveId)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: diagnostics => {
          if (generation !== this.generation) return;
          this.dialog.open(ItemMatrixDiagnosticsDialogComponent, {
            data: {
              ...diagnostics,
              downloadFullCsv: () => {
                if (workspaceId === this.app.selectedWorkspaceId) this.download(entry);
              }
            },
            maxWidth: '95vw',
            width: '1000px'
          });
        },
        error: () => {
          if (generation === this.generation) this.failed.set(true);
        }
      });
  }

  protected download(entry: ItemMatrixDiagnosticsArchiveEntryDto): void {
    const workspaceId = this.app.selectedWorkspaceId;
    const generation = this.generation;
    this.backend.downloadArchivedItemMatrixDiagnostics(workspaceId, entry.archiveId)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: blob => {
          if (generation !== this.generation) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `Itemdatensatz-Diagnose-${entry.archiveId}.csv`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        },
        error: () => {
          if (generation === this.generation) this.failed.set(true);
        }
      });
  }
}
