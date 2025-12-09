import {
  Component, ViewChild, AfterViewInit, OnInit, OnDestroy, inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  catchError,
  finalize,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  takeUntil,
  takeWhile
} from 'rxjs/operators';
import {
  of, Subject, timer, forkJoin
} from 'rxjs';
import {
  MatCell, MatCellDef,
  MatColumnDef,
  MatHeaderCell, MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef, MatRow, MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatSort, MatSortModule, MatSortHeader } from '@angular/material/sort';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import {
  MatAnchor, MatButton, MatFabButton, MatIconButton
} from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatDivider } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { responseStatesNumericMap } from '@iqbspecs/response/response.interface';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';
import { CodingVariablesDialogComponent } from '../../../coding-management/coding-variables-dialog/coding-variables-dialog.component';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import { CodingStatistics } from '../../../../../../../api-dto/coding/coding-statistics';
import { ExportDialogComponent, ExportFormat } from '../export-dialog/export-dialog.component';
import { Success } from '../../models/success.model';
import { ResponseEntity } from '../../../shared/models/response-entity.model';
import { TestPersonCodingDialogComponent } from '../test-person-coding-dialog/test-person-coding-dialog.component';
import { ExportCodingBookComponent } from '../export-coding-book/export-coding-book.component';
import { CodingManagementManualComponent } from '../coding-management-manual/coding-management-manual.component';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { ResetVersionDialogComponent } from './reset-version-dialog/reset-version-dialog.component';
import { DownloadCodingResultsDialogComponent } from './download-coding-results-dialog/download-coding-results-dialog.component';

@Component({
  selector: 'app-coding-management',
  templateUrl: './coding-management.component.html',
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
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
    MatProgressBarModule,
    ScrollingModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatIcon,
    MatAnchor,
    MatIconButton,
    MatFabButton,
    MatTooltipModule,
    MatDivider,
    MatButton,
    MatSelectModule,
    CodingManagementManualComponent,
    FormsModule,
    TranslateModule
  ],
  styleUrls: ['./coding-management.component.scss']
})
export class CodingManagementComponent implements AfterViewInit, OnInit, OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  private responseStatusMap = new Map(responseStatesNumericMap.map(entry => [entry.key, entry.value]));

  mapStatusToString(status: number): string {
    return this.responseStatusMap.get(status) || 'UNKNOWN';
  }

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  data: Success[] = [];
  dataSource = new MatTableDataSource<Success>(this.data);
  displayedColumns: string[] = ['unitname', 'variableid', 'value', 'codedstatus', 'code', 'score', 'person_code', 'person_login', 'person_group', 'booklet_id', 'actions'];
  isLoading = false;
  isFilterLoading = false;
  isLoadingStatistics = false;
  isAutoCoding = false;
  isDownloadInProgress = false;
  showManualCoding = false;

  statisticsLoaded = false;
  currentStatusFilter: string | null = null;
  pageSizeOptions = [100, 200, 500, 1000];
  pageSize = 1000;
  totalRecords = 0;
  pageIndex = 0;
  filterTextChanged = new Subject<Event>();
  private destroy$ = new Subject<void>();
  codingStatistics: CodingStatistics = {
    totalResponses: 0,
    statusCounts: {}
  };

  referenceStatistics: CodingStatistics | null = null;
  referenceVersion: 'v1' | 'v2' | null = null;

  selectedStatisticsVersion: 'v1' | 'v2' | 'v3' = 'v1';

  codingRunOptions = [
    { value: 'v1', label: 'coding-management.statistics.first-autocode-run' },
    { value: 'v2', label: 'coding-management.statistics.manual-coding-run' },
    { value: 'v3', label: 'coding-management.statistics.second-autocode-run' }
  ] as const;

  filterParams = {
    unitName: '',
    codedStatus: '',
    version: 'v1' as 'v1' | 'v2' | 'v3',
    code: '',
    group: '',
    bookletName: '',
    variableId: ''
  };

  private filterTimer?: NodeJS.Timeout;

  constructor(private translateService: TranslateService) {
    this.isAutoCoding = false;
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

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.workspaceSettingsService.getAutoFetchCodingStatistics(workspaceId)
        .subscribe(autoFetch => {
          if (autoFetch) {
            this.fetchCodingStatistics();
          }
        });
    }

    this.filterTextChanged
      .pipe(
        debounceTime(300),
        distinctUntilChanged((prev, curr) => (prev.target as HTMLInputElement).value === (curr.target as HTMLInputElement).value)
      )
      .subscribe(event => {
        const filterValue = (event.target as HTMLInputElement).value;
        if (filterValue.trim()) {
          this.isFilterLoading = true;
        }
        this.applyFilter(event);
      });
  }

  fetchCodingStatistics(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoadingStatistics = true;
    this.referenceStatistics = null;
    this.referenceVersion = null;

    this.backendService.createCodingStatisticsJob(workspaceId)
      .pipe(
        catchError(() => of({ jobId: '' as string, message: this.translateService.instant('coding-management.loading.creating-coding-statistics') }))
      )
      .subscribe(({ jobId }) => {
        if (!jobId) {
          if (this.selectedStatisticsVersion === 'v2') {
            // v2 compares to v1
            forkJoin({
              current: this.backendService.getCodingStatistics(workspaceId, 'v2'),
              reference: this.backendService.getCodingStatistics(workspaceId, 'v1')
            })
              .pipe(
                catchError(() => {
                  this.snackBar.open(this.translateService.instant('coding-management.descriptions.error-statistics'), this.translateService.instant('close'), {
                    duration: 5000,
                    panelClass: ['error-snackbar']
                  });
                  return of({
                    current: { totalResponses: 0, statusCounts: {} },
                    reference: { totalResponses: 0, statusCounts: {} }
                  });
                }),
                finalize(() => {
                  this.isLoadingStatistics = false;
                })
              )
              .subscribe(({ current, reference }) => {
                this.codingStatistics = current;
                this.referenceStatistics = reference;
                this.referenceVersion = 'v1';
                this.statisticsLoaded = true;
              });
          } else if (this.selectedStatisticsVersion === 'v3') {
            // v3 compares to v2 if v2 has data, otherwise to v1
            forkJoin({
              current: this.backendService.getCodingStatistics(workspaceId, 'v3'),
              v2Stats: this.backendService.getCodingStatistics(workspaceId, 'v2'),
              v1Stats: this.backendService.getCodingStatistics(workspaceId, 'v1')
            })
              .pipe(
                catchError(() => {
                  this.snackBar.open(this.translateService.instant('coding-management.descriptions.error-statistics'), this.translateService.instant('close'), {
                    duration: 5000,
                    panelClass: ['error-snackbar']
                  });
                  return of({
                    current: { totalResponses: 0, statusCounts: {} },
                    v2Stats: { totalResponses: 0, statusCounts: {} },
                    v1Stats: { totalResponses: 0, statusCounts: {} }
                  });
                }),
                finalize(() => {
                  this.isLoadingStatistics = false;
                })
              )
              .subscribe(({ current, v2Stats, v1Stats }) => {
                this.codingStatistics = current;
                // Use v2 as reference if v2 differs from v1 (manual coding was done), otherwise use v1
                if (this.statisticsDiffer(v2Stats, v1Stats)) {
                  this.referenceStatistics = v2Stats;
                  this.referenceVersion = 'v2';
                } else {
                  this.referenceStatistics = v1Stats;
                  this.referenceVersion = 'v1';
                }
                this.statisticsLoaded = true;
              });
          } else {
            this.backendService.getCodingStatistics(workspaceId, this.selectedStatisticsVersion)
              .pipe(
                catchError(() => {
                  this.snackBar.open(this.translateService.instant('coding-management.descriptions.error-statistics'), this.translateService.instant('close'), {
                    duration: 5000,
                    panelClass: ['error-snackbar']
                  });
                  return of({
                    totalResponses: 0,
                    statusCounts: {}
                  });
                }),
                finalize(() => {
                  this.isLoadingStatistics = false;
                })
              )
              .subscribe(statistics => {
                this.codingStatistics = statistics;
                this.statisticsLoaded = true;
              });
          }
          return;
        }

        timer(0, 2000)
          .pipe(
            takeUntil(this.destroy$),
            switchMap(() => this.backendService.getCodingJobStatus(workspaceId, jobId)),
            takeWhile(status => ['pending', 'processing'].includes(status.status), true),
            finalize(() => {
              this.isLoadingStatistics = false;
            })
          )
          .subscribe(status => {
            if (status.status === 'completed' && status.result) {
              this.codingStatistics = status.result;
              this.statisticsLoaded = true;
              // Fetch reference statistics
              if (this.selectedStatisticsVersion === 'v2') {
                this.backendService.getCodingStatistics(workspaceId, 'v1')
                  .pipe(catchError(() => of({ totalResponses: 0, statusCounts: {} })))
                  .subscribe(ref => {
                    this.referenceStatistics = ref;
                    this.referenceVersion = 'v1';
                  });
              } else if (this.selectedStatisticsVersion === 'v3') {
                // For v3, check if v2 has data, otherwise use v1
                forkJoin({
                  v2Stats: this.backendService.getCodingStatistics(workspaceId, 'v2'),
                  v1Stats: this.backendService.getCodingStatistics(workspaceId, 'v1')
                })
                  .pipe(catchError(() => of({ v2Stats: { totalResponses: 0, statusCounts: {} }, v1Stats: { totalResponses: 0, statusCounts: {} } })))
                  .subscribe(({ v2Stats, v1Stats }) => {
                    // Use v2 as reference if v2 differs from v1 (manual coding was done), otherwise use v1
                    if (this.statisticsDiffer(v2Stats, v1Stats)) {
                      this.referenceStatistics = v2Stats;
                      this.referenceVersion = 'v2';
                    } else {
                      this.referenceStatistics = v1Stats;
                      this.referenceVersion = 'v1';
                    }
                  });
              }
            } else if (['failed', 'cancelled', 'paused'].includes(status.status)) {
              this.snackBar.open(`Statistik-Job ${status.status}`, 'Schließen', { duration: 5000, panelClass: ['error-snackbar'] });
            }
          });
      });
  }

  onStatisticsVersionChange(): void {
    this.data = [];
    this.dataSource.data = [];
    this.currentStatusFilter = null;
    this.totalRecords = 0;
    this.referenceStatistics = null;
    this.referenceVersion = null;

    if (this.statisticsLoaded) {
      this.fetchCodingStatistics();
    }
  }

  getStatuses(): string[] {
    const currentStatuses = Object.keys(this.codingStatistics.statusCounts);
    if (this.referenceStatistics) {
      const referenceStatuses = Object.keys(this.referenceStatistics.statusCounts);
      const allStatuses = new Set([...currentStatuses, ...referenceStatuses]);
      return Array.from(allStatuses);
    }
    return currentStatuses;
  }

  getStatusDifference(status: string): number | null {
    if (!this.referenceStatistics || (this.selectedStatisticsVersion !== 'v2' && this.selectedStatisticsVersion !== 'v3')) {
      return null;
    }
    // Don't show differences if current version has no data yet (coding job hasn't run)
    if (this.codingStatistics.totalResponses === 0) {
      return null;
    }
    const currentCount = this.codingStatistics.statusCounts[status] || 0;
    const referenceCount = this.referenceStatistics.statusCounts[status] || 0;
    return currentCount - referenceCount;
  }

  getTotalResponsesDifference(): number | null {
    if (!this.referenceStatistics || (this.selectedStatisticsVersion !== 'v2' && this.selectedStatisticsVersion !== 'v3')) {
      return null;
    }
    // Don't show differences if current version has no data yet (coding job hasn't run)
    if (this.codingStatistics.totalResponses === 0) {
      return null;
    }
    return this.codingStatistics.totalResponses - this.referenceStatistics.totalResponses;
  }

  getDifferenceTooltip(): string {
    if (this.referenceVersion === 'v1') {
      return this.translateService.instant('coding-management.statistics.difference-tooltip-v1');
    }
    if (this.referenceVersion === 'v2') {
      return this.translateService.instant('coding-management.statistics.difference-tooltip-v2');
    }
    return '';
  }

  formatDifference(diff: number | null): string {
    if (diff === null) return '';
    if (diff > 0) return `+${diff}`;
    if (diff < 0) return `${diff}`;
    return '±0';
  }

  private statisticsDiffer(stats1: CodingStatistics, stats2: CodingStatistics): boolean {
    if (stats1.totalResponses !== stats2.totalResponses) {
      return true;
    }
    const allStatuses = new Set([
      ...Object.keys(stats1.statusCounts),
      ...Object.keys(stats2.statusCounts)
    ]);
    for (const status of allStatuses) {
      if ((stats1.statusCounts[status] || 0) !== (stats2.statusCounts[status] || 0)) {
        return true;
      }
    }
    return false;
  }

  getStatusPercentage(status: string): number {
    if (!this.codingStatistics.totalResponses || !this.codingStatistics.statusCounts[status]) {
      return 0;
    }
    return Math.round((this.codingStatistics.statusCounts[status] / this.codingStatistics.totalResponses) * 100);
  }

  fetchResponsesByStatus(status: string, page: number = 1, limit: number = this.pageSize): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading = true;
    this.currentStatusFilter = status;

    this.backendService.getResponsesByStatus(workspaceId, status, this.selectedStatisticsVersion, page, limit)
      .pipe(
        catchError(() => {
          this.isLoading = false;
          this.snackBar.open(`Fehler beim Abrufen der Antworten mit Status ${status}`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of({
            data: [],
            total: 0,
            page,
            limit
          });
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(response => {
        this.data = response.data.map((item: ResponseEntity) => {
          const codeKey = `code_${this.selectedStatisticsVersion}` as keyof ResponseEntity;
          const scoreKey = `score_${this.selectedStatisticsVersion}` as keyof ResponseEntity;

          return {
            id: item.id,
            unitid: item.unitId,
            variableid: item.variableid || '',
            status: item.status || '',
            value: item.value || '',
            subform: item.subform || '',
            code: (item[codeKey] as number)?.toString() || null,
            score: (item[scoreKey] as number)?.toString() || null,
            unit: item.unit,
            codedstatus: item.status_v1 || '',
            unitname: item.unit?.name || '',
            login_name: item.unit?.booklet?.person?.login || '',
            login_group: (item.unit?.booklet?.person as { login: string; code: string; group?: string })?.group || '',
            login_code: item.unit?.booklet?.person?.code || '',
            booklet_id: item.unit?.booklet?.bookletinfo?.name || ''
          };
        });
        this.dataSource.data = this.data;
        this.totalRecords = response.total;

        if (this.data.length === 0) {
          this.snackBar.open(`Keine Antworten mit Status ${status} gefunden.`, 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  onFilterChange(): void {
    this.clearFilterTimer();
    if (!this.filterParams.codedStatus) {
      this.data = [];
      this.dataSource.data = [];
      this.totalRecords = 0;
      this.currentStatusFilter = null;
      this.pageIndex = 0;
      return;
    }

    this.filterTimer = setTimeout(() => {
      this.performSearch();
    }, 500);
  }

  clearFilterTimer(): void {
    if (this.filterTimer) {
      clearTimeout(this.filterTimer);
      this.filterTimer = undefined;
    }
  }

  clearFilters(): void {
    this.filterParams = {
      unitName: '',
      codedStatus: '',
      version: 'v1',
      code: '',
      group: '',
      bookletName: '',
      variableId: ''
    };
    this.data = [];
    this.dataSource.data = [];
    this.totalRecords = 0;
    this.currentStatusFilter = null;
    this.pageIndex = 0;
  }

  performSearch(): void {
    this.currentStatusFilter = null;
    this.pageIndex = 0;
    this.fetchResponsesWithFilters();
  }

  fetchResponsesWithFilters(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading = true;

    const hasActiveFilters = Object.values(this.filterParams).some(value => value.trim() !== '');

    if (!hasActiveFilters) {
      this.data = [];
      this.dataSource.data = [];
      this.totalRecords = 0;
      this.isLoading = false;
      return;
    }

    this.backendService.searchResponses(workspaceId, this.filterParams, this.pageIndex + 1, this.pageSize)
      .pipe(
        catchError(() => {
          this.isLoading = false;
          this.snackBar.open('Fehler beim Filtern der Kodierdaten', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of<{ data: unknown[]; total: number }>({ data: [], total: 0 });
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((response: { data: any[]; total: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.data = response.data.map((item: any) => ({
          id: item.responseId,
          unitid: item.unitId,
          variableid: item.variableId || '',
          status: item.status || '',
          value: item.value || '',
          subform: '',
          code: item.code,
          score: item.score,
          unit: { name: item.unitName },
          codedstatus: item.codedStatus || '',
          unitname: item.unitName || '',
          login_name: item.personLogin || '',
          login_group: item.personGroup || '',
          login_code: item.personCode || '',
          booklet_id: item.bookletName || '',
          person_code: item.personCode || '',
          person_group: item.personGroup || '',
          variable_page: item.variablePage || '0'
        })) as Success[];
        this.dataSource.data = this.data;
        this.totalRecords = response.total;

        if (this.data.length === 0) {
          this.snackBar.open('Keine Daten mit den angegebenen Filtern gefunden.', 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  ngOnDestroy(): void {
    this.clearFilterTimer();
    this.destroy$.next();
    this.destroy$.complete();
    this.filterTextChanged.complete();
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim()
      .toLowerCase();

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }

    setTimeout(() => {
      this.isFilterLoading = false;
    }, 300);
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
    this.dataSource.paginator = this.paginator;
  }

  onPaginatorChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;

    if (this.currentStatusFilter) {
      this.fetchResponsesByStatus(this.currentStatusFilter, this.pageIndex + 1, this.pageSize);
    } else {
      // Check if we have active filters
      const hasActiveFilters = Object.values(this.filterParams).some(value => value.trim() !== '');

      if (hasActiveFilters) {
        this.fetchResponsesWithFilters();
      } else {
        this.fetchCodingList();
      }
    }
  }

  openReplay(response: Success): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!response.id) {
      this.snackBar.open('Fehlende Response-ID für Replay', 'Schließen', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    this.appService.createToken(workspaceId, this.appService.loggedUser?.sub || '', 3600)
      .pipe(
        catchError(() => {
          this.snackBar.open('Fehler beim Abrufen des Tokens für Replay', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of('');
        }),
        switchMap(token => {
          if (!token) {
            return of({ replayUrl: '' });
          }
          return this.backendService.getReplayUrl(workspaceId, response.id, token);
        })
      )
      .subscribe(result => {
        if (!result.replayUrl) {
          this.snackBar.open('Fehler beim Generieren der Replay-URL', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return;
        }
        window.open(result.replayUrl, '_blank');
      });
  }

  onAutoCode(): void {
    const dialogRef = this.dialog.open(TestPersonCodingDialogComponent, {
      height: '90vh',
      maxWidth: '100vw',
      maxHeight: '100vh'
    });

    dialogRef.afterClosed().subscribe(() => {
      this.fetchCodingStatistics();
    });
  }

  fetchCodingList(): void {
    const dialogRef = this.dialog.open(ExportDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed()
      .subscribe((format: ExportFormat | undefined) => {
        if (!format) {
          return;
        }

        const workspaceId = this.appService.selectedWorkspaceId;

        switch (format) {
          case 'csv':
            this.downloadCodingListAsCsvBackground(workspaceId);
            break;
          case 'excel':
            this.downloadCodingListAsExcelBackground(workspaceId);
            break;
          case 'json':
            this.downloadCodingListAsJsonBackground(workspaceId);
            break;
          default:
            this.snackBar.open(`Unbekanntes Format: ${format}`, 'Schließen', {
              duration: 5000,
              panelClass: ['error-snackbar']
            });
            break;
        }
      });
  }

  downloadCodingListAsJsonBackground(workspaceId: number): void {
    this.snackBar.open('Kodierliste wird im Hintergrund erstellt...', 'Schließen', {
      duration: 3000
    });
    this.backendService.getCodingListAsCsv(workspaceId)
      .pipe(
        catchError(() => {
          this.snackBar.open('Fehler beim Abrufen der Kodierliste (JSON)', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        })
      )
      .subscribe(async (blob: Blob | null) => {
        if (!blob) return;
        try {
          const text = await blob.text();
          const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
          if (lines.length === 0) {
            this.snackBar.open('Keine Einträge in der Kodierliste gefunden.', 'Schließen', { duration: 5000 });
            return;
          }
          const headers = lines[0].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(h => h.replace(/^"|"$/g, ''));
          const data = lines.slice(1).map(line => {
            const values = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.replace(/^"|"$/g, ''));
            const obj: Record<string, unknown> = {};
            headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
            return obj;
          });

          const jsonData = JSON.stringify(data, null, 2);
          const jsonBlob = new Blob([jsonData], { type: 'application/json' });
          const url = window.URL.createObjectURL(jsonBlob);

          const a = document.createElement('a');
          a.href = url;
          a.download = `coding-list-${new Date().toISOString()
            .slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();

          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);

          this.snackBar.open('Kodierliste wurde als JSON erfolgreich heruntergeladen.', 'Schließen', {
            duration: 5000,
            panelClass: ['success-snackbar']
          });
        } catch (e) {
          this.snackBar.open('Fehler beim Umwandeln der CSV-Daten in JSON', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      });
  }

  downloadCodingListAsCsvBackground(workspaceId: number): void {
    this.snackBar.open('Kodierliste wird im Hintergrund erstellt...', 'Schließen', {
      duration: 3000
    });
    this.backendService.getCodingListAsCsv(workspaceId)
      .pipe(
        catchError(() => {
          this.snackBar.open('Fehler beim Herunterladen der Kodierliste als CSV', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        })
      )
      .subscribe(response => {
        if (!response) {
          return;
        }
        const blob = response as Blob;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `coding-list-${new Date().toISOString()
          .slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        this.snackBar.open('Kodierliste wurde als CSV erfolgreich heruntergeladen.', 'Schließen', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      });
  }

  downloadCodingListAsExcelBackground(workspaceId: number): void {
    this.snackBar.open('Kodierliste wird im Hintergrund erstellt...', 'Schließen', {
      duration: 3000
    });
    this.backendService.getCodingListAsExcel(workspaceId)
      .pipe(
        catchError(() => {
          this.snackBar.open('Fehler beim Herunterladen der Kodierliste als Excel', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        })
      )
      .subscribe(response => {
        if (!response) {
          return;
        }

        const blob = response as Blob;
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `coding-list-${new Date().toISOString()
          .slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        this.snackBar.open('Kodierliste wurde als Excel erfolgreich heruntergeladen.', 'Schließen', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      });
  }

  getCodingSchemeRefFromUnit(unitId: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.backendService.getUnitContentXml(workspaceId, unitId.toString())
      .pipe(
        catchError(() => {
          this.snackBar.open(`Fehler beim Abrufen der Unit-XML-Daten für Unit ${unitId}`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        })
      )
      .subscribe(xmlContent => {
        if (!xmlContent) return;
        const codingSchemeRef = this.extractCodingSchemeRefFromXml(xmlContent);

        if (codingSchemeRef) {
          this.showCodingScheme(codingSchemeRef);
        } else {
          this.snackBar.open(`Kein Kodierschema in Kodierdaten für die Unit ${unitId} gefunden.`, 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  private extractCodingSchemeRefFromXml(xmlContent: string): string | null {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
      const codingSchemeRefElement = xmlDoc.querySelector('CodingSchemeRef');

      if (codingSchemeRefElement && codingSchemeRefElement.textContent) {
        return codingSchemeRefElement.textContent.trim();
      }
    } catch (error) {
      this.snackBar.open('Fehler beim Verarbeiten der Unit-XML-Daten', 'Schließen', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
    }

    return null;
  }

  showCodingScheme(codingSchemeRef: string): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.backendService.getCodingSchemeFile(workspaceId, codingSchemeRef)
      .pipe(
        catchError(() => {
          this.snackBar.open(`Fehler beim Abrufen des Kodierschemas '${codingSchemeRef}'`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        })
      )
      .subscribe(fileData => {
        if (!fileData || !fileData.base64Data) {
          this.snackBar.open(`Kodierschema '${codingSchemeRef}' in Kodierdaten nicht gefunden.`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return;
        }

        try {
          const decodedData = fileData.base64Data;

          this.dialog.open(ContentDialogComponent, {
            width: '80%',
            data: {
              title: `Kodierschema: ${codingSchemeRef}`,
              content: decodedData,
              isJson: true
            }
          });
        } catch (error) {
          this.snackBar.open(`Fehler beim Verarbeiten des Kodierschemas '${codingSchemeRef}'`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
        }
      });
  }

  showUnitXml(unitId: number): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.backendService.getUnitContentXml(workspaceId, unitId.toString())
      .pipe(
        catchError(() => {
          this.snackBar.open(`Fehler beim Abrufen der Unit-XML-Daten für Unit ${unitId}`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        })
      )
      .subscribe(xmlContent => {
        if (!xmlContent) return;
        this.dialog.open(ContentDialogComponent, {
          width: '80%',
          data: {
            title: `Unit-XML für Unit ${unitId}`,
            content: xmlContent,
            isXml: true
          }
        });
      });
  }

  openExportCodingBook(): void {
    this.dialog.open(ExportCodingBookComponent, {
      width: '80%',
      height: '80%'
    });
  }

  toggleManualCoding(): void {
    this.showManualCoding = !this.showManualCoding;
  }

  fetchVariableAnalysis(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.dialog.open(VariableAnalysisDialogComponent, {
      width: '90%',
      height: '90%',
      maxWidth: '1400px',
      maxHeight: '900px',
      data: {
        workspaceId
      }
    });
  }

  fetchUnitVariables(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.dialog.open(CodingVariablesDialogComponent, {
      width: '90%',
      maxWidth: '1400px',
      height: '90vh',
      data: {
        workspaceId
      }
    });
  }

  openResetVersionDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-management.descriptions.error-workspace'), this.translateService.instant('close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    // Get version label
    const versionOption = this.codingRunOptions.find(opt => opt.value === this.selectedStatisticsVersion);
    const versionLabel = versionOption?.label || '';

    // Determine cascade versions
    const cascadeVersions = this.selectedStatisticsVersion === 'v2' ? ['v3'] : [];

    const dialogRef = this.dialog.open(ResetVersionDialogComponent, {
      width: '500px',
      data: {
        version: this.selectedStatisticsVersion,
        versionLabel: versionLabel,
        cascadeVersions: cascadeVersions
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === true) {
        this.resetCodingVersion(this.selectedStatisticsVersion);
      }
    });
  }

  private resetCodingVersion(version: 'v1' | 'v2' | 'v3'): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;

    this.isLoading = true;
    this.backendService.resetCodingVersion(workspaceId, version)
      .pipe(
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe({
        next: result => {
          this.snackBar.open(result.message, this.translateService.instant('close'), {
            duration: 5000,
            panelClass: ['success-snackbar']
          });

          // Refresh statistics after reset
          this.fetchCodingStatistics();
        },
        error: () => {
          this.snackBar.open(
            this.translateService.instant('coding-management.descriptions.error-reset'),
            this.translateService.instant('close'),
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
        }
      });
  }

  openDownloadCodingResultsDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.translateService.instant('coding-management.descriptions.error-workspace'), this.translateService.instant('close'), {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    const dialogRef = this.dialog.open(DownloadCodingResultsDialogComponent, {
      width: '550px',
      data: {
        currentVersion: this.selectedStatisticsVersion
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const { version, format, includeReplayUrls } = result;
        this.downloadCodingResultsByVersion(workspaceId, version, format, includeReplayUrls);
      }
    });
  }

  private downloadCodingResultsByVersion(workspaceId: number, version: 'v1' | 'v2' | 'v3', format: ExportFormat, includeReplayUrls: boolean = false): void {
    this.performBackgroundDownload(workspaceId, version, format, includeReplayUrls);
  }

  private async performBackgroundDownload(workspaceId: number, version: 'v1' | 'v2' | 'v3', format: ExportFormat, includeReplayUrls: boolean = false): Promise<void> {
    this.isDownloadInProgress = true;

    const snackBarRef = this.snackBar.open(
      this.translateService.instant('coding-management.download-dialog.download-started', { version, format }),
      this.translateService.instant('close'),
      {
        duration: 0, // Keep open until we dismiss it
        panelClass: ['info-snackbar']
      }
    );

    try {
      switch (format) {
        case 'csv':
          await this.downloadCodingResultsAsCsvBackground(workspaceId, version, includeReplayUrls);
          break;
        case 'excel':
          await this.downloadCodingResultsAsExcelBackground(workspaceId, version, includeReplayUrls);
          break;
        case 'json':
          await this.downloadCodingResultsAsJsonBackground(workspaceId, version, includeReplayUrls);
          break;
        default:
          snackBarRef.dismiss();
          this.snackBar.open(
            this.translateService.instant('coding-management.download-dialog.error-unknown-format'),
            this.translateService.instant('close'),
            {
              duration: 5000,
              panelClass: ['error-snackbar']
            }
          );
          return;
      }

      snackBarRef.dismiss();
      this.snackBar.open(
        this.translateService.instant('coding-management.download-dialog.download-complete', { version, format }),
        this.translateService.instant('close'),
        {
          duration: 5000,
          panelClass: ['success-snackbar']
        }
      );
    } catch (error) {
      snackBarRef.dismiss();
      this.snackBar.open(
        this.translateService.instant('coding-management.download-dialog.download-failed'),
        this.translateService.instant('close'),
        {
          duration: 5000,
          panelClass: ['error-snackbar']
        }
      );
    } finally {
      this.isDownloadInProgress = false;
    }
  }

  private downloadCodingResultsAsJsonBackground(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.backendService.getCodingResultsByVersion(workspaceId, version, includeReplayUrls)
        .pipe(
          catchError(() => {
            reject(new Error('Failed to fetch JSON data'));
            return of(null);
          })
        )
        .subscribe(async (blob: Blob | null) => {
          if (!blob) {
            reject(new Error('No data received'));
            return;
          }
          try {
            const text = await blob.text();
            const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
            if (lines.length === 0) {
              reject(new Error('No entries found'));
              return;
            }
            const headers = lines[0].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(h => h.replace(/^"|"$/g, ''));
            const data = lines.slice(1).map(line => {
              const values = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v => v.replace(/^"|"$/g, ''));
              const obj: Record<string, unknown> = {};
              headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
              return obj;
            });

            const jsonData = JSON.stringify(data, null, 2);
            const jsonBlob = new Blob([jsonData], { type: 'application/json' });
            const url = window.URL.createObjectURL(jsonBlob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `coding-results-${version}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();

            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            resolve();
          } catch (e) {
            reject(e);
          }
        });
    });
  }

  private downloadCodingResultsAsCsvBackground(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.backendService.getCodingResultsByVersion(workspaceId, version, includeReplayUrls)
        .pipe(
          catchError(() => {
            reject(new Error('Failed to fetch CSV data'));
            return of(null);
          })
        )
        .subscribe(response => {
          if (!response) {
            reject(new Error('No data received'));
            return;
          }
          try {
            const blob = response as Blob;
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `coding-results-${version}-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();

            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            resolve();
          } catch (e) {
            reject(e);
          }
        });
    });
  }

  private downloadCodingResultsAsExcelBackground(workspaceId: number, version: 'v1' | 'v2' | 'v3', includeReplayUrls: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.backendService.getCodingResultsByVersionAsExcel(workspaceId, version, includeReplayUrls)
        .pipe(
          catchError(() => {
            reject(new Error('Failed to fetch Excel data'));
            return of(null);
          })
        )
        .subscribe(response => {
          if (!response) {
            reject(new Error('No data received'));
            return;
          }

          try {
            const blob = response as Blob;
            const url = window.URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `coding-results-${version}-${new Date().toISOString().slice(0, 10)}.xlsx`;
            document.body.appendChild(a);
            a.click();

            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            resolve();
          } catch (e) {
            reject(e);
          }
        });
    });
  }

  protected readonly Number = Number;
}
