import {
  Component, OnInit, ViewChild, AfterViewInit, inject, Input
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
import { CodingJob } from '../../models/coding-job.model';
import { CodingJobDialogComponent } from '../coding-job-dialog/coding-job-dialog.component';
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

  @Input() selectedCoder: Coder | null = null;

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'status', 'assignedCoders', 'createdAt', 'updatedAt'];
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

    setTimeout(() => {
      this.dataSource.data = this.sampleData;
      this.isLoading = false;
    }, 500);
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

  selectRow(row: CodingJob): void {
    this.selection.toggle(row);
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
        const newCodingJob: CodingJob = {
          ...result,
          id: newId
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
            const updatedData = [...currentData];
            updatedData[index] = result;
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
      this.snackBar.open(`Löschen von ${count} Kodierjob(s) noch nicht implementiert`, 'Schließen', { duration: 3000 });
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
   * Assigns the selected coding jobs to the selected coder
   */
  assignToCoder(): void {
    if (!this.selectedCoder) {
      this.snackBar.open('Bitte wählen Sie zuerst einen Kodierer aus', 'Schließen', { duration: 3000 });
      return;
    }

    if (this.selection.selected.length === 0) {
      this.snackBar.open('Bitte wählen Sie mindestens einen Kodierjob aus', 'Schließen', { duration: 3000 });
      return;
    }

    const coderId = this.selectedCoder.id;
    const selectedJobs = this.selection.selected;
    let assignedCount = 0;

    // Assign each selected job to the coder
    selectedJobs.forEach(job => {
      this.coderService.assignJob(coderId, job.id).subscribe({
        next: updatedCoder => {
          if (updatedCoder) {
            assignedCount += 1;

            // Update the job in the data source to reflect the assignment
            const jobIndex = this.dataSource.data.findIndex(j => j.id === job.id);
            if (jobIndex !== -1) {
              const updatedJob = { ...this.dataSource.data[jobIndex] };

              // Add the coder to the job's assignedCoders array if not already there
              if (!updatedJob.assignedCoders.includes(coderId)) {
                updatedJob.assignedCoders = [...updatedJob.assignedCoders, coderId];

                // Update the data source
                const updatedData = [...this.dataSource.data];
                updatedData[jobIndex] = updatedJob;
                this.dataSource.data = updatedData;
              }
            }

            // Show success message when all jobs have been processed
            if (assignedCount === selectedJobs.length) {
              const jobText = selectedJobs.length === 1 ? 'Kodierjob' : 'Kodierjobs';
              this.snackBar.open(
                `${selectedJobs.length} ${jobText} wurde(n) ${this.selectedCoder!.displayName} zugewiesen`,
                'Schließen',
                { duration: 3000 }
              );
            }
          }
        },
        error: () => {
          this.snackBar.open(
            `Fehler beim Zuweisen des Kodierjobs an ${this.selectedCoder!.displayName}`,
            'Schließen',
            { duration: 3000 }
          );
        }
      });
    });
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
        next: coders => {
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
