import {
  Component, ViewChild, AfterViewInit, OnInit, OnDestroy, inject
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgClass, TitleCasePipe } from '@angular/common';
import {
  catchError,
  finalize,
  debounceTime,
  distinctUntilChanged
} from 'rxjs/operators';
import { of, Subject } from 'rxjs';
import {
  MatCell, MatCellDef,
  MatColumnDef,
  MatHeaderCell, MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef, MatRow, MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatSort, MatSortModule, MatSortHeader } from '@angular/material/sort';
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import { MatAnchor, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { MatDivider } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { BackendService, CodingListItem } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';
import { ExportDialogComponent, ExportFormat } from '../export-dialog/export-dialog.component';

interface Success {
  id: number;
  unitid: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code: string | null;
  score: string | null;
  codedstatus: string;
  unitname: string;
  login_name?: string;
  login_code?: string;
  login_group?: string;
  booklet_id?: string;
}

@Component({
  selector: 'app-coding-management',
  templateUrl: './coding-management.component.html',
  imports: [
    RouterLink,
    NgClass,
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    TitleCasePipe,
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
    ScrollingModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule,
    MatIcon,
    MatAnchor,
    MatIconButton,
    MatTooltipModule,
    MatDivider
  ],
  styleUrls: ['./coding-management.component.scss']
})
export class CodingManagementComponent implements AfterViewInit, OnInit, OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  data: any[] = [];
  dataSource = new MatTableDataSource<CodingListItem>(this.data);
  displayedColumns: string[] = ['unitname', 'variableid', 'value', 'codedstatus', 'actions'];
  isLoading = false;
  isFilterLoading = false;
  isLoadingStatistics = false;
  isAutoCoding = false;
  currentStatusFilter: string | null = null;
  pageSizeOptions = [100, 200, 500];
  pageSize = 100;
  totalRecords = 0;
  pageIndex = 0;
  filterTextChanged = new Subject<Event>();
  codingStatistics: CodingStatistics = {
    totalResponses: 0,
    statusCounts: {}
  };

  constructor() {
    this.isAutoCoding = false;
  }

  ngOnInit(): void {
    this.fetchCodingStatistics();

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

    this.backendService.getCodingStatistics(workspaceId)
      .pipe(
        catchError(() => {
          this.isLoadingStatistics = false;
          this.snackBar.open('Fehler beim Abrufen der Kodierstatistiken', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of({ totalResponses: 0, statusCounts: {} });
        }),
        finalize(() => {
          this.isLoadingStatistics = false;
        })
      )
      .subscribe(statistics => {
        this.codingStatistics = statistics;
      });
  }

  getOtherStatuses(): string[] {
    const excludedStatuses = ['INVALID', 'CODING_INCOMPLETE', 'NOT_REACHED', 'INTENDED_INCOMPLETE'];
    return Object.keys(this.codingStatistics.statusCounts)
      .filter(status => !excludedStatuses.includes(status));
  }

  getStatusPercentage(status: string): number {
    if (!this.codingStatistics.totalResponses || !this.codingStatistics.statusCounts[status]) {
      return 0;
    }
    return Math.round((this.codingStatistics.statusCounts[status] / this.codingStatistics.totalResponses) * 100);
  }

  getStatusColor(status: string): string {
    const colorMap: { [key: string]: string } = {
      CODING_COMPLETE: '#4CAF50', // Green
      CODING_INCOMPLETE: '#FFC107', // Amber
      NOT_REACHED: '#9E9E9E', // Grey
      INVALID: '#F44336', // Red
      INTENDED_INCOMPLETE: '#2196F3' // Blue
    };
    return colorMap[status] || '#9C27B0'; // Default to purple for unknown statuses
  }

  getChartData(): { status: string; count: number; percentage: number; color: string }[] {
    if (!this.codingStatistics.totalResponses) {
      return [];
    }

    return Object.keys(this.codingStatistics.statusCounts).map(status => ({
      status,
      count: this.codingStatistics.statusCounts[status],
      percentage: this.getStatusPercentage(status),
      color: this.getStatusColor(status)
    }));
  }

  fetchResponsesByStatus(status: string, page: number = 1, limit: number = this.pageSize): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading = true;
    this.currentStatusFilter = status;

    this.backendService.getResponsesByStatus(workspaceId, status, page, limit)
      .pipe(
        catchError(() => {
          this.isLoading = false;
          this.snackBar.open(`Fehler beim Abrufen der Antworten mit Status ${status}`, 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of({
            data: [], total: 0, page, limit
          });
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(response => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.data = response.data.map((item: any) => ({
          id: item.id,
          unitid: item.unitId,
          variableid: item.variableid || '',
          status: item.status || '',
          value: item.value || '',
          subform: item.subform || '',
          code: item.code,
          score: item.score,
          codedstatus: item.codedstatus || '',
          unitname: item.unit?.name || '',
          // Extract information for replay URL
          login_name: item.unit?.booklet?.person?.login || '',
          login_group: item.unit?.booklet?.person?.group || '',
          login_code: item.unit?.booklet?.person?.code || '',
          booklet_id: item.unit?.booklet?.bookletinfo?.name || ''
        }));

        this.dataSource.data = this.data;
        this.totalRecords = response.total;

        if (this.data.length === 0) {
          this.snackBar.open(`Keine Antworten mit Status ${status} gefunden.`, 'Schließen', {
            duration: 5000
          });
        }
      });
  }

  ngOnDestroy(): void {
    this.filterTextChanged.complete();
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();

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
      this.fetchCodingList(this.pageIndex + 1, this.pageSize);
    }
  }

  openReplay(response: Success): void {
    const page = '0';
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!response.login_name || !response.login_code || !response.booklet_id) {
      this.snackBar.open('Fehlende Informationen für Replay', 'Schließen', {
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
        })
      )
      .subscribe(token => {
        if (!token) {
          return;
        }
        const url = `${window.location.origin}/#/replay/${response.login_name}@${response.login_code}@${response.login_group}/${response.unitname}/${page}/${response.variableid}?auth=${token}`;
        window.open(url, '_blank');
      }
      );
  }

  onAutoCode(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isAutoCoding = true;

    this.backendService.getTestPersons(workspaceId)
      .pipe(
        catchError(() => {
          this.isAutoCoding = false;
          this.snackBar.open('Fehler beim Abrufen der Testgruppen', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of([]);
        })
      )
      .subscribe(testPersons => {
        if (testPersons.length === 0) {
          this.isAutoCoding = false;
          return;
        }

        this.backendService.codeTestPersons(workspaceId, testPersons)
          .pipe(
            catchError(() => {
              this.isAutoCoding = false;
              this.snackBar.open('Fehler beim Kodieren der Testpersonen', 'Schließen', {
                duration: 5000,
                panelClass: ['error-snackbar']
              });
              return of({ totalResponses: 0, statusCounts: {} });
            }),
            finalize(async () => {
              this.isAutoCoding = false;
              this.fetchCodingStatistics();
            })
          )
          .subscribe(stats => {
            // Create a report message
            let reportMessage = `Insgesamt wurden ${stats.totalResponses} Antworten verarbeitet.\n\n`;
            reportMessage += 'Verteilung der Kodier-Status:\n';
            for (const status in stats.statusCounts) {
              if (Object.prototype.hasOwnProperty.call(stats.statusCounts, status)) {
                // @ts-expect-error - Index access on statusCounts object
                reportMessage += `${status}: ${stats.statusCounts[status]}\n`;
              }
            }

            this.snackBar.open(reportMessage, 'Schließen', {
              duration: 10000,
              panelClass: ['success-snackbar']
            });
          });
      });
  }

  fetchCodingList(page: number = 1, limit: number = this.pageSize): void {
    const dialogRef = this.dialog.open(ExportDialogComponent, {
      width: '500px'
    });

    dialogRef.afterClosed().subscribe((format: ExportFormat | undefined) => {
      if (!format) {
        return;
      }

      const workspaceId = this.appService.selectedWorkspaceId;
      this.isLoading = true;

      this.backendService.getCodingList(workspaceId, page, limit)
        .pipe(
          catchError(() => {
            this.isLoading = false;
            this.snackBar.open('Fehler beim Abrufen der Kodierliste', 'Schließen', {
              duration: 5000,
              panelClass: ['error-snackbar']
            });
            return of({
              data: [], total: 0, page, limit
            });
          }),
          finalize(() => {
            this.isLoading = false;
          })
        )
        .subscribe(result => {
          if (result && result.data.length > 0) {
            switch (format) {
              case 'json':
                this.downloadCodingListAsJson(result.data);
                break;
              case 'csv':
                this.downloadCodingListAsCsv(workspaceId);
                break;
              case 'excel':
                this.downloadCodingListAsExcel(workspaceId);
                break;
              default:
                this.snackBar.open(`Unbekanntes Format: ${format}`, 'Schließen', {
                  duration: 5000,
                  panelClass: ['error-snackbar']
                });
                break;
            }

            this.snackBar.open(`Kodierliste mit ${result.total} Einträgen wurde erfolgreich abgerufen.`, 'Schließen', {
              duration: 5000,
              panelClass: ['success-snackbar']
            });
          } else {
            this.snackBar.open('Keine Einträge in der Kodierliste gefunden.', 'Schließen', {
              duration: 5000
            });
          }
        });
    });
  }

  downloadCodingListAsJson(data: never[] | CodingListItem[]): void {
    if (data.length === 0) {
      this.snackBar.open('Keine Daten zum Herunterladen verfügbar. Bitte zuerst die Kodierliste abrufen.', 'Schließen', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    const jsonData = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `coding-list-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();

    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    this.snackBar.open('Kodierliste wurde als JSON heruntergeladen.', 'Schließen', {
      duration: 5000,
      panelClass: ['success-snackbar']
    });
  }

  downloadCodingListAsCsv(workspaceId: number): void {
    this.isLoading = true;
    this.backendService.getCodingListAsCsv(workspaceId)
      .pipe(
        catchError(() => {
          this.isLoading = false;
          this.snackBar.open('Fehler beim Herunterladen der Kodierliste als CSV', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(response => {
        if (!response) {
          return;
        }
        const blob = new Blob([response], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `coding-list-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();

        // Clean up
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        this.snackBar.open('Kodierliste wurde als CSV heruntergeladen.', 'Schließen', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      });
  }

  downloadCodingListAsExcel(workspaceId: number): void {
    this.isLoading = true;
    this.backendService.getCodingListAsExcel(workspaceId)
      .pipe(
        catchError(() => {
          this.isLoading = false;
          this.snackBar.open('Fehler beim Herunterladen der Kodierliste als Excel', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of(null);
        }),
        finalize(() => {
          this.isLoading = false;
        })
      )
      .subscribe(response => {
        if (!response) {
          return;
        }

        const blob = new Blob([response], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `coding-list-${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();

        // Clean up
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        this.snackBar.open('Kodierliste wurde als Excel heruntergeladen.', 'Schließen', {
          duration: 5000,
          panelClass: ['success-snackbar']
        });
      });
  }
}
