import {
  Component,
  ViewChild,
  AfterViewInit,
  OnInit,
  OnDestroy
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { NgForOf, NgIf, TitleCasePipe } from '@angular/common';
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
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIcon } from '@angular/material/icon';
import { MatAnchor } from '@angular/material/button';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';

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
}

@Component({
  selector: 'app-coding-management',
  templateUrl: './coding-management.component.html',
  imports: [
    RouterLink,
    NgForOf,
    NgIf,
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
    MatAnchor
  ],
  styleUrls: ['./coding-management.component.scss']
})
export class CodingManagementComponent implements AfterViewInit, OnInit, OnDestroy {
  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  data: Success[] = [];
  dataSource = new MatTableDataSource<Success>(this.data);
  displayedColumns: string[] = ['unitname', 'variableid', 'status', 'value', 'codedstatus'];
  isLoading = false;
  isFilterLoading = false;

  pageSizeOptions = [100, 200, 500];
  pageSize = 100;

  filterTextChanged = new Subject<Event>();

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // Load data automatically when component initializes
    this.fetchCodingList();

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

  onAutoCode(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    this.backendService.getTestPersons(workspaceId).subscribe({
      next: testPersons => {
        this.backendService.codeTestPersons(workspaceId, testPersons).subscribe({
          next: success => {
            if (success) {
              console.log('Testpersonen erfolgreich kodiert.');
            } else {
              console.error('Fehler beim Kodieren der Testpersonen.');
            }
          },
          error: error => {
            console.error('Fehler beim Kodieren der Testpersonen:', error);
          }
        });
      },
      error: error => {
        console.error('Fehler beim Abrufen der Testgruppen:', error);
      }
    });
  }

  fetchCodingList(): void {
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
          console.error('Fehler beim Abrufen der Testgruppen:', error);
          return of([]);
        })
      )
      .subscribe(testPersons => {
        if (testPersons.length === 0) return;
        this.backendService.getManualCodingList(workspaceId, testPersons)
          .pipe(
            catchError(error => {
              this.snackBar.open('Fehler beim Abrufen der Kodierliste', 'Schließen', {
                duration: 5000,
                panelClass: ['error-snackbar']
              });
              console.error('Fehler beim Kodieren der Testpersonen:', error);
              return of(null);
            }),
            finalize(() => {
              this.isLoading = false;
            })
          )
          .subscribe(success => {
            if (success) {
              this.data = success;
              this.dataSource = new MatTableDataSource<Success>(this.data);
              this.dataSource.sort = this.sort;
              this.dataSource.paginator = this.paginator;

              this.dataSource.filterPredicate = (data: Success, filter: string) => {
                const searchTerms = filter.toLowerCase().split(' ');
                return searchTerms.every(term => {
                  const unitnameValue = data.unitname;
                  const variableidValue = data.variableid;

                  return (unitnameValue && unitnameValue.toString().toLowerCase().includes(term)) ||
                         (variableidValue && variableidValue.toString().toLowerCase().includes(term));
                });
              };

              console.log(success, 'Successfully fetched manual coding list.');

              if (this.data.length === 0) {
                this.snackBar.open('Keine Daten gefunden', 'Schließen', {
                  duration: 3000
                });
              }
            } else {
              this.snackBar.open('Fehler beim Laden der Kodierliste', 'Schließen', {
                duration: 5000,
                panelClass: ['error-snackbar']
              });
              console.error('Fehler beim Kodieren der Testpersonen.');
            }
          });
      });
  }
}
