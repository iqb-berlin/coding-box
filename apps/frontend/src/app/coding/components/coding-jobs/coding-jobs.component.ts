import {
  Component, OnInit, ViewChild, AfterViewInit, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatSort, MatSortModule } from '@angular/material/sort';
import {
  MatFormField, MatLabel, MatOption, MatSelect
} from '@angular/material/select';
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
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { MatAnchor, MatButton, MatIconButton } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { AppService } from '../../../services/app.service';
import { BackendService } from '../../../services/backend.service';

import { CodingJob, Variable, VariableBundle } from '../../models/coding-job.model';
import { CodingJobDialogComponent } from '../coding-job-dialog/coding-job-dialog.component';
import { ConfirmDialogComponent } from '../../../shared/confirm-dialog/confirm-dialog.component';
import { Coder } from '../../models/coder.model';
import { CoderService } from '../../services/coder.service';
import { CodingJobResultDialogComponent } from './coding-job-result-dialog/coding-job-result-dialog.component';
import { CoderTraining } from '../../models/coder-training.model';

@Component({
  selector: 'coding-box-coding-jobs',
  templateUrl: './coding-jobs.component.html',
  styleUrls: ['./coding-jobs.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    TranslateModule,
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
    MatButton,
    MatDialogModule,
    MatTooltipModule,
    MatIconButton,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption
  ]
})
export class CodingJobsComponent implements OnInit, AfterViewInit {
  appService = inject(AppService);
  backendService = inject(BackendService);
  private translateService = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private coderService = inject(CoderService);
  private router = inject(Router);

  private coderNamesByJobId = new Map<number, string>();
  allCoders: Coder[] = [];

  private jobDetailsCache = new Map<number, { variables?: Variable[], variableBundles?: VariableBundle[] }>();
  private preloadedVariables: Variable[] | null = null;

  displayedColumns: string[] = ['actions', 'name', 'description', 'status', 'assignedCoders', 'variables', 'variableBundles', 'progress', 'createdAt', 'updatedAt'];
  dataSource = new MatTableDataSource<CodingJob>([]);
  isLoading = false;

  coderTrainings: CoderTraining[] = [];
  selectedTrainingId: number | null = null;
  selectedStatus: string | null = null;
  selectedCoderId: number | null = null;
  selectedJobName: string | null = null;
  originalData: CodingJob[] = [];

  @ViewChild(MatSort) sort!: MatSort;

  private handleWindowFocus = () => {
    this.loadCodingJobs();
  };

  ngOnInit(): void {
    this.coderService.getCoders().subscribe(coders => {
      this.allCoders = coders;
      this.updateCoderNamesMap(this.dataSource.data);
    });

    this.loadCoderTrainings();
    this.loadCodingJobs();
    window.addEventListener('focus', this.handleWindowFocus);
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

    this.backendService.getCodingIncompleteVariables(workspaceId).subscribe({
      next: variables => {
        this.preloadedVariables = variables;

        this.backendService.getCodingJobs(workspaceId).subscribe({
          next: response => {
            this.coderNamesByJobId.clear();
            const processedData = response.data.map(job => ({
              ...job,
              createdAt: job.created_at ? new Date(job.created_at) : new Date(),
              updatedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
              assignedVariableBundles: job.assignedVariableBundles ?? job.variableBundles ?? []
            }));

            this.originalData = [...processedData];
            this.dataSource.data = processedData;
            this.updateCoderNamesMap(processedData);

            this.jobDetailsCache.clear();
            this.isLoading = false;
            this.onTrainingFilterChange();
          },
          error: () => {
            this.snackBar.open('Fehler beim Laden der Kodierjobs', 'Schließen', { duration: 3000 });
            this.isLoading = false;
          }
        });
      },
      error: () => {
        // Still load coding jobs even if variables fail to load
        this.backendService.getCodingJobs(workspaceId).subscribe({
          next: response => {
            this.coderNamesByJobId.clear();
            const processedData = response.data.map(job => ({
              ...job,
              createdAt: job.created_at ? new Date(job.created_at) : new Date(),
              updatedAt: job.updated_at ? new Date(job.updated_at) : new Date(),
              assignedVariableBundles: job.assignedVariableBundles ?? job.variableBundles ?? []
            }));

            this.originalData = [...processedData];
            this.dataSource.data = processedData;
            this.updateCoderNamesMap(processedData);

            this.jobDetailsCache.clear();
            this.isLoading = false;
            // Apply current filter after loading
            this.onTrainingFilterChange();
          },
          error: () => {
            this.snackBar.open('Fehler beim Laden der Kodierjobs', 'Schließen', { duration: 3000 });
            this.isLoading = false;
          }
        });
      }
    });
  }

  applyFilter(): void {
    // Apply all filters since text search is removed
    this.applyAllFilters();
  }

  onStatusFilterChange(): void {
    this.applyAllFilters();
    this.applyFilter();
  }

  onCoderFilterChange(): void {
    this.applyAllFilters();
    this.applyFilter();
  }

  onJobNameFilterChange(): void {
    this.applyAllFilters();
    this.applyFilter();
  }

  private applyAllFilters(): void {
    let filteredData = this.originalData || [];

    if (this.selectedStatus !== null && this.selectedStatus !== 'all') {
      filteredData = filteredData.filter(job => job.status === this.selectedStatus);
    }

    if (this.selectedCoderId !== null) {
      filteredData = filteredData.filter(job => job.assignedCoders && job.assignedCoders.includes(this.selectedCoderId!)
      );
    }

    if (this.selectedJobName !== null && this.selectedJobName !== 'all') {
      filteredData = filteredData.filter(job => job.name === this.selectedJobName);
    }

    if (this.selectedTrainingId !== null && this.selectedTrainingId !== undefined) {
      filteredData = filteredData.filter(job => job.training_id === this.selectedTrainingId);
    }

    this.dataSource.data = filteredData;
  }

  getVariables(job: CodingJob): string {
    if (job.assignedVariables && job.assignedVariables.length > 0) {
      return this.formatAssignedVariables(job.assignedVariables);
    }
    if (job.variables && job.variables.length > 0) {
      return this.formatAssignedVariables(job.variables);
    }
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

    return 'Keine Variablen-Bündel';
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
        isEdit: false,
        preloadedVariables: this.preloadedVariables || []
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        const newId = this.getNextId();
        const now = new Date();
        const newCodingJob: CodingJob = {
          ...result,
          assignedVariables: result.assignedVariables ?? result.variables ?? [],
          assignedVariableBundles: result.assignedVariableBundles ?? result.variableBundles ?? [],
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

  editCodingJob(job: CodingJob): void {
    const selectedJob = job;

    const dialogRef = this.dialog.open(CodingJobDialogComponent, {
      width: '900px',
      data: {
        codingJob: selectedJob,
        isEdit: true,
        preloadedVariables: this.preloadedVariables || []
      }
    });

    dialogRef.afterClosed().subscribe(editResult => {
      if (editResult) {
        const workspaceId = this.appService.selectedWorkspaceId;
        if (!workspaceId) {
          this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
          return;
        }
        this.backendService.updateCodingJob(workspaceId, editResult.id, editResult).subscribe({
          next: updatedJob => {
            this.loadCodingJobs();
            this.snackBar.open(`Kodierjob "${updatedJob.name}" wurde aktualisiert`, 'Schließen', { duration: 3000 });
          },
          error: () => {
            this.snackBar.open(`Fehler beim Aktualisieren von Kodierjob "${editResult.name}"`, 'Schließen', { duration: 3000 });
          }
        });
      }
    });
  }

  private getNextId(): number {
    const jobs = this.dataSource.data;
    return jobs.length > 0 ?
      Math.max(...jobs.map(job => job.id)) + 1 :
      1;
  }

  deleteCodingJob(job: CodingJob): void {
    const confirmMessage = `Möchten Sie den Kodierjob "${job.name}" wirklich löschen?`;

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

        this.backendService.deleteCodingJob(workspaceId, job.id).subscribe({
          next: response => {
            if (response.success) {
              this.snackBar.open(`Kodierjob "${job.name}" wurde erfolgreich gelöscht`, 'Schließen', { duration: 3000 });
              this.loadCodingJobs();
            } else {
              this.snackBar.open(`Fehler beim Löschen von Kodierjob "${job.name}"`, 'Schließen', { duration: 3000 });
            }
          },
          error: () => {
            this.snackBar.open(`Fehler beim Löschen von Kodierjob "${job.name}"`, 'Schließen', { duration: 3000 });
          }
        });
      }
    });
  }

  getProgress(job: CodingJob): string {
    if (!job.totalUnits || job.totalUnits === 0) {
      return 'Keine Aufgaben';
    }
    const progress = job.progress || 0;
    const coded = job.codedUnits || 0;
    const total = job.totalUnits;
    const openCount = job.openUnits || 0;

    if (openCount > 0) {
      return `${progress}% (${coded}/${total}, ${openCount} offen)`;
    }

    return `${progress}% (${coded}/${total})`;
  }

  startCodingJob(job: CodingJob): void {
    const selectedJob = job;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    const loadingSnack = this.snackBar.open(`Starte Kodierjob "${selectedJob.name}"...`, '', { duration: 3000 });

    this.backendService.startCodingJob(workspaceId, selectedJob.id).subscribe({
      next: startResult => {
        loadingSnack.dismiss();
        if (!startResult || startResult.total === 0) {
          this.snackBar.open('Keine passenden Antworten gefunden', 'Info', { duration: 3000 });
          return;
        }

        // Map responses to a booklet-like structure so we can reuse the Replay booklet navigation
        const units = startResult.items.map((item, idx) => ({
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
              mode: 'coding',
              bookletKey
            } as const;

            const url = this.router.serializeUrl(
              this.router.createUrlTree([
                `replay/${firstTestPerson}/${firstUnitId}/0/0`
              ], { queryParams })
            );
            window.open(`#/${url}`, '_blank');
            this.snackBar.open(`${startResult.total} Antworten für Replay vorbereitet`, 'Schließen', { duration: 3000 });
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
      case 'open':
        return 'status-open';
      case 'review':
        return 'status-review';
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
      case 'open':
        return 'Offen';
      case 'review':
        return 'Zur Überprüfung';
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

  getDisplayName(job: CodingJob): string {
    if (job.training_id) {
      const prefix = this.translateService.instant('coding.trainings.job-name-prefix');
      return `${prefix}${job.name}`;
    }
    return job.name;
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

  loadCoderTrainings(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }

    this.backendService.getCoderTrainings(workspaceId).subscribe({
      next: trainings => {
        this.coderTrainings = trainings;
      },
      error: () => {
        this.coderTrainings = [];
      }
    });
  }

  onTrainingFilterChange(): void {
    this.applyTrainingFilter();
    this.applyFilter();
  }

  private applyTrainingFilter(): void {
    if (this.selectedTrainingId === null || this.selectedTrainingId === undefined) {
      this.dataSource.data = this.originalData || [];
      return;
    }

    this.dataSource.data = (this.originalData || []).filter(job => job.training_id === this.selectedTrainingId);
  }

  restartCodingJob(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    const confirmMessage = `Möchten Sie den Kodierjob "${job.name}" wirklich neu starten? Alle Einheiten werden für eine Aktualisierung geöffnet und die Kodierungsvorschau wird geöffnet.`;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '500px',
      data: {
        title: 'Neustart bestätigen',
        message: confirmMessage,
        confirmButtonText: 'Neustart',
        cancelButtonText: 'Abbrechen'
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.backendService.restartCodingJobWithOpenUnits(workspaceId, job.id).subscribe({
          next: restartedJob => {
            const loadingSnack = this.snackBar.open(`Neustart von Kodierjob "${restartedJob.name}" mit offenen Einheiten...`, '', { duration: 3000 });

            this.backendService.startCodingJob(workspaceId, restartedJob.id).subscribe({
              next: restartResult => {
                loadingSnack.dismiss();
                if (!restartResult || restartResult.total === 0) {
                  this.snackBar.open('Keine offenen Einheiten gefunden', 'Info', { duration: 3000 });
                  return;
                }

                const units = restartResult.items.map((item, idx) => ({
                  id: idx,
                  name: item.unitAlias || item.unitName,
                  alias: item.unitAlias || null,
                  bookletId: 0,
                  testPerson: `${item.personLogin}@${item.personCode}@${item.bookletName}`,
                  variableId: item.variableId,
                  variableAnchor: item.variableAnchor
                }));

                const bookletData = {
                  id: restartedJob.id,
                  name: `Coding-Job: ${restartedJob.name} (Offene Einheiten)`,
                  units,
                  currentUnitIndex: 0
                };

                const first = units[0];
                const firstTestPerson = first.testPerson;
                const firstUnitId = first.name;

                this.appService
                  .createToken(this.appService.selectedWorkspaceId, this.appService.loggedUser?.sub || '', 1)
                  .subscribe(token => {
                    const bookletKey = `replay_booklet_${restartedJob.id}_${Date.now()}`;
                    try {
                      localStorage.setItem(bookletKey, JSON.stringify(bookletData));
                    } catch (e) {
                      // ignore
                    }

                    const queryParams = {
                      auth: token,
                      mode: 'coding',
                      bookletKey
                    } as const;

                    const url = this.router.serializeUrl(
                      this.router.createUrlTree([
                        `replay/${firstTestPerson}/${firstUnitId}/0/0`
                      ], { queryParams })
                    );
                    window.open(`#/${url}`, '_blank');
                    this.snackBar.open(`${restartResult.total} offene Einheiten für Replay vorbereitet`, 'Schließen', { duration: 3000 });
                  });
              },
              error: () => {
                loadingSnack.dismiss();
                this.snackBar.open(`Fehler beim Starten des neu gestarteten Kodierjobs "${restartedJob.name}"`, 'Fehler', { duration: 3000 });
              }
            });
          },
          error: () => {
            this.snackBar.open(`Fehler beim Neustart des Kodierjobs "${job.name}"`, 'Schließen', { duration: 3000 });
          }
        });
      }
    });
  }

  viewCodingResults(job: CodingJob): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.snackBar.open('Kein Workspace ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }
    this.dialog.open(CodingJobResultDialogComponent, {
      width: '1200px',
      height: '80vh',
      data: {
        codingJob: job,
        workspaceId: workspaceId
      }
    });
  }
}
