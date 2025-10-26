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
import { forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';
import { SearchFilterComponent } from '../../../shared/search-filter/search-filter.component';
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

  displayedColumns: string[] = ['name', 'description', 'status', 'variables', 'variableBundles', 'progress', 'created_at', 'updated_at'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;
  currentUserId = 0;
  isAuthorized = false;

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.appService.authData$.subscribe(authData => {
      this.currentUserId = authData.userId;
      this.isAuthorized = true;
      if (authData.workspaces && authData.workspaces.length > 0) {
        this.loadMyCodingJobs(authData.workspaces);
      }
    });
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort;
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
          this.dataSource.data = allJobsArrays.flat();
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

  applyFilter(filterValue: string): void {
    this.dataSource.filter = filterValue.trim().toLowerCase();
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
    // Fallback: falls Variablen unter "variables" statt "assignedVariables" geliefert werden
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
