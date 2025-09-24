import {
  Component, Inject, OnInit, ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MatDialog,
  MatDialogModule,
  MatDialogRef,
  MAT_DIALOG_DATA
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';

interface BookletSearchResult {
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  units: {
    unitId: number;
    unitName: string;
    unitAlias: string | null;
  }[];
}

@Component({
  selector: 'coding-box-booklet-search-dialog',
  templateUrl: './booklet-search-dialog.component.html',
  styleUrls: ['./booklet-search-dialog.component.scss'],
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatPaginatorModule,
    MatTooltipModule,
    TranslateModule
  ]
})
export class BookletSearchDialogComponent implements OnInit {
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  bookletSearchText = '';
  bookletSearchResults: BookletSearchResult[] = [];
  isLoading = false;
  totalResults = 0;
  currentPage = 1;
  pageSize = 10;
  displayedColumns: string[] = ['bookletName', 'personCode', 'personLogin', 'personGroup', 'unitCount', 'actions'];
  private searchSubject = new Subject<string>();

  constructor(
    public dialogRef: MatDialogRef<BookletSearchDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { initialSearch?: string },
    private backendService: BackendService,
    private appService: AppService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    // Set up debounced search
    this.searchSubject.pipe(
      debounceTime(500),
      distinctUntilChanged()
    ).subscribe(searchText => {
      this.searchBooklets(searchText);
    });

    // Initial search if data is provided
    if (this.data && this.data.initialSearch) {
      this.bookletSearchText = this.data.initialSearch;
      this.searchBooklets(this.bookletSearchText);
    }
  }

  onBookletSearchChange(): void {
    this.isLoading = true;
    this.searchSubject.next(this.bookletSearchText);
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex + 1;
    this.pageSize = event.pageSize;
    this.searchBooklets(this.bookletSearchText);
  }

  searchBooklets(bookletName: string): void {
    if (!bookletName || bookletName.trim() === '') {
      this.bookletSearchResults = [];
      this.totalResults = 0;
      this.isLoading = false;
      return;
    }

    this.isLoading = true;
    this.backendService.searchBookletsByName(
      this.appService.selectedWorkspaceId,
      bookletName,
      this.currentPage,
      this.pageSize
    ).subscribe({
      next: response => {
        this.bookletSearchResults = response.data;
        this.totalResults = response.total;
        this.isLoading = false;
      },
      error: () => {
        this.bookletSearchResults = [];
        this.totalResults = 0;
        this.isLoading = false;
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  viewBookletInfo(booklet: BookletSearchResult): void {
    this.dialog.open(BookletInfoDialogComponent, {
      width: '800px',
      data: {
        bookletId: booklet.bookletId,
        bookletName: booklet.bookletName
      }
    });
  }

  deleteBooklet(booklet: BookletSearchResult): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Booklet löschen',
        content: `Sind Sie sicher, dass Sie das Booklet "${booklet.bookletName}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        this.backendService.deleteBooklet(
          this.appService.selectedWorkspaceId,
          booklet.bookletId
        ).subscribe({
          next: response => {
            if (response.success) {
              // Remove the deleted booklet from the results
              this.bookletSearchResults = this.bookletSearchResults.filter(
                b => b.bookletId !== booklet.bookletId
              );

              this.snackBar.open(
                `Booklet "${booklet.bookletName}" wurde erfolgreich gelöscht.`,
                'OK',
                { duration: 3000 }
              );
            } else {
              this.snackBar.open(
                `Fehler beim Löschen des Booklets: ${response.report.warnings.join(', ')}`,
                'OK',
                { duration: 5000 }
              );
            }
            this.isLoading = false;
          },
          error: () => {
            this.snackBar.open(
              'Fehler beim Löschen des Booklets. Bitte versuchen Sie es erneut.',
              'OK',
              { duration: 5000 }
            );
            this.isLoading = false;
          }
        });
      }
    });
  }

  deleteAllBooklets(): void {
    if (this.bookletSearchResults.length === 0) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle Booklets löschen',
        content: `Sind Sie sicher, dass Sie alle ${this.bookletSearchResults.length} gefundenen Booklets löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Alle löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const bookletIds = this.bookletSearchResults.map(booklet => booklet.bookletId);
        let successCount = 0;
        let failCount = 0;

        this.isLoading = true;

        // Process each booklet deletion sequentially
        const processNextBooklet = (index: number) => {
          if (index >= bookletIds.length) {
            // All booklets processed
            this.isLoading = false;
            this.snackBar.open(
              `${successCount} Booklets gelöscht, ${failCount} fehlgeschlagen.`,
              'OK',
              { duration: 5000 }
            );
            // Refresh the search results
            this.searchBooklets(this.bookletSearchText);
            return;
          }

          this.backendService.deleteBooklet(
            this.appService.selectedWorkspaceId,
            bookletIds[index]
          ).subscribe({
            next: response => {
              if (response.success) {
                successCount += 1;
              } else {
                failCount += 1;
              }
              processNextBooklet(index + 1);
            },
            error: () => {
              failCount += 1;
              processNextBooklet(index + 1);
            }
          });
        };

        // Start processing
        processNextBooklet(0);
      }
    });
  }
}
