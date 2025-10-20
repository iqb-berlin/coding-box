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
import { Router } from '@angular/router';
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
  private router = inject(Router);

  private coderNamesByJobId = new Map<number, string>();
  private allCoders: Coder[] = [];

  private jobDetailsCache = new Map<number, { variables?: Variable[], variableBundles?: VariableBundle[] }>();

  displayedColumns: string[] = ['selectCheckbox', 'name', 'description', 'status', 'assignedCoders', 'variables', 'variableBundles', 'progress', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  selection = new SelectionModel<CodingJob>(true, []);
  isLoading = false;

  @ViewChild(MatSort) sort!: MatSort;

  ngOnInit(): void {
    this.coderService.getCoders().subscribe(coders => {
      this.allCoders = coders;
      this.updateCoderNamesMap(this.dataSource.data);
    });

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
        const processedData = response.data.map(job => ({
          ...job,
          createdAt: job.created_at ? new Date(job.created_at) : new Date(),
          updatedAt: job.updated_at ? new Date(job.updated_at) : new Date()
        }));

        this.dataSource.data = processedData;
        // Namen der Codierer für die Liste aktualisieren
        this.updateCoderNamesMap(processedData);

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
    // Fallback: falls Variablen unter "variables" statt "assignedVariables" geliefert werden
    if (job.variables && job.variables.length > 0) {
      return this.formatAssignedVariables(job.variables);
    }
    // Letzter Fallback: ggf. aus Cache (z. B. nach Lazy-Load)
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variables && cachedDetails.variables.length > 0) {
      return this.formatAssignedVariables(cachedDetails.variables);
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

    return 'Keine Variablen-Bundles';
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

  getFullVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      const variableNames = job.assignedVariables.map(v => {
        const unitName = v.unitName || 'unbekannt';
        const variableId = v.variableId || 'unbekannt';
        return `${unitName}_${variableId}`;
      });
      return `Variablen (${job.assignedVariables.length}): ${variableNames.join(', ')}`;
    }
    if (job.variables && job.variables.length > 0) {
      return job.variables.map(v => {
        const unitName = v.unitName || 'unbekannt';
        const variableId = v.variableId || 'unbekannt';
        return `${unitName}_${variableId}`;
      }).join(', ');
    }
    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variables && cachedDetails.variables.length > 0) {
      return cachedDetails.variables.map(v => {
        const unitName = v.unitName || 'unbekannt';
        const variableId = v.variableId || 'unbekannt';
        return `${unitName}_${variableId}`;
      }).join(', ');
    }

    return 'Keine Variablen zugewiesen';
  }

  getFullVariableBundles(job: CodingJob): string {
    if (job.assignedVariableBundles && job.assignedVariableBundles.length > 0) {
      const bundleNames = job.assignedVariableBundles.map(b => b.name || 'unbekannt');
      return `Variablen-Bündel (${job.assignedVariableBundles.length}): ${bundleNames.join(', ')}`;
    }

    if (job.variableBundles && job.variableBundles.length > 0) {
      return job.variableBundles.map(b => b.name || 'unbekannt').join(', ');
    }

    const cachedDetails = this.jobDetailsCache.get(job.id);
    if (cachedDetails && cachedDetails.variableBundles && cachedDetails.variableBundles.length > 0) {
      return cachedDetails.variableBundles.map(b => b.name || 'unbekannt').join(', ');
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
          // Normalisierung: damit die Liste sofort die Variablen anzeigt
          assignedVariables: result.assignedVariables ?? result.variables ?? [],
          id: newId,
          createdAt: now,
          updatedAt: now
        };
        const currentData = this.dataSource.data;
        this.dataSource.data = [...currentData, newCodingJob];
        this.snackBar.open(`Kodierjob "${newCodingJob.name}" wurde erstellt`, 'Schließen', { duration: 3000 });
        this.loadCodingJobs();
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
          const workspaceId = this.appService.selectedWorkspaceId;
          if (!workspaceId) {
            this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
            return;
          }
          this.backendService.updateCodingJob(workspaceId, result.id, result).subscribe({
            next: updatedJob => {
              this.loadCodingJobs();
              this.snackBar.open(`Kodierjob "${updatedJob.name}" wurde aktualisiert`, 'Schließen', { duration: 3000 });
            },
            error: () => {
              this.snackBar.open(`Fehler beim Aktualisieren von Kodierjob "${result.name}"`, 'Schließen', { duration: 3000 });
            }
          });
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

  getProgress(job: CodingJob): string {
    if (!job.totalUnits || job.totalUnits === 0) {
      return 'Keine Aufgaben';
    }
    const progress = job.progress || 0;
    const coded = job.codedUnits || 0;
    const total = job.totalUnits;

    return `${progress}% (${coded}/${total})`;
  }

  startCodingJob(): void {
    if (this.selection.selected.length === 1) {
      const selectedJob = this.selection.selected[0];
      const workspaceId = this.appService.selectedWorkspaceId;
      if (!workspaceId) {
        this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
        return;
      }

      const loadingSnack = this.snackBar.open(`Starte Kodierjob "${selectedJob.name}"...`, '', { duration: 3000 });

      this.backendService.startCodingJob(workspaceId, selectedJob.id).subscribe({
        next: result => {
          loadingSnack.dismiss();
          if (!result || result.total === 0) {
            this.snackBar.open('Keine passenden Antworten gefunden', 'Info', { duration: 3000 });
            return;
          }

          // Map responses to a booklet-like structure so we can reuse the Replay booklet navigation
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
            id: selectedJob.id,
            name: `Coding-Job: ${selectedJob.name}`,
            units,
            currentUnitIndex: 0
          };

          const first = units[0];
          const firstTestPerson = first.testPerson;
          const firstUnitId = first.name;

          this.appService
            .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
            .subscribe(token => {
              const bookletKey = `replay_booklet_${selectedJob.id}_${Date.now()}`;
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

  getAssignedCoderNames(job: CodingJob): string {
    if (this.coderNamesByJobId.has(job.id)) {
      const full = this.coderNamesByJobId.get(job.id)!;
      if (full === 'Keine') {
        return full;
      }
      const names = full.split(', ').filter(n => n && n.trim().length > 0);
      if (names.length > 2) {
        return `${names[0]}, ${names[1]} +${names.length - 2} weitere`;
      }
      return names.join(', ');
    }

    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return 'Keine';
    }

    return `${job.assignedCoders.length} Kodierer`;
  }

  getFullCoderNames(job: CodingJob): string {
    if (this.coderNamesByJobId.has(job.id)) {
      const full = this.coderNamesByJobId.get(job.id)!;
      return full === 'Keine' ? 'Keine Kodierer zugewiesen' : full;
    }

    if (!job.assignedCoders || job.assignedCoders.length === 0) {
      return 'Keine Kodierer zugewiesen';
    }

    // Fallback
    return `${job.assignedCoders.length} Kodierer`;
  }

  private updateCoderNamesMap(jobs: CodingJob[]): void {
    if (!jobs || jobs.length === 0) {
      return;
    }

    const byId = new Map<number, Coder>(this.allCoders.map(c => [c.id, c]));
    jobs.forEach(job => {
      const ids = job.assignedCoders || [];
      if (ids.length === 0) {
        this.coderNamesByJobId.set(job.id, 'Keine');
        return;
      }
      const names = ids
        .map(id => byId.get(id))
        .filter((c): c is Coder => !!c)
        .map(c => c.displayName || c.name || `Coder ${c.id}`);

      if (names.length === 0) {
        this.coderNamesByJobId.set(job.id, `${ids.length} Kodierer`);
      } else {
        this.coderNamesByJobId.set(job.id, names.join(', '));
      }
    });
  }
}
