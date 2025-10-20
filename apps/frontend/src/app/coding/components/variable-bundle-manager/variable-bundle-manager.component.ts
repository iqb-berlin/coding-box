import {
  Component, OnInit, ViewChild, AfterViewInit, inject
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatSort, MatSortModule } from '@angular/material/sort';
import {
  MatCell, MatCellDef, MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef,
  MatRow, MatRowDef,
  MatTable,
  MatTableDataSource,
  MatTableModule
} from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  MatPaginator, MatPaginatorModule, MatPaginatorIntl, PageEvent
} from '@angular/material/paginator';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { VariableBundleService, PaginatedBundles } from '../../services/variable-bundle.service';
import { VariableBundleDialogComponent } from '../variable-bundle-dialog/variable-bundle-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { GermanPaginatorIntl } from '../../../shared/services/german-paginator-intl.service';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

@Component({
  selector: 'coding-box-variable-bundle-manager',
  templateUrl: './variable-bundle-manager.component.html',
  styleUrls: ['./variable-bundle-manager.component.scss'],
  standalone: true,
  providers: [
    { provide: MatPaginatorIntl, useClass: GermanPaginatorIntl }
  ],
  imports: [
    CommonModule,
    TranslateModule,
    DatePipe,
    SearchFilterComponent,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatCheckbox,
    MatTable,
    MatTableModule,
    MatAnchor,
    MatHeaderCellDef,
    MatCellDef,
    MatHeaderRowDef,
    MatRowDef,
    MatColumnDef,
    MatSortModule,
    MatButton,
    MatDialogModule,
    MatTooltipModule,
    MatIconButton,
    MatPaginatorModule
  ]
})
export class VariableBundleManagerComponent implements OnInit, AfterViewInit {
  private variableBundleGroupService = inject(VariableBundleService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private appService = inject(AppService);
  private backendService = inject(BackendService);

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'variableCount', 'createdAt', 'updatedAt', 'actions'];
  dataSource = new MatTableDataSource<VariableBundle>([]);
  selection = new SelectionModel<VariableBundle>(true, []);
  isLoading = false;

  currentPage = 1;
  pageSize = 10;
  totalItems = 0;

  @ViewChild(MatSort) sort!: MatSort;
  @ViewChild(MatPaginator) paginator!: MatPaginator;

  ngOnInit(): void {
    this.loadVariableBundleGroups();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;

    if (this.paginator) {
      this.paginator.pageIndex = this.currentPage - 1;
      this.paginator.pageSize = this.pageSize;
      this.paginator.length = this.totalItems;
    }
  }

  loadVariableBundleGroups(page: number = this.currentPage, pageSize: number = this.pageSize): void {
    this.isLoading = true;

    this.variableBundleGroupService.getBundles(page, pageSize).subscribe({
      next: (paginatedResult: PaginatedBundles) => {
        this.dataSource.data = paginatedResult.bundles;

        if (this.currentFilter) {
          this.dataSource.filter = this.currentFilter;
        }

        this.totalItems = paginatedResult.total;
        this.currentPage = paginatedResult.page;
        this.pageSize = paginatedResult.limit;

        if (this.paginator) {
          this.paginator.pageIndex = this.currentPage - 1;
          this.paginator.pageSize = this.pageSize;
          this.paginator.length = this.totalItems;
        }

        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.snackBar.open('Fehler beim Laden der Variablenbündel', 'Schließen', { duration: 3000 });
      }
    });
  }

  onPageChange(event: PageEvent): void {
    const page = event.pageIndex + 1;
    const pageSize = event.pageSize;
    this.loadVariableBundleGroups(page, pageSize);
  }

  currentFilter: string = '';

  applyFilter(filterValue: string): void {
    this.currentFilter = filterValue.trim().toLowerCase();
    this.dataSource.filter = this.currentFilter;
    if (this.paginator) {
      this.paginator.firstPage();
    }
    this.loadVariableBundleGroups(1, this.pageSize);
  }

  isAllSelected(): boolean {
    const numSelected = this.selection.selected.length;
    const numRows = this.dataSource.data.length;
    return numSelected === numRows;
  }

  isIndeterminate(): boolean {
    return this.selection.selected.length > 0 && !this.isAllSelected();
  }

  masterToggle(): void {
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.dataSource.data.forEach(row => this.selection.select(row));
    }
  }

  selectRow(row: VariableBundle, event?: MouseEvent): void {
    if (event && event.target instanceof Element) {
      const target = event.target as Element;
      if (target.tagName === 'MAT-CHECKBOX' ||
          target.classList.contains('mat-checkbox') ||
          target.closest('.mat-checkbox')) {
        return;
      }
    }
    this.selection.toggle(row);
  }

  createVariableBundleGroup(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.backendService.getCodingIncompleteVariables(workspaceId).subscribe({
      next: (incompleteVariables: Variable[]) => {
        const dialogRef = this.dialog.open(VariableBundleDialogComponent, {
          width: '900px',
          data: {
            isEdit: false,
            preloadedIncompleteVariables: incompleteVariables
          }
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result) {
            this.variableBundleGroupService.createBundle(result).subscribe({
              next: newBundleGroup => {
                this.loadVariableBundleGroups();
                this.snackBar.open(`Variablenbündel "${newBundleGroup.name}" wurde erstellt`, 'Schließen', { duration: 3000 });
              },
              error: () => {
                this.snackBar.open('Fehler beim Erstellen des Variablenbündels', 'Schließen', { duration: 3000 });
              }
            });
          }
        });
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der CODING_INCOMPLETE Variablen', 'Schließen', { duration: 3000 });
      }
    });
  }

  editVariableBundleGroup(bundleGroup: VariableBundle): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.backendService.getCodingIncompleteVariables(workspaceId).subscribe({
      next: (incompleteVariables: Variable[]) => {
        const dialogRef = this.dialog.open(VariableBundleDialogComponent, {
          width: '900px',
          data: {
            bundleGroup,
            isEdit: true,
            preloadedIncompleteVariables: incompleteVariables
          }
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result) {
            this.variableBundleGroupService.updateBundle(bundleGroup.id, result).subscribe({
              next: updatedBundleGroup => {
                if (updatedBundleGroup) {
                  this.loadVariableBundleGroups();
                  this.snackBar.open(`Variablenbündel "${updatedBundleGroup.name}" wurde aktualisiert`, 'Schließen', { duration: 3000 });
                }
              },
              error: () => {
                this.snackBar.open('Fehler beim Aktualisieren des Variablenbündels', 'Schließen', { duration: 3000 });
              }
            });
          }
        });
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der CODING_INCOMPLETE Variablen', 'Schließen', { duration: 3000 });
      }
    });
  }

  deleteVariableBundleGroup(bundleGroup: VariableBundle): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Variablenbündel löschen',
        content: `Sind Sie sicher, dass Sie das Variablenbündel "${bundleGroup.name}" löschen möchten?`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.variableBundleGroupService.deleteBundle(bundleGroup.id).subscribe({
          next: success => {
            if (success) {
              this.loadVariableBundleGroups();
              this.snackBar.open(`Variablenbündel "${bundleGroup.name}" wurde gelöscht`, 'Schließen', { duration: 3000 });
            }
          },
          error: () => {
            this.snackBar.open('Fehler beim Löschen des Variablenbündels', 'Schließen', { duration: 3000 });
          }
        });
      }
    });
  }

  deleteSelectedVariableBundleGroups(): void {
    if (this.selection.selected.length === 0) {
      return;
    }

    const selectedBundles = [...this.selection.selected];
    const selectedCount = selectedBundles.length;
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Variablenbündel löschen',
        content: `Sind Sie sicher, dass Sie ${selectedCount} ausgewählte Variablenbündel löschen möchten?`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      } as ConfirmDialogData
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        import('rxjs').then(({ forkJoin }) => {
          const deleteObservables = selectedBundles.map(bundleGroup => this.variableBundleGroupService.deleteBundle(bundleGroup.id));

          forkJoin(deleteObservables).subscribe({
            next: results => {
              this.loadVariableBundleGroups();
              this.selection.clear();
              const successCount = results.filter(success => success).length;
              this.snackBar.open(`${successCount} Variablenbündel wurden gelöscht`, 'Schließen', { duration: 3000 });
            },
            error: () => {
              this.snackBar.open('Fehler beim Löschen der Variablenbündel', 'Schließen', { duration: 3000 });
            }
          });
        });
      }
    });
  }

  getVariableCount(bundleGroup: VariableBundle): number {
    return bundleGroup.variables.length;
  }
}
