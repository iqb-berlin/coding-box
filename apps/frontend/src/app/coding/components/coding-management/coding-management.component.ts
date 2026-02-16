import {
  Component,
  OnInit,
  OnDestroy,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import {
  MatAnchor,
  MatButton
} from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { PageEvent } from '@angular/material/paginator';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { responseStatesNumericMap } from '@iqbspecs/response/response.interface';
import { AppService } from '../../../core/services/app.service';
import { WorkspaceSettingsService } from '../../../ws-admin/services/workspace-settings.service';
import { CodingStatistics } from '../../../../../../../api-dto/coding/coding-statistics';
import {
  ExportDialogComponent,
  ExportFormat
} from '../export-dialog/export-dialog.component';
import { Success } from '../../models/success.model';
import { ResponseEntity } from '../../../shared/models/response-entity.model';
import { TestPersonCodingDialogComponent } from '../test-person-coding-dialog/test-person-coding-dialog.component';
import { ExportCodingBookComponent } from '../export-coding-book/export-coding-book.component';
import { CodingManagementManualComponent } from '../coding-management-manual/coding-management-manual.component';
import { VariableAnalysisDialogComponent } from '../variable-analysis-dialog/variable-analysis-dialog.component';
import { CodingVariablesDialogComponent } from '../../../coding-management/coding-variables-dialog/coding-variables-dialog.component';
import { ResetVersionDialogComponent } from './reset-version-dialog/reset-version-dialog.component';
import { DownloadCodingResultsDialogComponent } from './download-coding-results-dialog/download-coding-results-dialog.component';
import { CodingManagementService, StatisticsVersion, FilterParams } from '../../services/coding-management.service';
import { CodingManagementUiService } from './services/coding-management-ui.service';
import { StatisticsCardComponent } from './components/statistics-card/statistics-card.component';
import { ResponseFiltersComponent } from './components/response-filters/response-filters.component';
import { ResponseTableComponent } from './components/response-table/response-table.component';
import { SearchResponseItem } from '../../../models/coding-interfaces';
import { ItemListDialogComponent } from '../../../shared/dialogs/item-list-dialog/item-list-dialog.component';
import { ReviewListDialogComponent } from './components/review-list-dialog/review-list-dialog.component';

@Component({
  selector: 'app-coding-management',
  templateUrl: './coding-management.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatSnackBarModule,
    MatIcon,
    MatAnchor,
    MatButton,
    CodingManagementManualComponent,
    TranslateModule,
    StatisticsCardComponent,
    ResponseFiltersComponent,
    ResponseTableComponent
  ],
  styleUrls: ['./coding-management.component.scss']
})
export class CodingManagementComponent implements OnInit, OnDestroy {
  private appService = inject(AppService);
  private workspaceSettingsService = inject(WorkspaceSettingsService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private codingManagementService = inject(CodingManagementService);
  private uiService = inject(CodingManagementUiService);
  private translateService = inject(TranslateService);

  // State
  data: Success[] = [];
  displayedColumns: string[] = [
    'unitname',
    'variableid',
    'value',
    'codedstatus',
    'code',
    'score',
    'person_code',
    'person_login',
    'person_group',
    'booklet_id',
    'actions'
  ];

  isLoading = false;
  isLoadingStatistics = false;
  isDownloadInProgress = false;
  showManualCoding = false;
  resetProgress: number | null = null;
  downloadProgress: number | null = null;

  // Statistics state
  codingStatistics: CodingStatistics = { totalResponses: 0, statusCounts: {} };
  referenceStatistics: CodingStatistics | null = null;
  referenceVersion: StatisticsVersion | null = null;
  statisticsLoaded = false;
  isGeogebraAvailable = false;

  currentStatusFilter: string | null = null;
  pageSizeOptions = [100, 200, 500, 1000];
  pageSize = 100;
  totalRecords = 0;
  pageIndex = 0;

  selectedStatisticsVersion: 'v1' | 'v2' | 'v3' = 'v1';

  filterParams: FilterParams = {
    unitName: '',
    codedStatus: '',
    version: 'v1',
    code: '',
    group: '',
    bookletName: '',
    variableId: '',
    geogebra: false,
    personLogin: ''
  };

  private destroy$ = new Subject<void>();

  ngOnInit(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.workspaceSettingsService
        .getAutoFetchCodingStatistics(workspaceId)
        .subscribe(autoFetch => {
          if (autoFetch) {
            this.fetchCodingStatistics();
          }
        });

      this.codingManagementService.hasGeogebraResponses()
        .pipe(takeUntil(this.destroy$))
        .subscribe(available => {
          this.isGeogebraAvailable = available;
        });
    }

    // Subscribe to service state
    this.codingManagementService.codingStatistics$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => {
        this.codingStatistics = stats;
        this.statisticsLoaded = true;
      });

    this.codingManagementService.referenceStatistics$
      .pipe(takeUntil(this.destroy$))
      .subscribe(stats => {
        this.referenceStatistics = stats;
      });

    this.codingManagementService.referenceVersion$
      .pipe(takeUntil(this.destroy$))
      .subscribe(version => {
        this.referenceVersion = version;
      });

    this.codingManagementService.isLoadingStatistics$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isLoading => {
        this.isLoadingStatistics = isLoading;
      });

    this.codingManagementService.resetProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.resetProgress = progress;
        if (progress === null && this.statisticsLoaded) {
          this.fetchCodingStatistics();
          this.refreshTableData();
        }
      });

    this.codingManagementService.downloadProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => {
        this.downloadProgress = progress;
        this.isDownloadInProgress = progress !== null;
      });

    // Check for active reset job (persists across navigation)
    this.codingManagementService.checkActiveResetJob();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Statistics Card Event Handlers
  onVersionChange(version: 'v1' | 'v2' | 'v3'): void {
    this.selectedStatisticsVersion = version;
    this.data = [];
    this.currentStatusFilter = null;
    this.totalRecords = 0;
    this.referenceStatistics = null;
    this.referenceVersion = null;

    if (this.statisticsLoaded) {
      this.fetchCodingStatistics();
    }
  }

  fetchCodingStatistics(): void {
    this.codingManagementService.fetchCodingStatistics(this.selectedStatisticsVersion);
  }

  onDownloadResults(): void {
    this.openDownloadCodingResultsDialog();
  }

  onResetVersion(): void {
    this.openResetVersionDialog();
  }

  onStatusClick(status: string): void {
    this.fetchResponsesByStatus(status);
  }

  // Filter Event Handlers
  onFilterChange(filterParams: FilterParams): void {
    this.filterParams = filterParams;

    if (!filterParams.codedStatus && !filterParams.personLogin && !filterParams.unitName && !filterParams.bookletName && !filterParams.variableId && !filterParams.code && !filterParams.group) {
      this.data = [];
      this.totalRecords = 0;
      this.currentStatusFilter = null;
      this.pageIndex = 0;
      return;
    }

    this.currentStatusFilter = null;
    this.pageIndex = 0;
    this.fetchResponsesWithFilters();
  }

  onClearFilters(): void {
    this.filterParams = {
      unitName: '',
      codedStatus: '',
      version: 'v1',
      code: '',
      group: '',
      bookletName: '',
      variableId: '',
      geogebra: false,
      personLogin: ''
    };
    this.data = [];
    this.totalRecords = 0;
    this.currentStatusFilter = null;
    this.pageIndex = 0;
  }

  // Table Event Handlers
  onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;

    if (this.currentStatusFilter) {
      this.fetchResponsesByStatus(
        this.currentStatusFilter,
        this.pageIndex + 1,
        this.pageSize
      );
    } else {
      const hasActiveFilters = Object.values(this.filterParams).some(
        value => (typeof value === 'string' ? value.trim() !== '' : !!value)
      );

      if (hasActiveFilters) {
        this.fetchResponsesWithFilters();
      }
    }
  }

  onReplayClick(response: Success): void {
    this.uiService.openReplayForResponse(response).subscribe(replayUrl => {
      if (replayUrl) {
        window.open(replayUrl, '_blank');
      }
    });
  }

  onShowCodingScheme(unitId: number): void {
    this.uiService.getCodingSchemeFromUnit(unitId).subscribe(codingSchemeRef => {
      if (codingSchemeRef) {
        this.uiService.showCodingSchemeDialog(codingSchemeRef);
      }
    });
  }

  onShowUnitXml(unitId: number): void {
    this.uiService.showUnitXmlDialog(unitId);
  }

  onReviewClick(): void {
    if (!this.data || this.data.length === 0) {
      this.snackBar.open(
        this.translateService.instant('coding-management.messages.no-data-to-review'),
        this.translateService.instant('coding-management.actions.close'),
        { duration: 3000 }
      );
      return;
    }

    this.dialog.open(ReviewListDialogComponent, {
      width: '95vw',
      height: '95vh',
      maxWidth: '100vw',
      panelClass: 'full-screen-dialog',
      data: {
        responses: this.data,
        title: this.translateService.instant('coding-management.actions.review-session')
      }
    });
  }

  // Data Fetching Methods
  private fetchResponsesByStatus(
    status: string,
    page: number = 1,
    limit: number = this.pageSize
  ): void {
    this.isLoading = true;
    this.currentStatusFilter = status;

    this.codingManagementService.fetchResponsesByStatus(
      status,
      this.selectedStatisticsVersion,
      page,
      limit
    ).subscribe({
      next: response => {
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
            login_group: (item.unit?.booklet?.person as { group?: string } | undefined)?.group || '',
            login_code: item.unit?.booklet?.person?.code || '',
            booklet_id: item.unit?.booklet?.bookletinfo?.name || ''
          } as Success;
        });
        this.totalRecords = response.total;
        this.isLoading = false;

        if (this.data.length === 0) {
          const statusName = responseStatesNumericMap.find(entry => entry.key.toString() === status)?.value || status;
          this.snackBar.open(
            this.translateService.instant('coding-management.descriptions.no-results', { status: statusName === 'null' ? this.translateService.instant('coding-management.statistics.uncoded-responses-title') : statusName }),
            this.translateService.instant('close'),
            { duration: 5000 }
          );
        }
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  private fetchResponsesWithFilters(): void {
    this.isLoading = true;

    const hasActiveFilters = Object.values(this.filterParams).some(
      value => (typeof value === 'string' ? value.trim() !== '' : !!value)
    );

    if (!hasActiveFilters) {
      this.data = [];
      this.totalRecords = 0;
      this.isLoading = false;
      return;
    }

    this.codingManagementService.searchResponses(
      this.filterParams,
      this.pageIndex + 1,
      this.pageSize
    ).subscribe({
      next: (response: { data: SearchResponseItem[]; total: number }) => {
        this.data = response.data.map((item: SearchResponseItem) => ({
          id: item.responseId,
          unitid: item.unitId,
          variableid: item.variableId || '',
          status: item.status || '',
          value: item.value || '',
          subform: '',
          code: item.code?.toString() || null,
          score: item.score?.toString() || null,
          unit: { name: item.unitName },
          codedstatus: item.codedStatus || '',
          unitname: item.unitName || '',
          login_name: item.personLogin || '',
          login_group: item.personGroup || '',
          login_code: item.personCode || '',
          booklet_id: item.bookletName || '',
          person_code: item.personCode || '',
          person_group: item.personGroup || '',
          variable_page: item.variablePage || '0',
          code_v1: item.code_v1,
          code_v2: item.code_v2,
          code_v3: item.code_v3,
          status_v1: item.status_v1,
          status_v2: item.status_v2,
          status_v3: item.status_v3
        })) as Success[];
        this.totalRecords = response.total;
        this.isLoading = false;

        if (this.data.length === 0) {
          this.snackBar.open(
            'Keine Daten mit den angegebenen Filtern gefunden.',
            'Schließen',
            { duration: 5000 }
          );
        }
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  // Dialog Methods
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

    dialogRef.afterClosed().subscribe((format: ExportFormat | undefined) => {
      if (format) {
        this.codingManagementService.downloadCodingList(format);
      }
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
      data: { workspaceId }
    });
  }

  fetchUnitVariables(): void {
    const workspaceId = this.appService.selectedWorkspaceId;

    this.dialog.open(CodingVariablesDialogComponent, {
      width: '90%',
      maxWidth: '1400px',
      height: '90vh',
      data: { workspaceId }
    });
  }

  private openResetVersionDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        'Fehler: Kein Workspace ausgewählt',
        'Schließen',
        {
          duration: 5000,
          panelClass: ['error-snackbar']
        }
      );
      return;
    }

    const versionOption = [
      { value: 'v1', label: 'coding-management.statistics.first-autocode-run' },
      { value: 'v2', label: 'coding-management.statistics.manual-coding-run' },
      { value: 'v3', label: 'coding-management.statistics.second-autocode-run' }
    ].find(opt => opt.value === this.selectedStatisticsVersion);

    const versionLabel = versionOption?.label || '';
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
    this.codingManagementService.resetCodingVersion(version);
  }

  private openDownloadCodingResultsDialog(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(
        'Fehler: Kein Workspace ausgewählt',
        'Schließen',
        {
          duration: 5000,
          panelClass: ['error-snackbar']
        }
      );
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
        this.codingManagementService.downloadCodingResults(version, format, includeReplayUrls)
          .finally(() => {
            this.isDownloadInProgress = false;
          });
      }
    });
  }

  getAvailableStatuses(): string[] {
    return Object.keys(this.codingStatistics.statusCounts);
  }

  private refreshTableData(): void {
    if (this.data.length === 0) return;

    if (this.currentStatusFilter) {
      this.fetchResponsesByStatus(this.currentStatusFilter);
    } else {
      const hasActiveFilters = Object.values(this.filterParams).some(
        value => value && value.trim() !== ''
      );

      if (hasActiveFilters) {
        this.fetchResponsesWithFilters();
      }
    }
  }

  openItemListDialog(): void {
    this.dialog.open(ItemListDialogComponent, {
      width: '600px',
      maxHeight: '80vh'
    });
  }
}
