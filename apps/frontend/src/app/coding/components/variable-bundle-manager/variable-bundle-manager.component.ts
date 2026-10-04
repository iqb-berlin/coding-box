import { Subscription } from 'rxjs';
import {
  Component, OnInit, inject, signal, viewChild, effect, ChangeDetectionStrategy, DestroyRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatMenuModule } from '@angular/material/menu';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { VariableBundleService, PaginatedBundles } from '../../services/variable-bundle.service';
import { VariableBundleDialogComponent } from '../variable-bundle-dialog/variable-bundle-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { AppService } from '../../../core/services/app.service';
import { CodingJobBackendService } from '../../services/coding-job-backend.service';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-variable-bundle-manager',
  templateUrl: './variable-bundle-manager.component.html',
  styleUrls: ['./variable-bundle-manager.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
    DatePipe,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatTable,
    MatTableModule,
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
    MatSelectModule,
    MatFormFieldModule,
    MatMenuModule
  ]
})
export class VariableBundleManagerComponent implements OnInit {
  private loadRequest?: Subscription;
  private preparationRequest?: Subscription;
  private readonly ownedDialogs = new Set<MatDialogRef<unknown>>();

  private readonly destroyRef = inject(DestroyRef);

  private variableBundleGroupService = inject(VariableBundleService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private appService = inject(AppService);
  private codingJobBackendService = inject(CodingJobBackendService);

  displayedColumns: string[] = ['actions', 'name', 'description', 'variableCount', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<VariableBundle>([]);
  readonly isLoading = signal(false);

  readonly selectedName = signal<string | null>(null);
  readonly originalData = signal<VariableBundle[]>([]);

  readonly sort = viewChild(MatSort);

  constructor() {
    this.destroyRef.onDestroy(() => this.closeOwnedDialogs());
  }

  ngOnInit(): void {
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.closeOwnedDialogs();
      this.selectedName.set(null);
      this.originalData.set([]);
      this.dataSource.data = [];
      this.loadVariableBundleGroups();
    });
    this.loadVariableBundleGroups();
  }

  private closeOwnedDialogs(): void {
    this.ownedDialogs.forEach(ref => ref.close());
    this.ownedDialogs.clear();
  }

  private ownDialog<T>(ref: MatDialogRef<T>): MatDialogRef<T> {
    this.ownedDialogs.add(ref);
    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.ownedDialogs.delete(ref));
    return ref;
  }

  private readonly synchronizeSort = effect(() => {
    this.dataSource.sort = this.sort() ?? null;
  });

  loadVariableBundleGroups(): void {
    this.loadRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    this.isLoading.set(true);

    this.loadRequest = this.variableBundleGroupService.getBundles(1, 10000).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (paginatedResult: PaginatedBundles) => {
        this.originalData.set(paginatedResult.bundles);
        this.dataSource.data = paginatedResult.bundles;
        this.applyFilters();
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
        this.snackBar.open('Fehler beim Laden der Variablenbündel', 'Schließen', { duration: 3000 });
      }
    });
  }

  onNameFilterChange(): void {
    this.applyFilters();
  }

  private applyFilters(): void {
    let filteredData = this.originalData();

    if (this.selectedName()) {
      filteredData = filteredData.filter(bundle => bundle.name === this.selectedName());
    }

    this.dataSource.data = filteredData;
  }

  createVariableBundleGroup(): void {
    this.preparationRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.preparationRequest = this.codingJobBackendService.getCodingIncompleteVariables(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (incompleteVariables: Variable[]) => {
        const dialogRef = this.ownDialog(this.dialog.open(VariableBundleDialogComponent, {
          width: '900px',
          data: {
            isEdit: false,
            preloadedIncompleteVariables: incompleteVariables
          }
        }));

        dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
          if (result && this.appService.selectedWorkspaceId === workspaceId) {
            this.variableBundleGroupService.createBundle(result).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
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
        this.snackBar.open('Fehler beim Laden der manuell zu kodierenden Variablen', 'Schließen', { duration: 3000 });
      }
    });
  }

  editVariableBundleGroup(bundleGroup: VariableBundle): void {
    this.preparationRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.preparationRequest = this.codingJobBackendService.getCodingIncompleteVariables(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (incompleteVariables: Variable[]) => {
        const dialogRef = this.ownDialog(this.dialog.open(VariableBundleDialogComponent, {
          width: '900px',
          data: {
            bundleGroup,
            isEdit: true,
            preloadedIncompleteVariables: incompleteVariables
          }
        }));

        dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
          if (result && this.appService.selectedWorkspaceId === workspaceId) {
            this.variableBundleGroupService.updateBundle(bundleGroup.id, result).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
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
        this.snackBar.open('Fehler beim Laden der manuell zu kodierenden Variablen', 'Schließen', { duration: 3000 });
      }
    });
  }

  deleteVariableBundleGroup(bundleGroup: VariableBundle): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;
    const dialogRef = this.ownDialog(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Variablenbündel löschen',
        content: `Sind Sie sicher, dass Sie das Variablenbündel "${bundleGroup.name}" löschen möchten?`,
        confirmButtonLabel: 'Löschen',
        showCancel: true
      } as ConfirmDialogData
    }));

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result && this.appService.selectedWorkspaceId === workspaceId) {
        this.variableBundleGroupService.deleteBundle(bundleGroup.id).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
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

  getVariableCount(bundleGroup: VariableBundle): number {
    return bundleGroup.variables.length;
  }

  getVariableBundleActionAriaLabel(action: 'edit' | 'delete' | 'more', bundleGroup: VariableBundle): string {
    switch (action) {
      case 'edit':
        return `Variablenbündel bearbeiten: ${bundleGroup.name}`;
      case 'delete':
        return `Variablenbündel löschen: ${bundleGroup.name}`;
      case 'more':
        return `Weitere Aktionen: ${bundleGroup.name}`;
      default:
        return bundleGroup.name;
    }
  }
}
