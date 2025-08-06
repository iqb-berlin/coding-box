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
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { CodingJob, Variable, VariableBundle } from '../../models/coding-job.model';
import { CodingJobDialogComponent } from '../coding-job-dialog/coding-job-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { Coder } from '../../models/coder.model';
import { CoderService } from '../../services/coder.service';

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
  private coderService = inject(CoderService);

  // Cache for storing coder names by job ID
  private coderNamesByJobId = new Map<number, string>();

  // Cache for storing job details (variables and variable bundles)
  private jobDetailsCache = new Map<number, { variables?: Variable[], variableBundles?: VariableBundle[] }>();

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'status', 'assignedCoders', 'variables', 'variableBundles', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;

  // Sample data for demonstration
  sampleData: CodingJob[] = [
    {
      id: 1,
      name: 'Kodierjob 1',
      description: 'Beschreibung für Kodierjob 1',
      status: 'active',
      createdAt: new Date('2023-01-01'),
      updatedAt: new Date('2023-01-15'),
      assignedCoders: [1, 2]
    },
    {
      id: 2,
      name: 'Kodierjob 2',
      description: 'Beschreibung für Kodierjob 2',
      status: 'completed',
      createdAt: new Date('2023-02-01'),
      updatedAt: new Date('2023-02-15'),
      assignedCoders: [3]
    },
    {
      id: 3,
      name: 'Kodierjob 3',
      description: 'Beschreibung für Kodierjob 3',
      status: 'pending',
      createdAt: new Date('2023-03-01'),
      updatedAt: new Date('2023-03-15'),
      assignedCoders: []
    }
  ];

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
        // Convert string dates to Date objects
        const processedData = response.data.map(job => ({
          ...job,
          createdAt: job.createdAt ? new Date(job.createdAt) : new Date(),
          updatedAt: job.updatedAt ? new Date(job.updatedAt) : new Date()
        }));

        this.dataSource.data = processedData;
        // Clear the cache when loading new data
        this.jobDetailsCache.clear();
        this.isLoading = false;

        // Prefetch details for visible jobs
        this.prefetchJobDetails();
      },
      error: error => {
        console.error('Error loading coding jobs:', error);
        this.snackBar.open('Fehler beim Laden der Kodierjobs', 'Schließen', { duration: 3000 });
        this.isLoading = false;
      }
    });
  }

  /**
   * Prefetches details for visible jobs to improve user experience
   */
  private prefetchJobDetails(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    // Get the first few jobs to prefetch (limit to avoid too many requests)
    const jobsToFetch = this.dataSource.data.slice(0, 5);

    // Fetch details for each job
    jobsToFetch.forEach(job => {
      this.fetchJobDetails(job.id);
    });
  }

  /**
   * Fetches detailed information for a coding job
   * @param jobId The ID of the job to fetch details for
   */
  private fetchJobDetails(jobId: number): void {
    // Check if we already have the details in cache
    if (this.jobDetailsCache.has(jobId)) {
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    // Fetch the job details
    this.backendService.getCodingJob(workspaceId, jobId)
      .pipe(
        catchError(error => {
          console.error(`Error fetching details for job ${jobId}:`, error);
          return of(null);
        })
      )
      .subscribe(job => {
        if (job) {
          // Convert dates to Date objects
          if (job.createdAt) {
            job.createdAt = new Date(job.createdAt);
          }
          if (job.updatedAt) {
            job.updatedAt = new Date(job.updatedAt);
          }

          // Convert dates in variable bundles if they exist
          if (job.variableBundles) {
            job.variableBundles = job.variableBundles.map(bundle => ({
              ...bundle,
              createdAt: bundle.createdAt ? new Date(bundle.createdAt) : new Date(),
              updatedAt: bundle.updatedAt ? new Date(bundle.updatedAt) : new Date()
            }));
          }

          // Store the details in cache
          this.jobDetailsCache.set(jobId, {
            variables: job.variables,
            variableBundles: job.variableBundles
          });

          // Update the job in the data source to ensure dates are formatted correctly
          const dataIndex = this.dataSource.data.findIndex(item => item.id === jobId);
          if (dataIndex >= 0) {
            const updatedData = [...this.dataSource.data];
            updatedData[dataIndex] = {
              ...updatedData[dataIndex],
              ...job
            };
            this.dataSource.data = updatedData;
          }
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
    // Prevent toggling selection when clicking on checkboxes
    if (event && event.target instanceof Element) {
      const target = event.target as Element;
      if (target.tagName === 'MAT-CHECKBOX' ||
          target.classList.contains('mat-checkbox') ||
          target.closest('.mat-checkbox')) {
        return;
      }
    }

    this.selection.toggle(row);

    // Fetch job details when a row is selected
    if (this.selection.isSelected(row)) {
      this.fetchJobDetails(row.id);
    }
  }

  /**
   * Gets the variables assigned to a coding job
   * @param job The coding job
   * @returns A formatted string of variable IDs or a loading message
   */
  getVariables(job: CodingJob): string {
    // Try to get from the job object first
    if (job.variables && job.variables.length > 0) {
      return this.formatVariables(job.variables);
    }

    // Try to get from cache
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variables && cachedDetails.variables.length > 0) {
      return this.formatVariables(cachedDetails.variables);
    }

    // If not in cache, fetch the details
    this.fetchJobDetails(job.id);
    return 'Wird geladen...';
  }

  /**
   * Gets the variable bundles assigned to a coding job
   * @param job The coding job
   * @returns A formatted string of variable bundle names or a loading message
   */
  getVariableBundles(job: CodingJob): string {
    // Try to get from the job object first
    if (job.variableBundles && job.variableBundles.length > 0) {
      return this.formatVariableBundles(job.variableBundles);
    }

    // Try to get from cache
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variableBundles && cachedDetails.variableBundles.length > 0) {
      return this.formatVariableBundles(cachedDetails.variableBundles);
    }

    // If not in cache, fetch the details
    this.fetchJobDetails(job.id);
    return 'Wird geladen...';
  }

  /**
   * Formats variables for display
   * @param variables The variables to format
   * @returns A formatted string of variable IDs
   */
  private formatVariables(variables: Variable[]): string {
    if (!variables || variables.length === 0) {
      return 'Keine Variablen';
    }

    // Limit the number of variables shown to avoid overflow
    const maxToShow = 3;
    const variableIds = variables.map(v => v.variableId);

    if (variableIds.length <= maxToShow) {
      return variableIds.join(', ');
    }

    return `${variableIds.slice(0, maxToShow).join(', ')} +${variableIds.length - maxToShow} weitere`;
  }

  /**
   * Formats variable bundles for display
   * @param bundles The variable bundles to format
   * @returns A formatted string of variable bundle names
   */
  private formatVariableBundles(bundles: VariableBundle[]): string {
    if (!bundles || bundles.length === 0) {
      return 'Keine Variablenbündel';
    }

    // Limit the number of bundles shown to avoid overflow
    const maxToShow = 3;
    const bundleNames = bundles.map(b => b.name);

    if (bundleNames.length <= maxToShow) {
      return bundleNames.join(', ');
    }

    return `${bundleNames.slice(0, maxToShow).join(', ')} +${bundleNames.length - maxToShow} weitere`;
  }

  /**
   * Gets the full list of variables for a tooltip
   * @param job The coding job
   * @returns A formatted string of all variable IDs
   */
  getFullVariables(job: CodingJob): string {
    // Try to get from the job object first
    if (job.variables && job.variables.length > 0) {
      return job.variables.map(v => v.variableId).join(', ');
    }

    // Try to get from cache
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variables && cachedDetails.variables.length > 0) {
      return cachedDetails.variables.map(v => v.variableId).join(', ');
    }

    return 'Keine Variablen';
  }

  /**
   * Gets the full list of variable bundles for a tooltip
   * @param job The coding job
   * @returns A formatted string of all variable bundle names
   */
  getFullVariableBundles(job: CodingJob): string {
    // Try to get from the job object first
    if (job.variableBundles && job.variableBundles.length > 0) {
      return job.variableBundles.map(b => b.name).join(', ');
    }

    // Try to get from cache
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variableBundles && cachedDetails.variableBundles.length > 0) {
      return cachedDetails.variableBundles.map(b => b.name).join(', ');
    }

    return 'Keine Variablenbündel';
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

  /**
   * Gets the next available ID for a new coding job
   */
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

      // Confirm deletion using Angular Material dialog
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

          // Track deletion progress
          let successCount = 0;
          let errorCount = 0;

          // Process each selected job
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
              error: error => {
                errorCount += 1;
                console.error(`Error deleting coding job ${job.id}:`, error);
                this.snackBar.open(`Fehler beim Löschen von Kodierjob "${job.name}"`, 'Schließen', { duration: 3000 });

                // If all jobs have been processed, refresh the list
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

  /**
   * Gets the names of coders assigned to a job (truncated if too many)
   * @param job The coding job
   */
  getAssignedCoderNames(job: CodingJob): string {
    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return 'Keine';
    }

    // Store coder names for this job if we've already fetched them
    if (!this.coderNamesByJobId.has(job.id)) {
      // Fetch coders assigned to this job
      this.coderService.getCodersByJobId(job.id).subscribe({
        next: (coders: Coder[]) => {
          if (coders.length > 0) {
            // Store the formatted names for this job
            const coderNames = coders.map(coder => coder.displayName || coder.name).join(', ');
            this.coderNamesByJobId.set(job.id, coderNames);

            // Refresh the data source to trigger UI update
            const currentData = [...this.dataSource.data];
            this.dataSource.data = currentData;
          } else {
            this.coderNamesByJobId.set(job.id, 'Keine');
          }
        },
        error: () => {
          this.coderNamesByJobId.set(job.id, `${job.assignedCoders.length} Kodierer`);
        }
      });

      // Return a loading indicator while we fetch the names
      return 'Lade Kodierer...';
    }

    // Get the cached coder names for this job
    const coderNames = this.coderNamesByJobId.get(job.id) || `${job.assignedCoders.length} Kodierer`;

    // Truncate the list if it's too long (more than 2 coders)
    if (coderNames !== 'Keine' && coderNames !== 'Lade Kodierer...' && job.assignedCoders.length > 2) {
      const namesList = coderNames.split(', ');
      return `${namesList[0]}, ${namesList[1]} +${job.assignedCoders.length - 2} weitere`;
    }

    return coderNames;
  }

  /**
   * Gets the full list of coder names for the tooltip
   * @param job The coding job
   */
  getFullCoderNames(job: CodingJob): string {
    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return 'Keine Kodierer zugewiesen';
    }

    // If we haven't fetched the names yet, show a loading message
    if (!this.coderNamesByJobId.has(job.id)) {
      return 'Lade Kodierer...';
    }

    // Return the full list of coder names
    return this.coderNamesByJobId.get(job.id) || `${job.assignedCoders.length} Kodierer`;
  }
}
