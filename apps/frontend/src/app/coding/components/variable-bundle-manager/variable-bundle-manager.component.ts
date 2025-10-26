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
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { VariableBundle, Variable } from '../../models/coding-job.model';
import { VariableBundleService, PaginatedBundles } from '../../services/variable-bundle.service';
import { VariableBundleDialogComponent } from '../variable-bundle-dialog/variable-bundle-dialog.component';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../../shared/dialogs/confirm-dialog.component';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

@Component({
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
    MatFormFieldModule
  ]
})
export class VariableBundleManagerComponent implements OnInit, AfterViewInit {
  private variableBundleGroupService = inject(VariableBundleService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private appService = inject(AppService);
  private backendService = inject(BackendService);

  displayedColumns: string[] = ['actions', 'name', 'description', 'variableCount', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<VariableBundle>([]);
  isLoading = false;

  selectedName: string | null = null;
  originalData: VariableBundle[] = [];

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.loadVariableBundleGroups();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  loadVariableBundleGroups(): void {
    this.isLoading = true;

    this.variableBundleGroupService.getBundles(1, 10000).subscribe({
      next: (paginatedResult: PaginatedBundles) => {
        this.originalData = paginatedResult.bundles;
        this.dataSource.data = paginatedResult.bundles;
        this.applyFilters();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.snackBar.open('Fehler beim Laden der Variablenbündel', 'Schließen', { duration: 3000 });
      }
    });
  }

  onNameFilterChange(): void {
    this.applyFilters();
  }

  private applyFilters(): void {
    let filteredData = this.originalData;

    if (this.selectedName) {
      filteredData = filteredData.filter(bundle => bundle.name === this.selectedName);
    }

    this.dataSource.data = filteredData;
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

  getVariableCount(bundleGroup: VariableBundle): number {
    return bundleGroup.variables.length;
  }
}
