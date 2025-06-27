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
import { MatPaginator, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';

interface UnitSearchResult {
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  tags: { id: number; unitId: number; tag: string; color?: string; createdAt: Date }[];
  responses: { variableId: string; value: string; status: string; code?: number; score?: number; codedStatus?: string }[];
}

interface ResponseSearchResult {
  responseId: number;
  variableId: string;
  value: string;
  status: string;
  code?: number;
  score?: number;
  codedStatus?: string;
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
}

@Component({
  selector: 'coding-box-unit-search-dialog',
  templateUrl: './unit-search-dialog.component.html',
  styleUrls: ['./unit-search-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatPaginatorModule,
    TranslateModule
  ]
})
export class UnitSearchDialogComponent implements OnInit {
  searchText: string = '';
  searchValue: string = '';
  searchVariableId: string = '';
  searchUnitName: string = '';
  searchStatus: string = '';
  searchCodedStatus: string = '';
  searchGroup: string = '';
  searchCode: string = '';

  searchMode: 'unit' | 'response' = 'unit';

  unitSearchResults: UnitSearchResult[] = [];
  responseSearchResults: ResponseSearchResult[] = [];

  isLoading: boolean = false;
  unitDisplayedColumns: string[] = ['unitName', 'unitAlias', 'bookletName', 'personLogin', 'personCode', 'personGroup', 'tags', 'responseValue', 'actions'];
  responseDisplayedColumns: string[] = ['variableId', 'value', 'status', 'codedStatus', 'unitName', 'unitAlias', 'bookletName', 'personLogin', 'personCode', 'personGroup', 'actions'];

  private unitSearchSubject = new Subject<string>();
  private responseSearchSubject = new Subject<{ value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string }>();
  private readonly SEARCH_DEBOUNCE_TIME = 500;

  totalItems: number = 0;
  pageSize: number = 10;
  pageIndex: number = 0;
  pageSizeOptions: number[] = [50, 100, 200, 500];

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(
    private dialogRef: MatDialogRef<UnitSearchDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { title: string },
    private backendService: BackendService,
    private appService: AppService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.unitSearchSubject.pipe(
      debounceTime(this.SEARCH_DEBOUNCE_TIME),
      distinctUntilChanged()
    ).subscribe(searchText => {
      this.pageIndex = 0; // Reset to first page on new search
      this.searchUnits(searchText);
    });

    this.responseSearchSubject.pipe(
      debounceTime(this.SEARCH_DEBOUNCE_TIME),
      distinctUntilChanged((prev, curr) => prev.value === curr.value && prev.variableId === curr.variableId && prev.unitName === curr.unitName && prev.status === curr.status && prev.codedStatus === curr.codedStatus && prev.group === curr.group && prev.code === curr.code)
    ).subscribe(searchParams => {
      this.pageIndex = 0; // Reset to first page on new search
      this.searchResponses(searchParams);
    });
  }

  onUnitSearchChange(): void {
    if (this.searchText.trim().length > 2) {
      this.unitSearchSubject.next(this.searchText);
    }
  }

  onResponseSearchChange(): void {
    this.responseSearchSubject.next({
      value: this.searchValue.trim() !== '' ? this.searchValue : undefined,
      variableId: this.searchVariableId.trim() !== '' ? this.searchVariableId : undefined,
      unitName: this.searchUnitName.trim() !== '' ? this.searchUnitName : undefined,
      status: this.searchStatus.trim() !== '' ? this.searchStatus : undefined,
      codedStatus: this.searchCodedStatus.trim() !== '' ? this.searchCodedStatus : undefined,
      group: this.searchGroup.trim() !== '' ? this.searchGroup : undefined,
      code: this.searchCode.trim() !== '' ? this.searchCode : undefined
    });
  }

  onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;

    if (this.searchMode === 'unit') {
      this.searchUnits(this.searchText);
    } else {
      this.searchResponses({
        value: this.searchValue.trim() !== '' ? this.searchValue : undefined,
        variableId: this.searchVariableId.trim() !== '' ? this.searchVariableId : undefined,
        unitName: this.searchUnitName.trim() !== '' ? this.searchUnitName : undefined,
        status: this.searchStatus.trim() !== '' ? this.searchStatus : undefined,
        codedStatus: this.searchCodedStatus.trim() !== '' ? this.searchCodedStatus : undefined,
        group: this.searchGroup.trim() !== '' ? this.searchGroup : undefined,
        code: this.searchCode.trim() !== '' ? this.searchCode : undefined
      });
    }
  }

  toggleSearchMode(): void {
    this.searchMode = this.searchMode === 'unit' ? 'response' : 'unit';
    this.pageIndex = 0;
    this.totalItems = 0;
    this.unitSearchResults = [];
    this.responseSearchResults = [];
  }

  searchUnits(unitName: string): void {
    if (!unitName || unitName.trim().length < 3) {
      this.unitSearchResults = [];
      this.totalItems = 0;
      return;
    }

    this.isLoading = true;
    this.backendService.searchUnitsByName(
      this.appService.selectedWorkspaceId,
      unitName,
      this.pageIndex + 1,
      this.pageSize
    ).subscribe({
      next: response => {
        this.unitSearchResults = response.data;
        this.totalItems = response.total;
        this.isLoading = false;
      },
      error: () => {
        this.unitSearchResults = [];
        this.totalItems = 0;
        this.isLoading = false;
      }
    });
  }

  searchResponses(searchParams: { value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string }): void {
    this.isLoading = true;
    // Add 1 to pageIndex because backend uses 1-based indexing
    this.backendService.searchResponses(
      this.appService.selectedWorkspaceId,
      searchParams,
      this.pageIndex + 1,
      this.pageSize
    ).subscribe({
      next: response => {
        this.responseSearchResults = response.data;
        this.totalItems = response.total;
        this.isLoading = false;
      },
      error: () => {
        this.responseSearchResults = [];
        this.totalItems = 0;
        this.isLoading = false;
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  /**
   * Replays a unit in a new tab
   * @param item The unit or response to replay
   */
  replayUnit(item: UnitSearchResult | ResponseSearchResult): void {
    this.appService
      .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
      .subscribe(token => {
        const queryParams = {
          auth: token
        };
        const url = this.router
          .serializeUrl(
            this.router.createUrlTree(
              [`replay/${item.personLogin}@${item.personCode}@${item.bookletId}/${item.unitAlias}/0/0`],
              { queryParams: queryParams })
          );
        window.open(`#/${url}`, '_blank');
      });
  }

  /**
   * Deletes a unit and all its associated responses
   * @param unit The unit to delete
   */
  deleteUnit(unit: UnitSearchResult): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Unit löschen',
        content: `Sind Sie sicher, dass Sie die Unit "${unit.unitName}" (${unit.unitAlias || 'ohne Alias'}) löschen möchten? Alle zugehörigen Antworten werden ebenfalls gelöscht.`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        this.backendService.deleteUnit(
          this.appService.selectedWorkspaceId,
          unit.unitId
        ).subscribe({
          next: response => {
            this.isLoading = false;
            if (response.success) {
              this.unitSearchResults = this.unitSearchResults.filter(u => u.unitId !== unit.unitId);
              this.totalItems -= 1;
              this.snackBar.open(
                `Unit erfolgreich gelöscht. Unit ID: ${response.report.deletedUnit}`,
                'Schließen',
                { duration: 3000 }
              );
            } else {
              this.snackBar.open(
                `Fehler beim Löschen der Unit: ${response.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 5000 }
              );
            }
          },
          error: () => {
            this.isLoading = false;
            this.snackBar.open(
              'Fehler beim Löschen der Unit. Bitte versuchen Sie es später erneut.',
              'Fehler',
              { duration: 5000 }
            );
          }
        });
      }
    });
  }

  /**
   * Deletes a response
   * @param response The response to delete
   */
  deleteResponse(response: ResponseSearchResult): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Antwort löschen',
        content: `Sind Sie sicher, dass Sie die Antwort für Variable "${response.variableId}" löschen möchten?`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        this.backendService.deleteResponse(
          this.appService.selectedWorkspaceId,
          response.responseId
        ).subscribe({
          next: apiResponse => {
            this.isLoading = false;
            if (apiResponse.success) {
              // Remove the response from the results
              this.responseSearchResults = this.responseSearchResults.filter(r => r.responseId !== response.responseId);
              // Update total count
              this.totalItems -= 1;
              // Show success message
              this.snackBar.open(
                `Antwort erfolgreich gelöscht. Antwort ID: ${apiResponse.report.deletedResponse}`,
                'Schließen',
                { duration: 3000 }
              );
            } else {
              // Show error message
              this.snackBar.open(
                `Fehler beim Löschen der Antwort: ${apiResponse.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 5000 }
              );
            }
          },
          error: () => {
            this.isLoading = false;
            this.snackBar.open(
              'Fehler beim Löschen der Antwort. Bitte versuchen Sie es später erneut.',
              'Fehler',
              { duration: 5000 }
            );
          }
        });
      }
    });
  }

  /**
   * Deletes all filtered units
   */
  deleteAllUnits(): void {
    if (this.unitSearchResults.length === 0) {
      this.snackBar.open(
        'Keine Aufgaben zum Löschen gefunden.',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle gefilterten Aufgaben löschen',
        content: `Sind Sie sicher, dass Sie alle ${this.unitSearchResults.length} gefilterten Aufgaben löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Alle löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        const unitIds = this.unitSearchResults.map(unit => unit.unitId);

        this.backendService.deleteMultipleUnits(
          this.appService.selectedWorkspaceId,
          unitIds
        ).subscribe({
          next: response => {
            this.isLoading = false;
            if (response.success) {
              const deletedCount = response.report.deletedUnits.length;

              // Clear the search results
              this.unitSearchResults = [];
              this.totalItems = 0;

              // Show success message
              this.snackBar.open(
                `${deletedCount} Aufgaben erfolgreich gelöscht.`,
                'Schließen',
                { duration: 3000 }
              );
            } else {
              // Show error message
              this.snackBar.open(
                `Fehler beim Löschen der Aufgaben: ${response.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 5000 }
              );
            }
          },
          error: () => {
            this.isLoading = false;
            this.snackBar.open(
              'Fehler beim Löschen der Aufgaben. Bitte versuchen Sie es später erneut.',
              'Fehler',
              { duration: 5000 }
            );
          }
        });
      }
    });
  }

  /**
   * Deletes all filtered responses
   */
  deleteAllResponses(): void {
    if (this.responseSearchResults.length === 0) {
      this.snackBar.open(
        'Keine Antworten zum Löschen gefunden.',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle gefilterten Antworten löschen',
        content: `Sind Sie sicher, dass Sie alle ${this.responseSearchResults.length} gefilterten Antworten löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Alle löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.isLoading = true;
        const responseIds = this.responseSearchResults.map(response => response.responseId);

        this.backendService.deleteMultipleResponses(
          this.appService.selectedWorkspaceId,
          responseIds
        ).subscribe({
          next: response => {
            this.isLoading = false;
            if (response.success) {
              const deletedCount = response.report.deletedResponses.length;

              // Clear the search results
              this.responseSearchResults = [];
              this.totalItems = 0;

              // Show success message
              this.snackBar.open(
                `${deletedCount} Antworten erfolgreich gelöscht.`,
                'Schließen',
                { duration: 3000 }
              );
            } else {
              // Show error message
              this.snackBar.open(
                `Fehler beim Löschen der Antworten: ${response.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 5000 }
              );
            }
          },
          error: () => {
            this.isLoading = false;
            this.snackBar.open(
              'Fehler beim Löschen der Antworten. Bitte versuchen Sie es später erneut.',
              'Fehler',
              { duration: 5000 }
            );
          }
        });
      }
    });
  }
}
