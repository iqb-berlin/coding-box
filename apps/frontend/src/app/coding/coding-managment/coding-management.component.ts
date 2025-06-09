import {
  Component,
  ViewChild,
  AfterViewInit,
  OnInit,
  OnDestroy
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  NgForOf,
  NgIf,
  NgClass,
  TitleCasePipe
} from '@angular/common';
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
import { BackendService, CodingListItem } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { CodingStatistics } from '../../../../../../api-dto/coding/coding-statistics';

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
  booklet_id?: string;
}

@Component({
  selector: 'app-coding-management',
  templateUrl: './coding-management.component.html',
  imports: [
    RouterLink,
    NgForOf,
    NgIf,
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
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  data: any[] = [];
  dataSource = new MatTableDataSource<CodingListItem>(this.data);
  displayedColumns: string[] = ['unitname', 'variableid', 'value', 'codedstatus', 'actions'];
  isLoading = false;
  isFilterLoading = false;
  isLoadingStatistics = false;
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

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // this.fetchCodeManual();
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
        catchError(error => {
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

  /**
   * Returns all status types except the ones that are displayed separately
   */
  getOtherStatuses(): string[] {
    const excludedStatuses = ['INVALID', 'CODING_INCOMPLETE', 'NOT_REACHED', 'INTENDED_INCOMPLETE'];
    return Object.keys(this.codingStatistics.statusCounts)
      .filter(status => !excludedStatuses.includes(status));
  }

  /**
   * Fetches responses with the specified status
   */
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

  /**
   * Generates a replay URL for a response and opens it in a new tab
   * Format: /replay/{login_name}@{login_code}@{booklet_id}/{unit_key}/{page}
   */
  openReplay(response: Success): void {
    // For now, we'll use a hardcoded token and page number
    // In a real implementation, these would be retrieved from the backend
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoicmVpY2hsZWpAZ214LmRlIiwic3ViIjp7ImlkIjoxLCJ1c2VybmFtZSI6InJlaWNobGVqQGdteC5kZSIsImlzQWRtaW4iOnRydWV9LCJ3b3Jrc3BhY2UiOiIzNCIsImlhdCI6MTc0OTAzNzUzMywiZXhwIjoxNzU0MjIxNTMzfQ.4FVfq10u_SbhXCCNXb2edh_SYupW-LZPj09Opb08CS4';
    const page = '0';

    // Check if we have all the necessary information for the replay URL
    if (!response.login_name || !response.login_code || !response.booklet_id) {
      this.snackBar.open('Fehlende Informationen für Replay', 'Schließen', {
        duration: 5000,
        panelClass: ['error-snackbar']
      });
      return;
    }

    // Construct the replay URL
    const url = `${window.location.origin}/#/replay/${response.login_name}@${response.login_code}@${response.booklet_id}/${response.unitname}/${page}?auth=${token}`;

    // Open the URL in a new tab
    window.open(url, '_blank');
  }

  onAutoCode(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading = true;

    this.backendService.getTestPersons(workspaceId)
      .pipe(
        catchError(error => {
          this.isLoading = false;
          this.snackBar.open('Fehler beim Abrufen der Testgruppen', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of([]);
        })
      )
      .subscribe(testPersons => {
        if (testPersons.length === 0) {
          this.isLoading = false;
          return;
        }

        this.backendService.codeTestPersons(workspaceId, testPersons)
          .pipe(
            catchError(error => {
              this.snackBar.open('Fehler beim Kodieren der Testpersonen', 'Schließen', {
                duration: 5000,
                panelClass: ['error-snackbar']
              });
              return of({ totalResponses: 0, statusCounts: {} });
            }),
            finalize(() => {
              this.isLoading = false;
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

            // Show the report in a snackbar
            this.snackBar.open(reportMessage, 'Schließen', {
              duration: 10000,
              panelClass: ['success-snackbar']
            });

          });
      });
  }

  fetchCodeManual(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading = true;

    this.backendService.getTestPersons(workspaceId)
      .pipe(
        catchError(error => {
          this.isLoading = false;
          this.snackBar.open('Fehler beim Abrufen der Testgruppen', 'Schließen', {
            duration: 5000,
            panelClass: ['error-snackbar']
          });
          return of([]);
        })
      )
      .subscribe(testPersons => {
        if (testPersons.length === 0) {
          this.isLoading = false;
          return;
        }

        this.backendService.getManualCodingList(workspaceId, testPersons)
          .pipe(
            catchError(error => {
              this.isLoading = false;
              this.snackBar.open('Fehler beim Abrufen der manuell zu kodierenden Fälle', 'Schließen', {
                duration: 5000,
                panelClass: ['error-snackbar']
              });
              return of(false);
            }),
            finalize(() => {
              this.isLoading = false;
            })
          )
          .subscribe(result => {
            if (result) {
              this.snackBar.open('Manuelle zu kodierende Fälle wurden erfolgreich abgerufen.', 'Schließen', {
                duration: 5000,
                panelClass: ['success-snackbar']
              });
            } else {
              this.snackBar.open('Fehler beim Abrufen der manuell zu kodierenden Fälle.', 'Schließen', {
                duration: 5000,
                panelClass: ['error-snackbar']
              });
            }
          });
      });
  }

  fetchCodingList(page: number = 1, limit: number = this.pageSize): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading = true;

    this.backendService.getCodingList(workspaceId, page, limit)
      .pipe(
        catchError(error => {
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
          this.data = result.data;
          this.dataSource.data = this.data;
          this.totalRecords = result.total;

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
  }
}
