import {
  Component, Inject, OnInit, ChangeDetectionStrategy, signal, DestroyRef, inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { Router } from '@angular/router';
import {
  Subject, debounceTime, distinctUntilChanged, takeUntil
} from 'rxjs';
import { FileService } from '../../../shared/services/file/file.service';
import { UnitService } from '../../../shared/services/unit/unit.service';
import { ResponseService } from '../../../shared/services/response/response.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { AppService } from '../../../core/services/app.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-unit-search-dialog',
  templateUrl: './unit-search-dialog.component.html',
  styleUrls: ['./unit-search-dialog.component.scss'],
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchCancel$ = new Subject<void>();
  searchText: string = '';
  searchValue: string = '';
  searchVariableId: string = '';
  searchUnitName: string = '';
  searchStatus: string = '';
  searchCodedStatus: string = '';
  searchGroup: string = '';
  searchCode: string = '';

  searchMode: 'unit' | 'response' | 'booklet' = 'unit';

  readonly unitSearchResults = signal<UnitSearchResult[]>([]);
  readonly responseSearchResults = signal<ResponseSearchResult[]>([]);
  readonly bookletSearchResults = signal<BookletSearchResult[]>([]);
  bookletSearchText: string = '';

  readonly isLoading = signal<boolean>(false);
  unitDisplayedColumns: string[] = ['unitName', 'unitAlias', 'bookletName', 'personLogin', 'personCode', 'personGroup', 'tags', 'responseValue', 'actions'];
  responseDisplayedColumns: string[] = ['variableId', 'value', 'status', 'codedStatus', 'unitName', 'unitAlias', 'bookletName', 'personLogin', 'personCode', 'personGroup', 'actions'];
  bookletDisplayedColumns: string[] = ['bookletName', 'personCode', 'personLogin', 'personGroup', 'unitCount', 'actions'];

  private unitSearchSubject = new Subject<string>();
  private responseSearchSubject = new Subject<{ value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string }>();
  private bookletSearchSubject = new Subject<string>();
  private readonly SEARCH_DEBOUNCE_TIME = 500;

  readonly totalItems = signal<number>(0);
  pageSize: number = 10;
  pageIndex: number = 0;
  pageSizeOptions: number[] = [50, 100, 200, 500];

  constructor(
    private dialogRef: MatDialogRef<UnitSearchDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { title: string },
    private fileService: FileService,
    private unitService: UnitService,
    private responseService: ResponseService,
    private testResultService: TestResultService,
    private appService: AppService,
    private router: Router,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) { }

  ngOnInit(): void {
    this.unitSearchSubject.pipe(
      debounceTime(this.SEARCH_DEBOUNCE_TIME),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(searchText => {
      if (this.searchMode !== 'unit') return;
      this.pageIndex = 0;
      this.searchUnits(searchText);
    });

    this.responseSearchSubject.pipe(
      debounceTime(this.SEARCH_DEBOUNCE_TIME),
      distinctUntilChanged((prev, curr) => prev.value === curr.value && prev.variableId === curr.variableId && prev.unitName === curr.unitName && prev.status === curr.status && prev.codedStatus === curr.codedStatus && prev.group === curr.group && prev.code === curr.code),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(searchParams => {
      if (this.searchMode !== 'response') return;
      this.pageIndex = 0;
      this.searchResponses(searchParams);
    });

    this.bookletSearchSubject.pipe(
      debounceTime(this.SEARCH_DEBOUNCE_TIME),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(searchText => {
      if (this.searchMode !== 'booklet') return;
      this.pageIndex = 0;
      this.searchBooklets(searchText);
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

  onBookletSearchChange(): void {
    if (this.bookletSearchText.trim().length > 2) {
      this.bookletSearchSubject.next(this.bookletSearchText);
    }
  }

  onPageChange(event: PageEvent): void {
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;

    if (this.searchMode === 'unit') {
      this.searchUnits(this.searchText);
    } else if (this.searchMode === 'response') {
      this.searchResponses({
        value: this.searchValue.trim() !== '' ? this.searchValue : undefined,
        variableId: this.searchVariableId.trim() !== '' ? this.searchVariableId : undefined,
        unitName: this.searchUnitName.trim() !== '' ? this.searchUnitName : undefined,
        status: this.searchStatus.trim() !== '' ? this.searchStatus : undefined,
        codedStatus: this.searchCodedStatus.trim() !== '' ? this.searchCodedStatus : undefined,
        group: this.searchGroup.trim() !== '' ? this.searchGroup : undefined,
        code: this.searchCode.trim() !== '' ? this.searchCode : undefined
      });
    } else if (this.searchMode === 'booklet') {
      this.searchBooklets(this.bookletSearchText);
    }
  }

  setSearchMode(mode: 'unit' | 'response' | 'booklet'): void {
    if (this.searchMode === mode) {
      return;
    }

    this.searchCancel$.next();
    this.isLoading.set(false);
    this.searchMode = mode;
    this.pageIndex = 0;
    this.totalItems.set(0);
    this.unitSearchResults.set([]);
    this.responseSearchResults.set([]);
    this.bookletSearchResults.set([]);
  }

  searchUnits(unitName: string): void {
    this.searchCancel$.next();
    if (!unitName || unitName.trim().length < 3) {
      this.unitSearchResults.set([]);
      this.totalItems.set(0);
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.testResultService.searchUnitsByName(
      this.appService.selectedWorkspaceId,
      unitName,
      this.pageIndex + 1,
      this.pageSize
    ).pipe(takeUntil(this.searchCancel$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        this.unitSearchResults.set(response.data);
        this.totalItems.set(response.total);
        this.isLoading.set(false);
      },
      error: () => {
        this.unitSearchResults.set([]);
        this.totalItems.set(0);
        this.isLoading.set(false);
      }
    });
  }

  searchResponses(searchParams: { value?: string; variableId?: string; unitName?: string; status?: string; codedStatus?: string; group?: string; code?: string }): void {
    this.searchCancel$.next();
    this.isLoading.set(true);
    this.testResultService.getFlatResponses(
      this.appService.selectedWorkspaceId,
      { ...searchParams, page: this.pageIndex + 1, limit: this.pageSize }
    ).pipe(takeUntil(this.searchCancel$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        this.responseSearchResults.set(response.data.map(r => ({
          responseId: r.responseId,
          variableId: r.response,
          value: r.responseValue,
          status: r.responseStatus,
          unitId: r.unitId,
          unitName: r.unit,
          unitAlias: null, // Alias not available in flat response row
          bookletId: 0, // Booklet ID not available
          bookletName: r.booklet,
          personId: r.personId,
          personLogin: r.login,
          personCode: r.code,
          personGroup: r.group
        })));
        this.totalItems.set(response.total);
        this.isLoading.set(false);
      },
      error: () => {
        this.responseSearchResults.set([]);
        this.totalItems.set(0);
        this.isLoading.set(false);
      }
    });
  }

  searchBooklets(bookletName: string): void {
    this.searchCancel$.next();
    if (!bookletName || bookletName.trim().length < 3) {
      this.bookletSearchResults.set([]);
      this.totalItems.set(0);
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.testResultService.searchBookletsByName(
      this.appService.selectedWorkspaceId,
      bookletName,
      this.pageIndex + 1,
      this.pageSize
    ).pipe(takeUntil(this.searchCancel$), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        this.bookletSearchResults.set(response.data);
        this.totalItems.set(response.total);
        this.isLoading.set(false);
      },
      error: () => {
        this.bookletSearchResults.set([]);
        this.totalItems.set(0);
        this.isLoading.set(false);
      }
    });
  }

  close(): void {
    this.dialogRef.close();
  }

  replayUnit(item: UnitSearchResult | ResponseSearchResult): void {
    const url = this.router
      .serializeUrl(
        this.router.createUrlTree(
          [`replay/${item.personLogin}@${item.personCode}@${item.personGroup}@${item.bookletName}/${item.unitAlias}/0/0`],
          { queryParams: { workspaceId: this.appService.selectedWorkspaceId } })
      );
    window.open(`${window.location.origin}/#${url}`, '_blank');
  }

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

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        this.isLoading.set(true);
        this.unitService.deleteUnit(
          this.appService.selectedWorkspaceId,
          unit.unitId
        ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: response => {
            this.isLoading.set(false);
            if (response.success) {
              this.unitSearchResults.set(this.unitSearchResults().filter(u => u.unitId !== unit.unitId));
              this.totalItems.update(total => total - 1);
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
            this.isLoading.set(false);
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

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        this.isLoading.set(true);
        this.responseService.deleteResponse(
          this.appService.selectedWorkspaceId,
          response.responseId
        ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: apiResponse => {
            this.isLoading.set(false);
            if (apiResponse.success) {
              this.responseSearchResults.set(this.responseSearchResults().filter(r => r.responseId !== response.responseId));
              this.totalItems.update(total => total - 1);
              this.snackBar.open(
                `Antwort erfolgreich gelöscht. Antwort ID: ${apiResponse.report.deletedResponse}`,
                'Schließen',
                { duration: 3000 }
              );
            } else {
              this.snackBar.open(
                `Fehler beim Löschen der Antwort: ${apiResponse.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 5000 }
              );
            }
          },
          error: () => {
            this.isLoading.set(false);
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

  deleteAllUnits(): void {
    if (this.unitSearchResults().length === 0) {
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
        content: `Sind Sie sicher, dass Sie alle ${this.unitSearchResults().length} gefilterten Aufgaben löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Alle löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        this.isLoading.set(true);
        const unitIds = this.unitSearchResults().map(unit => unit.unitId);

        this.unitService.deleteMultipleUnits(
          this.appService.selectedWorkspaceId,
          unitIds
        ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: response => {
            this.isLoading.set(false);
            if (response.success) {
              const deletedCount = response.report.deletedUnits.length;
              this.unitSearchResults.set([]);
              this.totalItems.set(0);
              this.snackBar.open(
                `${deletedCount} Aufgaben erfolgreich gelöscht.`,
                'Schließen',
                { duration: 3000 }
              );
            } else {
              this.snackBar.open(
                `Fehler beim Löschen der Aufgaben: ${response.report.warnings.join(', ')}`,
                'Fehler',
                { duration: 5000 }
              );
            }
          },
          error: () => {
            this.isLoading.set(false);
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

  deleteAllResponses(): void {
    if (this.responseSearchResults().length === 0) {
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
        content: `Sind Sie sicher, dass Sie alle ${this.responseSearchResults().length} gefilterten Antworten löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Alle löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        const responseIds = this.responseSearchResults().map(response => response.responseId);
        let successCount = 0;
        let failCount = 0;
        this.isLoading.set(true);
        const processNextResponse = (index: number) => {
          if (index >= responseIds.length) {
            this.isLoading.set(false);
            this.snackBar.open(
              `${successCount} Antworten gelöscht, ${failCount} fehlgeschlagen.`,
              'OK',
              { duration: 5000 }
            );
            this.searchResponses({
              value: this.searchValue.trim() !== '' ? this.searchValue : undefined,
              variableId: this.searchVariableId.trim() !== '' ? this.searchVariableId : undefined,
              unitName: this.searchUnitName.trim() !== '' ? this.searchUnitName : undefined,
              status: this.searchStatus.trim() !== '' ? this.searchStatus : undefined,
              codedStatus: this.searchCodedStatus.trim() !== '' ? this.searchCodedStatus : undefined,
              group: this.searchGroup.trim() !== '' ? this.searchGroup : undefined,
              code: this.searchCode.trim() !== '' ? this.searchCode : undefined
            });
            return;
          }

          this.responseService.deleteResponse(
            this.appService.selectedWorkspaceId,
            responseIds[index]
          ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: response => {
              if (response.success) {
                successCount += 1;
              } else {
                failCount += 1;
              }
              processNextResponse(index + 1);
            },
            error: () => {
              failCount += 1;
              processNextResponse(index + 1);
            }
          });
        };
        processNextResponse(0);
      }
    });
  }

  viewBookletInfo(booklet: BookletSearchResult): void {
    const loadingSnackBar = this.snackBar.open(
      'Lade Testheft-Informationen...',
      '',
      { duration: 3000 }
    );

    this.fileService.getBookletInfo(
      this.appService.selectedWorkspaceId,
      booklet.bookletName
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (bookletInfo: BookletInfoDto) => {
        loadingSnackBar.dismiss();

        this.dialog.open(BookletInfoDialogComponent, {
          width: 'min(96vw, 1400px)',
          maxWidth: '96vw',
          height: '92vh',
          maxHeight: '92vh',
          data: {
            bookletInfo,
            bookletId: booklet.bookletName
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Testheft-Informationen',
          'Fehler',
          { duration: 3000 }
        );
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

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        this.isLoading.set(true);
        this.testResultService.deleteBooklet(
          this.appService.selectedWorkspaceId,
          booklet.bookletId
        ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          next: (response: { success: boolean; report: { warnings: string[] } }) => {
            if (response.success) {
              this.bookletSearchResults.set(this.bookletSearchResults().filter(
                b => b.bookletId !== booklet.bookletId
              ));
              this.totalItems.update(total => total - 1);

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
            this.isLoading.set(false);
          },
          error: () => {
            this.snackBar.open(
              'Fehler beim Löschen des Booklets. Bitte versuchen Sie es erneut.',
              'OK',
              { duration: 5000 }
            );
            this.isLoading.set(false);
          }
        });
      }
    });
  }

  deleteAllBooklets(): void {
    if (this.bookletSearchResults().length === 0) {
      this.snackBar.open(
        'Keine Booklets zum Löschen gefunden.',
        'Info',
        { duration: 3000 }
      );
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Alle gefilterten Booklets löschen',
        content: `Sind Sie sicher, dass Sie alle ${this.bookletSearchResults().length} gefilterten Booklets löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.`,
        confirmButtonLabel: 'Alle löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result) {
        const bookletIds = this.bookletSearchResults().map(booklet => booklet.bookletId);
        let successCount = 0;
        let failCount = 0;
        this.isLoading.set(true);
        const processNextBooklet = (index: number) => {
          if (index >= bookletIds.length) {
            this.isLoading.set(false);
            this.snackBar.open(
              `${successCount} Booklets gelöscht, ${failCount} fehlgeschlagen.`,
              'OK',
              { duration: 5000 }
            );
            this.searchBooklets(this.bookletSearchText);
            return;
          }

          this.testResultService.deleteBooklet(
            this.appService.selectedWorkspaceId,
            bookletIds[index]
          ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: (response: { success: boolean }) => {
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
        processNextBooklet(0);
      }
    });
  }
}
