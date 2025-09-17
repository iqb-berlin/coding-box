import {
  Component, OnInit, ViewChild, AfterViewInit, inject
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { MatSort, MatSortModule } from '@angular/material/sort';
import {
  MatCell, MatCellDef, MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow, MatHeaderRowDef,
  MatRow, MatRowDef,
  MatTable,
  MatTableDataSource
} from '@angular/material/table';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe, NgClass } from '@angular/common';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { CodingJob, Variable, VariableBundle } from '../../models/coding-job.model';
import { CodingJobDialogComponent } from '../coding-job-dialog/coding-job-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'coding-box-coding-jobs',
  templateUrl: './coding-jobs.component.html',
  styleUrls: ['./coding-jobs.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    DatePipe,
    NgClass,
    SearchFilterComponent,
    MatIcon,
    MatHeaderCell,
    MatCell,
    MatHeaderRow,
    MatRow,
    MatProgressSpinner,
    MatCheckbox,
    MatTable,
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
export class CodingJobsComponent implements OnInit, AfterViewInit {
  appService = inject(AppService);
  backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  private coderNamesByJobId = new Map<number, string>();

  private jobDetailsCache = new Map<number, { variables?: Variable[], variableBundles?: VariableBundle[] }>();

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'status', 'assignedCoders', 'variables', 'variableBundles', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.loadCodingJobs();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  loadCodingJobs(): void {
    this.isLoading = true;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.isLoading = false;
      return;
    }

    this.backendService.getCodingJobs(workspaceId).subscribe({
      next: response => {
        this.coderNamesByJobId.clear();
        const processedData = response.data.map(job => {
          if (job.assignedCoders && job.assignedCoders.length > 0) {
            this.coderNamesByJobId.set(job.id, `${job.assignedCoders.length} Kodierer`);
          } else {
            this.coderNamesByJobId.set(job.id, 'Keine');
          }

          return {
            ...job,
            createdAt: job.createdAt ? new Date(job.createdAt) : new Date(),
            updatedAt: job.updatedAt ? new Date(job.updatedAt) : new Date()
          };
        });

        this.dataSource.data = processedData;
        this.jobDetailsCache.clear();
        this.isLoading = false;
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der Kodierjobs', 'Schließen', { duration: 3000 });
        this.isLoading = false;
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

  selectRow(row: CodingJob, event?: MouseEvent): void {
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

  getVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      return this.formatAssignedVariables(job.assignedVariables);
    }
    return 'Keine Variablen';
  }

  getVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const count = job.assignedVariableBundles.length;
      const maxToShow = 2;
      const bundleNames = job.assignedVariableBundles.map(b => b.name);

      if (bundleNames.length <= maxToShow) {
        return `${count} (${bundleNames.join(', ')})`;
      }

      const preview = bundleNames.slice(0, maxToShow).join(', ');
      return `${count} (${preview}, +${count - maxToShow} weitere)`;
    }

    return 'Keine Variablen-Bundles';
  }

  private formatAssignedVariables(assignedVariables: Variable[]): string {
    if (!assignedVariables || assignedVariables.length === 0) {
      return 'Keine Variablen';
    }

    const maxToShow = 3;
    const variableNames = assignedVariables.map(v => `${v.unitName}_${v.variableId}`);

    if (variableNames.length <= maxToShow) {
      return variableNames.join(', ');
    }

    return `${variableNames.slice(0, maxToShow).join(', ')} +${variableNames.length - maxToShow} weitere`;
  }

  private formatVariableBundles(bundles: VariableBundle[]): string {
    if (!bundles || bundles.length === 0) {
      return 'Keine Variablenbündel';
    }
    const maxToShow = 3;
    const bundleNames = bundles.map(b => b.name);

    if (bundleNames.length <= maxToShow) {
      return bundleNames.join(', ');
    }

    return `${bundleNames.slice(0, maxToShow).join(', ')} +${bundleNames.length - maxToShow} weitere`;
  }

  getFullVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      const variableNames = job.assignedVariables.map(v => `${v.unitName}_${v.variableId}`);
      return `Variablen (${job.assignedVariables.length}): ${variableNames.join(', ')}`;
    }
    if (job.variables && job.variables.length > 0) {
      return job.variables.map(v => `${v.unitName}_${v.variableId}`).join(', ');
    }
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variables && cachedDetails.variables.length > 0) {
      return cachedDetails.variables.map(v => `${v.unitName}_${v.variableId}`).join(', ');
    }

    return 'Keine Variablen zugewiesen';
  }

  getFullVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const bundleNames = job.assignedVariableBundles.map(b => b.name);
      return `Variablen-Bündel (${job.assignedVariableBundles.length}): ${bundleNames.join(', ')}`;
    }

    if (job.variableBundles && job.variableBundles.length > 0) {
      return job.variableBundles.map(b => b.name).join(', ');
    }

    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variableBundles && cachedDetails.variableBundles.length > 0) {
      return cachedDetails.variableBundles.map(b => b.name).join(', ');
    }

    return 'Keine Variablen-Bündel zugewiesen';
  }

  createCodingJob(): void {
    const dialogRef = this.dialog.open(CodingJobDialogComponent, {
      width: '900px',
      data: {
        isEdit: false
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const newId = this.getNextId();
        // Ensure dates are Date objects
        const now = new Date();
        const newCodingJob: CodingJob = {
          ...result,
          id: newId,
          createdAt: now,
          updatedAt: now
        };
        const currentData = this.dataSource.data;
        this.dataSource.data = [...currentData, newCodingJob];
        this.snackBar.open(`Kodierjob "${newCodingJob.name}" wurde erstellt`, 'Schließen', { duration: 3000 });
      }
    });
  }

  editCodingJob(): void {
    if (this.selection.selected.length === 1) {
      const selectedJob = this.selection.selected[0];

      const dialogRef = this.dialog.open(CodingJobDialogComponent, {
        width: '900px',
        data: {
          codingJob: selectedJob,
          isEdit: true
        }
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result) {
          const currentData = this.dataSource.data;
          const index = currentData.findIndex(job => job.id === result.id);

          if (index !== -1) {
            // Preserve the original createdAt and ensure updatedAt is a Date object
            const updatedData = [...currentData];
            const now = new Date();

            // Handle createdAt date properly
            let createdAtDate = now;
            if (selectedJob.createdAt instanceof Date) {
              createdAtDate = selectedJob.createdAt;
            } else if (selectedJob.createdAt) {
              createdAtDate = new Date(selectedJob.createdAt);
            }

            updatedData[index] = {
              ...result,
              createdAt: createdAtDate,
              updatedAt: now
            };

            this.dataSource.data = updatedData;

            this.snackBar.open(`Kodierjob "${result.name}" wurde aktualisiert`, 'Schließen', { duration: 3000 });
          }
        }
      });
    }
  }

  private getNextId(): number {
    const jobs = this.dataSource.data;
    return jobs.length > 0 ?
      Math.max(...jobs.map(job => job.id)) + 1 :
      1;
  }

  deleteCodingJobs(): void {
    if (this.selection.selected.length > 0) {
      const count = this.selection.selected.length;
      const jobNames = this.selection.selected.map(job => job.name).join(', ');

      const confirmMessage = count === 1 ?
        `Möchten Sie den Kodierjob "${jobNames}" wirklich löschen?` :
        `Möchten Sie ${count} Kodierjobs wirklich löschen?`;

      const dialogRef = this.dialog.open(ConfirmDialogComponent, {
        width: '400px',
        data: {
          title: 'Löschen bestätigen',
          message: confirmMessage,
          confirmButtonText: 'Löschen',
          cancelButtonText: 'Abbrechen'
        }
      });

      dialogRef.afterClosed().subscribe(result => {
        if (result) {
          const workspaceId = this.appService.selectedWorkspaceId;
          if (!workspaceId) {
            this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
            return;
          }

          let successCount = 0;
          let errorCount = 0;

          this.selection.selected.forEach(job => {
            this.backendService.deleteCodingJob(workspaceId, job.id).subscribe({
              next: response => {
                if (response.success) {
                  successCount += 1;

                  // If all jobs have been processed, show success message and refresh the list
                  if (successCount + errorCount === this.selection.selected.length) {
                    const message = count === 1 ?
                      `Kodierjob "${jobNames}" wurde erfolgreich gelöscht` :
                      `${successCount} von ${count} Kodierjobs wurden erfolgreich gelöscht`;

                    this.snackBar.open(message, 'Schließen', { duration: 3000 });
                    this.selection.clear();
                    this.loadCodingJobs();
                  }
                } else {
                  errorCount += 1;
                  this.snackBar.open(`Fehler beim Löschen von Kodierjob "${job.name}"`, 'Schließen', { duration: 3000 });
                }
              },
              error: () => {
                errorCount += 1;
                this.snackBar.open(`Fehler beim Löschen von Kodierjob "${job.name}"`, 'Schließen', { duration: 3000 });
                if (successCount + errorCount === this.selection.selected.length) {
                  this.loadCodingJobs();
                }
              }
            });
          });
        }
      });
    }
  }

  startCodingJob(): void {
    if (this.selection.selected.length === 1) {
      const selectedJob = this.selection.selected[0];
      this.snackBar.open(`Starten von Kodierjob "${selectedJob.name}" noch nicht implementiert`, 'Schließen', { duration: 3000 });
    }
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'status-active';
      case 'completed':
        return 'status-completed';
      case 'pending':
        return 'status-pending';
      default:
        return '';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'active':
        return 'Aktiv';
      case 'completed':
        return 'Abgeschlossen';
      case 'pending':
        return 'Ausstehend';
      default:
        return status;
    }
  }

  getAssignedCoderNames(job: CodingJob): string {
    if (this.coderNamesByJobId.has(job.id)) {
      const coderNames = this.coderNamesByJobId.get(job.id)!;

      if (coderNames !== 'Keine' && coderNames.includes(',') && job.assignedCoders && job.assignedCoders.length > 2) {
        const namesList = coderNames.split(', ');
        return `${namesList[0]}, ${namesList[1]} +${job.assignedCoders.length - 2} weitere`;
      }

      return coderNames;
    }

    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return 'Keine';
    }

    return `${job.assignedCoders.length} Kodierer`;
  }

  getFullCoderNames(job: CodingJob): string {
    if (this.coderNamesByJobId.has(job.id)) {
      return this.coderNamesByJobId.get(job.id) || `${job.assignedCoders?.length || 0} Kodierer`;
    }

    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return 'Keine Kodierer zugewiesen';
    }

    return `${job.assignedCoders.length} Kodierer`;
  }
}
