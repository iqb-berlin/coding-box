import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject, Observable, of, forkJoin, timer, OperatorFunction, Subscription
} from 'rxjs';
import {
  catchError, map, switchMap, takeWhile, finalize
} from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CodingExecutionService } from './coding-execution.service';
import { CodingStatisticsService } from './coding-statistics.service';
import { CodingVersionService, ResetVersionJobStatus } from './coding-version.service';
import { CodingExportService } from './coding-export.service';
import { ResponseService } from '../../shared/services/response/response.service';
import {
  SearchResponseItem, SearchResponsesParams, CodingJobStatus
} from '../../models/coding-interfaces';
import { AppService } from '../../core/services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';
import { ResponseEntity } from '../../shared/models/response-entity.model';
import { ExportFormat } from '../components/export-dialog/export-dialog.component';

export type StatisticsVersion = 'v1' | 'v2' | 'v3';

export interface FilterParams {
  unitName: string;
  codedStatus: string;
  version: StatisticsVersion;
  code: string;
  group: string;
  bookletName: string;
  variableId: string;
  geogebra: boolean;
  personLogin: string;
}

@Injectable({
  providedIn: 'root'
})
export class CodingManagementService {
  private executionService = inject(CodingExecutionService);
  private statisticsService = inject(CodingStatisticsService);
  private versionService = inject(CodingVersionService);
  private exportService = inject(CodingExportService);
  private responseService = inject(ResponseService);
  private appService = inject(AppService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);

  private _codingStatistics = new BehaviorSubject<CodingStatistics>({
    totalResponses: 0,
    statusCounts: {}
  });

  private readonly emptyStats: CodingStatistics = { totalResponses: 0, statusCounts: {} };

  codingStatistics$ = this._codingStatistics.asObservable();

  private _referenceStatistics = new BehaviorSubject<CodingStatistics | null>(null);
  referenceStatistics$ = this._referenceStatistics.asObservable();

  private _referenceVersion = new BehaviorSubject<StatisticsVersion | null>(null);
  referenceVersion$ = this._referenceVersion.asObservable();

  private _isLoadingStatistics = new BehaviorSubject<boolean>(false);
  isLoadingStatistics$ = this._isLoadingStatistics.asObservable();

  private _resetProgress = new BehaviorSubject<number | null>(null);
  resetProgress$ = this._resetProgress.asObservable();

  private _resetJobId = new BehaviorSubject<string | null>(null);
  resetJobId$ = this._resetJobId.asObservable();

  private resetPollingSubscription: Subscription | null = null;

  fetchCodingStatistics(version: StatisticsVersion): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this._isLoadingStatistics.next(true);
    // Reset reference stats
    this._referenceStatistics.next(null);
    this._referenceVersion.next(null);

    this.executionService.createCodingStatisticsJob(workspaceId, version)
      .pipe(
        catchError(() => of({
          jobId: '' as string,
          message: this.translateService.instant('coding-management.loading.creating-coding-statistics')
        }))
      )
      .subscribe(({ jobId }) => {
        if (!jobId) {
          this.handleNoJobIdStatistics(workspaceId, version);
        } else {
          this.pollStatisticsJob(workspaceId, jobId, version);
        }
      });
  }

  private handleNoJobIdStatistics(workspaceId: number, version: StatisticsVersion): void {
    if (version === 'v2') {
      // v2 compares to v1
      forkJoin({
        current: this.statisticsService.getCodingStatistics(workspaceId, 'v2'),
        reference: this.statisticsService.getCodingStatistics(workspaceId, 'v1')
      }).pipe(
        this.handleStatisticsError({ current: this.emptyStats, reference: this.emptyStats }),
        finalize(() => this._isLoadingStatistics.next(false))
      ).subscribe((result: { current: CodingStatistics; reference: CodingStatistics }) => {
        const { current, reference } = result;
        this._codingStatistics.next(current);
        this._referenceStatistics.next(reference);
        this._referenceVersion.next('v1');
      });
    } else if (version === 'v3') {
      // v3 compares to v2 if v2 has data, otherwise to v1
      forkJoin({
        current: this.statisticsService.getCodingStatistics(workspaceId, 'v3'),
        v2Stats: this.statisticsService.getCodingStatistics(workspaceId, 'v2'),
        v1Stats: this.statisticsService.getCodingStatistics(workspaceId, 'v1')
      }).pipe(
        this.handleStatisticsError({
          current: this.emptyStats,
          v2Stats: this.emptyStats,
          v1Stats: this.emptyStats
        }),
        finalize(() => this._isLoadingStatistics.next(false))
      ).subscribe((result: { current: CodingStatistics; v2Stats: CodingStatistics; v1Stats: CodingStatistics }) => {
        const { current, v2Stats, v1Stats } = result;
        this._codingStatistics.next(current);
        if (this.statisticsDiffer(v2Stats, v1Stats)) {
          this._referenceStatistics.next(v2Stats);
          this._referenceVersion.next('v2');
        } else {
          this._referenceStatistics.next(v1Stats);
          this._referenceVersion.next('v1');
        }
      });
    } else {
      this.statisticsService.getCodingStatistics(workspaceId, version)
        .pipe(
          catchError(() => {
            this.showErrorSnackbar('coding-management.descriptions.error-statistics');
            return of({ totalResponses: 0, statusCounts: {} });
          }),
          finalize(() => this._isLoadingStatistics.next(false))
        )
        .subscribe(statistics => {
          this._codingStatistics.next(statistics);
        });
    }
  }

  private pollStatisticsJob(workspaceId: number, jobId: string, version: StatisticsVersion): void {
    timer(0, 2000).pipe(
      switchMap(() => this.executionService.getCodingJobStatus(workspaceId, jobId)),
      takeWhile(status => ['pending', 'processing'].includes(status.status), true),
      finalize(() => this._isLoadingStatistics.next(false))
    ).subscribe((status: CodingJobStatus) => {
      if (status.status === 'completed' && status.result) {
        this._codingStatistics.next(status.result);
        this.fetchReferenceStatisticsAfterJob(workspaceId, version);
      } else if (['failed', 'cancelled', 'paused'].includes(status.status)) {
        this.snackBar.open(`Statistik-Job ${status.status}`, 'Schließen', { duration: 5000, panelClass: ['error-snackbar'] });
      }
    });
  }

  private fetchReferenceStatisticsAfterJob(workspaceId: number, version: StatisticsVersion): void {
    if (version === 'v2') {
      this.statisticsService.getCodingStatistics(workspaceId, 'v1')
        .pipe(catchError(() => of({ totalResponses: 0, statusCounts: {} })))
        .subscribe(ref => {
          this._referenceStatistics.next(ref);
          this._referenceVersion.next('v1');
        });
    } else if (version === 'v3') {
      forkJoin({
        v2Stats: this.statisticsService.getCodingStatistics(workspaceId, 'v2'),
        v1Stats: this.statisticsService.getCodingStatistics(workspaceId, 'v1')
      }).pipe(
        catchError(() => of({
          v2Stats: { totalResponses: 0, statusCounts: {} },
          v1Stats: { totalResponses: 0, statusCounts: {} }
        }))
      ).subscribe((result: { v2Stats: CodingStatistics; v1Stats: CodingStatistics }) => {
        const { v2Stats, v1Stats } = result;
        if (this.statisticsDiffer(v2Stats, v1Stats)) {
          this._referenceStatistics.next(v2Stats);
          this._referenceVersion.next('v2');
        } else {
          this._referenceStatistics.next(v1Stats);
          this._referenceVersion.next('v1');
        }
      });
    }
  }

  fetchResponsesByStatus(
    status: string,
    version: StatisticsVersion,
    page: number,
    limit: number
  ): Observable<{ data: ResponseEntity[], total: number }> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return of({ data: [], total: 0 });

    return this.statisticsService.getResponsesByStatus(workspaceId, status, version, page, limit)
      .pipe(
        catchError(() => {
          this.snackBar.open(`Fehler beim Abrufen der Antworten mit Status ${status}`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of({
            data: [], total: 0, page, limit
          });
        }),
        map(response => ({
          data: response.data,
          total: response.total
        }))
      );
  }

  searchResponses(
    filterParams: FilterParams,
    page: number,
    limit: number
  ): Observable<{ data: SearchResponseItem[], total: number }> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return of({ data: [], total: 0 });

    const backendParams: SearchResponsesParams = {
      unitName: filterParams.unitName,
      codedStatus: filterParams.codedStatus,
      version: filterParams.version,
      code: filterParams.code,
      group: filterParams.group,
      bookletName: filterParams.bookletName,
      variableId: filterParams.variableId,
      geogebra: filterParams.geogebra,
      personLogin: filterParams.personLogin
    };

    return this.responseService.searchResponses(workspaceId, backendParams, page, limit)
      .pipe(
        catchError(() => {
          this.showErrorSnackbar('Fehler beim Filtern der Kodierdaten', false);
          return of({ data: [], total: 0 });
        })
      );
  }

  hasGeogebraResponses(): Observable<boolean> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return of(false);
    return this.responseService.hasGeogebraResponses(workspaceId);
  }

  checkActiveResetJob(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.versionService.getActiveResetVersionJob(workspaceId).subscribe(activeJob => {
      if (activeJob.hasActiveJob && activeJob.jobId) {
        this._resetJobId.next(activeJob.jobId);
        this._resetProgress.next(activeJob.progress ?? 0);
        this.startResetPolling(workspaceId, activeJob.jobId);
      }
    });
  }

  resetCodingVersion(version: StatisticsVersion): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.versionService.resetCodingVersion(workspaceId, version).subscribe({
      next: ({ jobId }) => {
        this._resetJobId.next(jobId);
        this._resetProgress.next(0);
        this.startResetPolling(workspaceId, jobId);
      },
      error: err => {
        if (err.status === 409) {
          this.showErrorSnackbar(err.error?.message || 'coding-management.descriptions.error-reset-conflict', false);
        } else {
          this.showErrorSnackbar('coding-management.descriptions.error-reset');
        }
      }
    });
  }

  private startResetPolling(workspaceId: number, jobId: string): void {
    this.stopResetPolling();

    this.resetPollingSubscription = timer(0, 2000).pipe(
      switchMap(() => this.versionService.getResetVersionJobStatus(workspaceId, jobId)),
      takeWhile(
        (status: ResetVersionJobStatus) => ['pending', 'processing'].includes(status.status),
        true
      )
    ).subscribe((status: ResetVersionJobStatus) => {
      this._resetProgress.next(status.progress);

      if (status.status === 'completed') {
        this._resetProgress.next(null);
        this._resetJobId.next(null);

        if (status.result) {
          let cascadeText = '';
          if (status.result.cascadeResetVersions?.length > 0) {
            cascadeText = ` (+ ${status.result.cascadeResetVersions.join(', ')})`;
          }
          this.snackBar.open(
            `${status.result.affectedResponseCount} Antworten zurückgesetzt${cascadeText}`,
            'Schließen',
            { duration: 5000, panelClass: ['success-snackbar'] }
          );
        }
      } else if (status.status === 'failed') {
        this._resetProgress.next(null);
        this._resetJobId.next(null);
        this.showErrorSnackbar('coding-management.descriptions.error-reset');
      }
    });
  }

  private stopResetPolling(): void {
    if (this.resetPollingSubscription) {
      this.resetPollingSubscription.unsubscribe();
      this.resetPollingSubscription = null;
    }
  }

  // --- Download Helpers ---

  downloadCodingList(format: ExportFormat): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.performBackgroundCodingListDownload(workspaceId, format);
  }

  downloadCodingResults(version: StatisticsVersion, format: ExportFormat, includeReplayUrls: boolean): Promise<void> {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return Promise.resolve();

    return this.performBackgroundDownload(workspaceId, version, format, includeReplayUrls);
  }

  downloadProgress$ = new BehaviorSubject<number | null>(null);

  private async performBackgroundDownload(
    workspaceId: number,
    version: StatisticsVersion,
    format: ExportFormat,
    includeReplayUrls: boolean
  ): Promise<void> {
    this.downloadProgress$.next(0);

    try {
      // Start the job
      const jobStartResult = await this.exportService.startExportJob(
        workspaceId,
        'results-by-version',
        version,
        format,
        includeReplayUrls
      ).toPromise();

      if (!jobStartResult) {
        this.showErrorSnackbar('Failed to start export job', false);
        this.downloadProgress$.next(null);
        return;
      }
      const { jobId } = jobStartResult;

      // Poll for status
      const blob = await this.pollJobAndProgress(workspaceId, jobId, this.downloadProgress$);

      // Handle file download
      if (format === 'json') {
        const jsonBlob = await this.convertCsvBlobToJsonBlob(blob);
        this.saveBlob(jsonBlob, `coding-results-${version}-${this.getDateString()}.json`);
      } else {
        const ext = format === 'csv' ? 'csv' : 'xlsx';
        this.saveBlob(blob, `coding-results-${version}-${this.getDateString()}.${ext}`);
      }
      this.showSuccessSnackbar(this.translateService.instant('coding-management.download-dialog.download-complete'));
    } catch (error) {
      this.showErrorSnackbar(
        this.translateService.instant('coding-management.download-dialog.download-failed', { error: (error as Error).message || error }),
        false
      );
    } finally {
      this.downloadProgress$.next(null);
    }
  }

  codingListDownloadProgress$ = new BehaviorSubject<number | null>(null);

  private async performBackgroundCodingListDownload(
    workspaceId: number,
    format: ExportFormat
  ): Promise<void> {
    this.codingListDownloadProgress$.next(0);

    try {
      this.showInfoSnackbar(this.translateService.instant('coding-management.descriptions.job-started', { defaultValue: 'Export-Job gestartet...' }));

      const jobStartResult = await this.exportService.startExportJob(
        workspaceId,
        'coding-list',
        undefined,
        format
      ).toPromise();

      if (!jobStartResult) {
        this.showErrorSnackbar('Failed to start export job', false);
        this.codingListDownloadProgress$.next(null);
        return;
      }
      const { jobId } = jobStartResult;

      const blob = await this.pollJobAndProgress(workspaceId, jobId, this.codingListDownloadProgress$);

      const ext = format === 'excel' ? 'xlsx' : format;
      this.saveBlob(blob, `coding-list-${this.getDateString()}.${ext}`);

      this.showSuccessSnackbar(this.translateService.instant('coding-management.download-dialog.download-complete'));
    } catch (error) {
      this.showErrorSnackbar(
        this.translateService.instant('coding-management.download-dialog.download-failed', { error: (error as Error).message || error }),
        false
      );
    } finally {
      this.codingListDownloadProgress$.next(null);
    }
  }

  private pollJobAndProgress(
    workspaceId: number,
    jobId: string,
    progressSubject: BehaviorSubject<number | null>
  ): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      const subscription = timer(0, 2000).pipe(
        switchMap(() => this.exportService.getExportJobStatus(workspaceId, jobId)),
        takeWhile(status => ['pending', 'processing'].includes(status.status), true)
      ).subscribe({
        next: status => {
          if (status.status === 'completed') {
            subscription.unsubscribe();
            progressSubject.next(100);
            this.exportService.downloadExportFile(workspaceId, jobId).subscribe({
              next: fileBlob => resolve(fileBlob),
              error: reject
            });
          } else if (status.status === 'failed' || status.status === 'cancelled') {
            subscription.unsubscribe();
            const errorMsg = status.error || 'Job failed';
            reject(new Error(errorMsg));
          } else {
            const progress = Math.round(status.progress || 0);
            progressSubject.next(progress);
          }
        },
        error: err => {
          subscription.unsubscribe();
          reject(err);
        }
      });
    });
  }

  // --- Private Helpers ---

  private statisticsDiffer(stats1: CodingStatistics, stats2: CodingStatistics): boolean {
    if (stats1.totalResponses !== stats2.totalResponses) return true;
    const allStatuses = new Set([...Object.keys(stats1.statusCounts), ...Object.keys(stats2.statusCounts)]);
    for (const status of allStatuses) {
      if ((stats1.statusCounts[status] || 0) !== (stats2.statusCounts[status] || 0)) return true;
    }
    return false;
  }

  private handleStatisticsError<T>(fallback: T): OperatorFunction<T, T> {
    return catchError(() => {
      this.showErrorSnackbar('coding-management.descriptions.error-statistics');
      return of(fallback);
    });
  }

  private showSuccessSnackbar(msg: string): void {
    this.snackBar.open(msg, 'Schließen', { duration: 5000, panelClass: ['success-snackbar'] });
  }

  private showErrorSnackbar(msgKey: string, translate = true): void {
    const msg = translate ? this.translateService.instant(msgKey) : msgKey;
    this.snackBar.open(msg, this.translateService.instant('close'), { duration: 5000, panelClass: ['error-snackbar'] });
  }

  private showInfoSnackbar(msg: string): void {
    this.snackBar.open(msg, 'Schließen', { duration: 3000 });
  }

  private getDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private saveBlob(blob: Blob | null, filename: string, errorMsg?: string): void {
    if (!blob || !(blob instanceof Blob)) {
      if (errorMsg) this.showErrorSnackbar(errorMsg, false);
      return;
    }
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  private async convertCsvBlobToJsonBlob(blob: Blob): Promise<Blob> {
    const text = await blob.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) throw new Error('No entries');

    const headerLine = lines[0].replace(/^\uFEFF/, '');
    const delimiter = headerLine.includes(';') ? ';' : ',';
    const splitRegex = delimiter === ';' ? /;(?=(?:[^"]*"[^"]*")*[^"]*$)/ : /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;

    const headers = headerLine.split(splitRegex).map(h => h.replace(/^"|"$/g, ''));
    const data = lines.slice(1).map(line => {
      const cleanLine = line.replace(/^\uFEFF/, '');
      const values = cleanLine.split(splitRegex).map(v => v.replace(/^"|"$/g, ''));
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
      return obj;
    });

    const jsonData = JSON.stringify(data, null, 2);
    return new Blob([jsonData], { type: 'application/json' });
  }
}
