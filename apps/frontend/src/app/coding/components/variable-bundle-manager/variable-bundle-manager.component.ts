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
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import { CodingPermissionsService } from '../../services/coding-permissions.service';
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
  private readonly uiTranslate = injectUiTranslator();

  readonly permissions = inject(CodingPermissionsService);
  private loadRequest?: Subscription;
  private preparationRequest?: Subscription;
  private readonly ownedDialogs = new Set<MatDialogRef<unknown>>();

  private readonly destroyRef = inject(DestroyRef);

  private variableBundleGroupService = inject(VariableBundleService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private appService = inject(AppService);
  private codingJobBackendService = inject(CodingJobBackendService);

  protected displayedColumns: string[] = ['actions', 'name', 'description', 'variableCount', 'createdAt', 'updatedAt'];
  protected dataSource = new MatTableDataSource<VariableBundle>([]);
  readonly isLoading = signal(false);

  protected readonly selectedName = signal<string | null>(null);
  protected readonly originalData = signal<VariableBundle[]>([]);

  readonly sort = viewChild(MatSort);

  constructor() {
    this.destroyRef.onDestroy(() => this.closeOwnedDialogs());
  }

  ngOnInit(): void {
    if (this.appService.selectedWorkspaceId) this.permissions.load(this.appService.selectedWorkspaceId);
    this.appService.selectedWorkspaceId$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.appService.selectedWorkspaceId) this.permissions.load(this.appService.selectedWorkspaceId);
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
        this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.load-failed'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      }
    });
  }

  protected onNameFilterChange(): void {
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
    if (!this.permissions.canCreate) return;
    this.preparationRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
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
                this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.create-success', { name: newBundleGroup.name }), this.uiTranslate('deferred-view.close'), { duration: 3000 });
              },
              error: () => {
                this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.create-failed'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
              }
            });
          }
        });
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.variables-load-failed'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      }
    });
  }

  editVariableBundleGroup(bundleGroup: VariableBundle): void {
    this.preparationRequest?.unsubscribe();
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open(this.uiTranslate('error.noWorkspaceSelected'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      return;
    }

    this.preparationRequest = this.codingJobBackendService.getCodingIncompleteVariables(workspaceId).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (incompleteVariables: Variable[]) => {
        const dialogRef = this.ownDialog(this.dialog.open(VariableBundleDialogComponent, {
          width: '900px',
          data: {
            bundleGroup,
            isEdit: true,
            readOnly: !this.permissions.canEdit(bundleGroup),
            preloadedIncompleteVariables: incompleteVariables
          }
        }));

        dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
          if (result && this.permissions.canEdit(bundleGroup) && this.appService.selectedWorkspaceId === workspaceId) {
            this.variableBundleGroupService.updateBundle(bundleGroup.id, result).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
              next: updatedBundleGroup => {
                if (updatedBundleGroup) {
                  this.loadVariableBundleGroups();
                  this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.update-success', { name: updatedBundleGroup.name }), this.uiTranslate('deferred-view.close'), { duration: 3000 });
                }
              },
              error: () => {
                this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.update-failed'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
              }
            });
          }
        });
      },
      error: () => {
        this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.variables-load-failed'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
      }
    });
  }

  deleteVariableBundleGroup(bundleGroup: VariableBundle): void {
    if (!this.permissions.canEdit(bundleGroup)) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) return;
    const dialogRef = this.ownDialog(this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: this.uiTranslate('ui-text.variable-bundle-manager.delete-title'),
        content: this.uiTranslate('ui-text.variable-bundle-manager.delete-confirmation', { name: bundleGroup.name }),
        confirmButtonLabel: this.uiTranslate('delete'),
        showCancel: true
      } as ConfirmDialogData
    }));

    dialogRef.afterClosed().pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe(result => {
      if (result && this.appService.selectedWorkspaceId === workspaceId) {
        this.variableBundleGroupService.deleteBundle(bundleGroup.id).pipe(takeUntilWorkspaceChanged(this.appService, workspaceId), takeUntilDestroyed(this.destroyRef)).subscribe({
          next: success => {
            if (success) {
              this.loadVariableBundleGroups();
              this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.delete-success', { name: bundleGroup.name }), this.uiTranslate('deferred-view.close'), { duration: 3000 });
            }
          },
          error: () => {
            this.snackBar.open(this.uiTranslate('ui-text.variable-bundle-manager.delete-failed'), this.uiTranslate('deferred-view.close'), { duration: 3000 });
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
        return this.uiTranslate('ui-text.variable-bundle-manager.edit-aria', { name: bundleGroup.name });
      case 'delete':
        return this.uiTranslate('ui-text.variable-bundle-manager.delete-aria', { name: bundleGroup.name });
      case 'more':
        return `Weitere Aktionen: ${bundleGroup.name}`;
      default:
        return bundleGroup.name;
    }
  }
}
