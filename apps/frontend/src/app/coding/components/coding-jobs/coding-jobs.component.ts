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
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatAnchor, MatButton } from '@angular/material/button';
import { DatePipe, NgClass } from '@angular/common';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { CodingJob } from '../../models/coding-job.model';

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
    MatButton
  ]
})
export class CodingJobsComponent implements OnInit, AfterViewInit {
  appService = inject(AppService);
  backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'status', 'createdAt', 'updatedAt'];
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
    this.snackBar.open('Funktion zum Erstellen eines Kodierjobs noch nicht implementiert', 'Schließen', { duration: 3000 });
  }

  editCodingJob(): void {
    if (this.selection.selected.length === 1) {
      const selectedJob = this.selection.selected[0];
      this.snackBar.open(`Bearbeiten von Kodierjob "${selectedJob.name}" noch nicht implementiert`, 'Schließen', { duration: 3000 });
    }
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
}
