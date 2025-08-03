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
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { VariableBundle } from '../../models/coding-job.model';
import { VariableBundleService } from '../../services/variable-bundle.service';
import { VariableBundleDialogComponent } from '../variable-bundle-dialog/variable-bundle-dialog.component';

@Component({
  selector: 'coding-box-variable-bundle-manager',
  templateUrl: './variable-bundle-manager.component.html',
  styleUrls: ['./variable-bundle-manager.component.scss'],
  standalone: true,
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
    MatTooltipModule
  ]
})
export class VariableBundleManagerComponent implements OnInit, AfterViewInit {
  private variableBundleGroupService = inject(VariableBundleService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'variableCount', 'createdAt', 'updatedAt', 'actions'];
  dataSource = new MatTableDataSource<VariableBundle>([]);
  selection = new SelectionModel<VariableBundle>(true, []);
  isLoading = false;

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.loadVariableBundleGroups();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  loadVariableBundleGroups(): void {
    this.isLoading = true;

    this.variableBundleGroupService.getBundleGroups().subscribe({
      next: bundleGroups => {
        this.dataSource.data = bundleGroups;
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
        this.snackBar.open('Fehler beim Laden der Variablenbündel', 'Schließen', { duration: 3000 });
      }
    });
  }

  applyFilter(filterValue: string): void {
    this.dataSource.filter = filterValue.trim().toLowerCase();
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

  selectRow(row: VariableBundle): void {
    this.selection.toggle(row);
  }

  createVariableBundleGroup(): void {
    const dialogRef = this.dialog.open(VariableBundleDialogComponent, {
      width: '900px',
      data: {
        isEdit: false
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.variableBundleGroupService.createBundleGroup(result).subscribe({
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
  }

  editVariableBundleGroup(bundleGroup: VariableBundle): void {
    const dialogRef = this.dialog.open(VariableBundleDialogComponent, {
      width: '900px',
      data: {
        bundleGroup,
        isEdit: true
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.variableBundleGroupService.updateBundleGroup(bundleGroup.id, result).subscribe({
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
  }

  deleteVariableBundleGroup(bundleGroup: VariableBundle): void {
    if (confirm(`Sind Sie sicher, dass Sie das Variablenbündel "${bundleGroup.name}" löschen möchten?`)) {
      this.variableBundleGroupService.deleteBundleGroup(bundleGroup.id).subscribe({
        next: success => {
          if (success) {
            this.loadVariableBundleGroups();
            this.snackBar.open(`Variablenbündel "${bundleGroup.name}" wurde gelöscht`, 'Schließen', { duration: 3000 });
          }
        },
        error: error => {
          console.error('Error deleting variable bundle group:', error);
          this.snackBar.open('Fehler beim Löschen des Variablenbündels', 'Schließen', { duration: 3000 });
        }
      });
    }
  }

  deleteSelectedVariableBundleGroups(): void {
    if (this.selection.selected.length === 0) {
      return;
    }

    if (confirm(`Sind Sie sicher, dass Sie ${this.selection.selected.length} ausgewählte Variablenbündel löschen möchten?`)) {
      const deletePromises = this.selection.selected.map(bundleGroup => this.variableBundleGroupService.deleteBundleGroup(bundleGroup.id)
      );

      // Wait for all delete operations to complete
      Promise.all(deletePromises).then(() => {
        this.loadVariableBundleGroups();
        this.selection.clear();
        this.snackBar.open(`${this.selection.selected.length} Variablenbündel wurden gelöscht`, 'Schließen', { duration: 3000 });
      }).catch(error => {
        console.error('Error deleting variable bundle groups:', error);
        this.snackBar.open('Fehler beim Löschen der Variablenbündel', 'Schließen', { duration: 3000 });
      });
    }
  }

  getVariableCount(bundleGroup: VariableBundle): number {
    return bundleGroup.variables.length;
  }
}
