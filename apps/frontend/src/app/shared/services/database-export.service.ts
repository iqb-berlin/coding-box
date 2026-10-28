import { DOCUMENT } from '@angular/common';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {
  DestroyRef, Injectable, inject, signal
} from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
  EMPTY, Subscription, concatMap, exhaustMap, finalize, takeWhile, tap, timer
} from 'rxjs';
import { SERVER_URL } from '../../injection-tokens';
import { AppService } from '../../core/services/app.service';
import { takeUntilWorkspaceChanged } from '../utils/workspace-request.operator';
import { extractHttpErrorMessage } from '../utils/http-error-message.util';

type DatabaseExportScope = { kind: 'system' } | { kind: 'workspace'; workspaceId: number };
type DatabaseExportStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
type ExportPhase = 'start' | 'status' | 'download';
interface DatabaseExportJobState {
  status: DatabaseExportStatus;
  progress: number;
  error?: string;
}

const messages = {
  system: {
    start: 'database-export.system.start-error',
    status: 'database-export.status-error',
    download: 'database-export.download-error',
    failed: 'database-export.system.failed',
    success: 'database-export.system.success'
  },
  workspace: {
    start: 'ws-settings.error-starting-workspace-database-export',
    status: 'ws-settings.error-fetching-workspace-database-export-status',
    download: 'ws-settings.error-downloading-workspace-database-export',
    failed: 'ws-settings.error-exporting-workspace-database-retry',
    success: 'ws-settings.workspace-database-exported-successfully'
  }
};

/** Provide per settings view: each instance owns one export, its polling and download. */
@Injectable()
export class DatabaseExportService {
  private readonly http = inject(HttpClient);
  private readonly serverUrl = inject(SERVER_URL).replace(/\/$/, '');
  private readonly document = inject(DOCUMENT);
  private readonly app = inject(AppService);
  private readonly translate = inject(TranslateService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly exporting = signal(false);
  private readonly progressState = signal(0);
  private readonly statusState = signal<DatabaseExportStatus | null>(null);
  private readonly errorState = signal<string | null>(null);
  private request?: Subscription;

  readonly isExporting = this.exporting.asReadonly();
  readonly progress = this.progressState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  start(scope: DatabaseExportScope): void {
    if (this.isExporting()) return;

    const workspaceId = scope.kind === 'workspace' ? scope.workspaceId : undefined;
    const baseUrl = scope.kind === 'system' ?
      `${this.serverUrl}/admin/database/export/sqlite` :
      `${this.serverUrl}/admin/workspace/${workspaceId}/export/sqlite`;
    const headers = new HttpHeaders({ Accept: 'application/json' });
    const text = messages[scope.kind];
    let phase: ExportPhase = 'start';
    this.exporting.set(true);
    this.progressState.set(0);
    this.statusState.set('queued');
    this.errorState.set(null);

    const export$ = this.http.post<{ jobId: string }>(`${baseUrl}/job`, {}, { headers }).pipe(
      concatMap(({ jobId }) => {
        phase = 'status';
        return timer(0, 2000).pipe(
          // A slow status request must finish instead of being cancelled at every tick.
          exhaustMap(() => this.http.get<DatabaseExportJobState>(`${baseUrl}/job/${jobId}`, { headers })),
          takeWhile(state => state.status === 'queued' || state.status === 'running', true),
          concatMap(state => {
            this.statusState.set(state.status);
            this.progressState.set(Math.max(0, Math.min(100, Math.round(state.progress || 0))));
            if (state.status === 'failed' || state.status === 'cancelled') {
              this.reportError(state.error || this.translate.instant(text.failed));
            }
            if (state.status !== 'completed') return EMPTY;

            phase = 'download';
            this.progressState.set(100);
            return this.http.get(`${baseUrl}/job/${jobId}/download`, { headers, responseType: 'blob' }).pipe(
              tap(blob => {
                const prefix = workspaceId === undefined ? 'database-export' : `workspace-${workspaceId}-export`;
                this.saveBlob(blob, `${prefix}-${new Date().toISOString().slice(0, 10)}.sqlite`);
                this.snackBar.open(this.translate.instant(text.success), this.translate.instant('close'), { duration: 3000 });
              })
            );
          })
        );
      })
    );

    this.request = (workspaceId === undefined ? export$ :
      export$.pipe(takeUntilWorkspaceChanged(this.app, workspaceId))).pipe(
      finalize(() => {
        this.exporting.set(false);
        if (workspaceId !== undefined && this.app.selectedWorkspaceId !== workspaceId) this.reset();
      })
    ).subscribe({
      error: error => {
        this.statusState.set('failed');
        this.reportError(extractHttpErrorMessage(error, this.translate.instant(text[phase])));
      }
    });
  }

  cancel(): void {
    this.request?.unsubscribe();
    this.request = undefined;
    this.reset();
  }

  getStatusLabel(): string {
    return this.translate.instant(`ws-settings.export-status-${this.status() || 'unknown'}`);
  }

  private reset(): void {
    this.exporting.set(false);
    this.progressState.set(0);
    this.statusState.set(null);
    this.errorState.set(null);
  }

  private reportError(message: string): void {
    this.errorState.set(message);
    this.snackBar.open(message, this.translate.instant('close'), { duration: 5000 });
  }

  private saveBlob(blob: Blob, filename: string): void {
    const browserUrl = this.document.defaultView!.URL;
    const url = browserUrl.createObjectURL(blob);
    const anchor = this.document.createElement('a');
    anchor.style.display = 'none';
    anchor.href = url;
    anchor.download = filename;
    this.document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      browserUrl.revokeObjectURL(url);
      this.document.body.removeChild(anchor);
    }
  }
}
