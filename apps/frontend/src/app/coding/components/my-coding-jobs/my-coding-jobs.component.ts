import {
  Component, OnInit, OnDestroy, ViewChild, AfterViewInit, inject, ChangeDetectorRef
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
import {
  MatFormField, MatLabel, MatOption, MatSelect
} from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SelectionModel } from '@angular/cdk/collections';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatAnchor, MatIconButton } from '@angular/material/button';
import { DatePipe, NgClass, NgFor } from '@angular/common';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { CodingJob, Variable } from '../../models/coding-job.model';
import { WorkspaceFullDto } from '../../../../../../../api-dto/workspaces/workspace-full-dto';

@Component({
  selector: 'coding-box-my-coding-jobs',
  templateUrl: './my-coding-jobs.component.html',
  styleUrls: ['./my-coding-jobs.component.scss'],
  standalone: true,
  imports: [
    TranslateModule,
    DatePipe,
    NgClass,
    NgFor,
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
    MatIconButton,
    MatTooltipModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption
  ]
})
export class MyCodingJobsComponent implements OnInit, AfterViewInit, OnDestroy {
  appService = inject(AppService);
  backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  displayedColumns: string[] = ['actions', 'name', 'description', 'status', 'variables', 'variableBundles', 'progress', 'created_at', 'updated_at'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;
  currentUserId = 0;
  isAuthorized = false;

  totalProgress = 0;
  totalCodedUnits = 0;
  totalUnits = 0;

  selectedStatus: string | null = null;
  selectedJobName: string | null = null;
  originalData: CodingJob[] = [];

  @ViewChild(MatSort) sort!: MatSort;

  private handleWindowFocus = () => {
    if (this.isAuthorized) {
      this.appService.authData$.subscribe(authData => {
        if (authData.workspaces && authData.workspaces.length > 0) {
          this.loadMyCodingJobs(authData.workspaces);
        }
      }).unsubscribe();
    }
  };

  ngOnInit(): void {
    this.appService.authData$.subscribe(authData => {
      this.currentUserId = authData.userId;
      this.isAuthorized = true;
      if (authData.workspaces && authData.workspaces.length > 0) {
        this.loadMyCodingJobs(authData.workspaces);
      }
    });
    window.addEventListener('focus', this.handleWindowFocus);
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
  }

  ngOnDestroy(): void {
    window.removeEventListener('focus', this.handleWindowFocus);
  }

  loadMyCodingJobs(workspaces: [] | WorkspaceFullDto[]): void {
    this.isLoading = true;
    if (workspaces) {
      const workspaceJobsObservables = workspaces.map(workspace => this.backendService.getCodingJobs(workspace.id).pipe(
        map(response => response.data)
      )
      );

      forkJoin(workspaceJobsObservables).subscribe({
        next: allJobsArrays => {
          const allJobs = allJobsArrays.flat();
          const assignedJobs = allJobs.filter(job => job.assignedCoders && job.assignedCoders.includes(this.currentUserId)
          );
          this.originalData = [...assignedJobs];
          this.dataSource.data = assignedJobs;
          this.calculateTotalProgress(assignedJobs);
          this.cdr.detectChanges(); // Trigger change detection for filters
          this.isLoading = false;
        },
        error: () => {
          this.snackBar.open('Fehler beim Laden der Kodierjobs', 'Schließen', { duration: 3000 });
          this.isLoading = false;
        }
      });
    } else {
      this.dataSource.data = [];
      this.isLoading = false;
    }
  }

  onStatusFilterChange(): void {
    this.applyAllFilters();
  }

  onJobNameFilterChange(): void {
    this.applyAllFilters();
  }

  private applyAllFilters(): void {
    let filteredData = this.originalData || [];

    if (this.selectedStatus !== null && this.selectedStatus !== 'all') {
      filteredData = filteredData.filter(job => job.status === this.selectedStatus);
    }

    if (this.selectedJobName !== null && this.selectedJobName !== 'all') {
      filteredData = filteredData.filter(job => job.name === this.selectedJobName);
    }

    this.dataSource.data = filteredData;
  }

  selectRow(row: CodingJob): void {
    this.selection.toggle(row);
  }

  startCodingJob(job: CodingJob): void {
    const loadingSnack = this.snackBar.open(`Starte Kodierjob "${job.name}"...`, '', { duration: 3000 });

    this.backendService.startCodingJob(job.workspace_id, job.id).subscribe({
      next: result => {
        loadingSnack.dismiss();
        if (!result || result.total === 0) {
          this.snackBar.open('Keine passenden Antworten gefunden', 'Info', { duration: 3000 });
          return;
        }

        const units = result.items.map((item, idx) => ({
          id: idx,
          name: item.unitAlias || item.unitName,
          alias: item.unitAlias || null,
          bookletId: 0,
          testPerson: `${item.personLogin}@${item.personCode}@${item.bookletName}`,
          variableId: item.variableId,
          variableAnchor: item.variableAnchor
        }));

        const bookletData = {
          id: job.id,
          name: `Coding-Job: ${job.name}`,
          units,
          currentUnitIndex: 0
        };

        const first = units[0];
        const firstTestPerson = first.testPerson;
        const firstUnitId = first.name;

        this.appService
          .createToken(job.workspace_id, this.appService.loggedUser?.sub || '', 1)
          .subscribe(token => {
            const bookletKey = `replay_booklet_${job.id}_${Date.now()}`;
            try {
              localStorage.setItem(bookletKey, JSON.stringify(bookletData));
            } catch (e) {
              // ignore
            }

            const queryParams = {
              auth: token,
              mode: 'booklet',
              bookletKey
            } as const;

            const url = this.router.serializeUrl(
              this.router.createUrlTree([
                `replay/${firstTestPerson}/${firstUnitId}/0/0`
              ], { queryParams })
            );
            window.open(`#/${url}`, '_blank');
            this.snackBar.open(`${result.total} Antworten für Replay vorbereitet`, 'Schließen', { duration: 3000 });
          });
      },
      error: () => {
        loadingSnack.dismiss();
        this.snackBar.open('Fehler beim Starten des Kodierjobs', 'Fehler', { duration: 3000 });
      }
    });
  }

  getStatusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'status-active';
      case 'completed':
        return 'status-completed';
      case 'pending':
        return 'status-pending';
      case 'paused':
        return 'status-paused';
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
      case 'paused':
        return 'Pausiert';
      default:
        return status;
    }
  }

  getVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      return this.formatAssignedVariables(job.assignedVariables);
    }
    if (job.variables && job.variables.length > 0) {
      return this.formatAssignedVariables(job.variables);
    }
    return 'Keine Variablen';
  }

  getVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const count = job.assignedVariableBundles.length;
      const maxToShow = 2;
      const bundleNames = job.assignedVariableBundles.map(b => b.name || 'unbekannt');

      if (bundleNames.length <= maxToShow) {
        return `${count} (${bundleNames.join(', ')})`;
      }

      const preview = bundleNames.slice(0, maxToShow).join(', ');
      return `${count} (${preview}, +${count - maxToShow} weitere)`;
    }

    return 'Keine Variablen-Bündel';
  }

  getProgress(job: CodingJob): string {
    if (!job.totalUnits || job.totalUnits === 0) {
      return 'Keine Aufgaben';
    }
    const progress = job.progress || 0;
    const coded = job.codedUnits || 0;
    const total = job.totalUnits;

    return `${progress}% (${coded}/${total})`;
  }

  private calculateTotalProgress(assignedJobs: CodingJob[]): void {
    this.totalCodedUnits = assignedJobs.reduce((sum, job) => sum + (job.codedUnits || 0), 0);
    this.totalUnits = assignedJobs.reduce((sum, job) => sum + (job.totalUnits || 0), 0);
    this.totalProgress = this.totalUnits > 0 ? Math.round((this.totalCodedUnits / this.totalUnits) * 100) : 0;
  }

  private formatAssignedVariables(assignedVariables: Variable[]): string {
    if (!assignedVariables || assignedVariables.length === 0) {
      return 'Keine Variablen';
    }

    const maxToShow = 3;
    const variableNames = assignedVariables.map(v => {
      const unitName = v.unitName || 'unbekannt';
      const variableId = v.variableId || 'unbekannt';
      return `${unitName}_${variableId}`;
    });

    if (variableNames.length <= maxToShow) {
      return variableNames.join(', ');
    }

    return `${variableNames.slice(0, maxToShow).join(', ')} +${variableNames.length - maxToShow} weitere`;
  }
}
