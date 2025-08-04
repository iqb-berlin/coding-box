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
import { MatAnchor, MatButton } from '@angular/material/button';
import { DatePipe, NgClass } from '@angular/common';
import { Router } from '@angular/router';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
import { CodingJob } from '../../models/coding-job.model';
import { WorkspaceUserDto } from '../../../../../../../api-dto/workspaces/workspace-user-dto';
import { CoderService } from '../../services/coder.service';

@Component({
  selector: 'coding-box-my-coding-jobs',
  templateUrl: './my-coding-jobs.component.html',
  styleUrls: ['./my-coding-jobs.component.scss'],
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
export class MyCodingJobsComponent implements OnInit, AfterViewInit {
  appService = inject(AppService);
  backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private coderService = inject(CoderService);

  displayedColumns: string[] = ['name', 'description', 'status', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;
  currentUserId = 0;
  isAuthorized = false;

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.appService.authData$.subscribe(authData => {
      this.currentUserId = authData.userId;
      if (authData.workspaces && authData.workspaces.length > 0) {
        this.checkUserAccessLevel();
      } else {
        this.router.navigate(['/']);
        this.snackBar.open('Sie haben keinen Zugriff auf diese Seite', 'Schließen', { duration: 3000 });
      }
    });
  }

  private checkUserAccessLevel(): void {
    this.backendService.getWorkspaceUsers(1).subscribe(users => {
      const currentUser = users.data.find((user: WorkspaceUserDto) => user.userId === this.currentUserId);
      if (currentUser && currentUser.accessLevel === 1) {
        this.isAuthorized = true;
        this.loadMyCodingJobs();
      } else {
        this.router.navigate(['/']);
        this.snackBar.open(
          'Sie haben keinen Zugriff auf diese Seite. Nur Kodierer können auf diese Seite zugreifen.',
          'Schließen',
          { duration: 3000 }
        );
      }
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  loadMyCodingJobs(): void {
    this.isLoading = true;

    const sampleJobs = [
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
        assignedCoders: [1]
      }
    ];

    this.coderService.getCodersByJobId(this.currentUserId).subscribe({
      next: coders => {
        if (coders.length > 0) {
          const currentCoder = coders[0];
          const assignedJobIds = currentCoder.assignedJobs || [];

          this.dataSource.data = sampleJobs.filter(job => assignedJobIds.includes(job.id));
        } else {
          this.dataSource.data = [];
        }

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

  selectRow(row: CodingJob): void {
    this.selection.toggle(row);
  }

  startCodingJob(job: CodingJob): void {
    this.snackBar.open(`Starten von Kodierjob "${job.name}" noch nicht implementiert`, 'Schließen', { duration: 3000 });
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
