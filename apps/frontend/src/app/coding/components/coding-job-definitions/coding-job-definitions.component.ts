import {
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, takeUntil, forkJoin } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { CoderService } from '../../services/coder.service';
import { CodingJobService } from '../../services/coding-job.service';
import { CodingJobDefinitionDialogComponent, CodingJobDefinitionDialogData } from '../coding-job-definition-dialog/coding-job-definition-dialog.component';
import { CodingJobBulkCreationDialogComponent, BulkCreationData } from '../coding-job-bulk-creation-dialog/coding-job-bulk-creation-dialog.component';

interface JobDefinition {
  id?: number;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  assignedCoders?: number[];
  durationSeconds?: number;
  maxCodingCases?: number;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  created_at?: Date;
  updated_at?: Date;
}

@Component({
  selector: 'coding-box-coding-job-definitions',
  templateUrl: './coding-job-definitions.component.html',
  styleUrls: ['./coding-job-definitions.component.scss'],
  imports: [
    CommonModule,
    TranslateModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatCardModule
  ]
})
export class CodingJobDefinitionsComponent implements OnInit, OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private coderService = inject(CoderService);
  private codingJobService = inject(CodingJobService);
  private destroy$ = new Subject<void>();

  jobDefinitions: JobDefinition[] = [];
  isLoading = false;

  displayedColumns: string[] = [
    'id',
    'status',
    'variablesCount',
    'codersCount',
    'bundlesCount',
    'createdAt',
    'actions'
  ];

  ngOnInit(): void {
    this.loadJobDefinitions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadJobDefinitions(): void {
    this.isLoading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError('No workspace selected');
      this.isLoading = false;
      return;
    }

    this.backendService.getJobDefinitions(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: definitions => {
          this.jobDefinitions = definitions;
          this.isLoading = false;
        },
        error: error => {
          this.showError(`Error loading job definitions: ${error.message}`);
          this.isLoading = false;
        }
      });
  }

  getVariablesCount(definition: JobDefinition): number {
    return definition.assignedVariables?.length || 0;
  }

  getCodersCount(definition: JobDefinition): number {
    return definition.assignedCoders?.length || 0;
  }

  getBundlesCount(definition: JobDefinition): number {
    return definition.assignedVariableBundles?.length || 0;
  }

  formatDate(date: Date | string): string {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString();
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'draft': return 'Entwurf';
      case 'pending_review': return 'Warten auf Genehmigung';
      case 'approved': return 'Genehmigt';
      default: return status || '-';
    }
  }

  createDefinition(): void {
    const dialogData: CodingJobDefinitionDialogData = {
      isEdit: false,
      mode: 'definition'
    };

    const dialogRef = this.dialog.open(CodingJobDefinitionDialogComponent, {
      width: '1200px',
      height: '90vh',
      data: dialogData,
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadJobDefinitions();
      }
    });
  }

  canPerformActions(definition: JobDefinition): boolean {
    // TODO: Add permission checks here based on user role
    return true;
  }

  editDefinition(definition: JobDefinition): void {
    const workspaceId = this.appService.selectedWorkspaceId!;
    const dialogData: CodingJobDefinitionDialogData = {
      isEdit: true,
      mode: 'definition',
      jobDefinitionId: definition.id,
      codingJob: {
        id: definition.id!,
        workspace_id: workspaceId,
        name: `Definition ${definition.id!}`,
        status: definition.status!,
        assignedVariables: definition.assignedVariables,
        assignedVariableBundles: definition.assignedVariableBundles,
        assignedCoders: definition.assignedCoders!,
        durationSeconds: definition.durationSeconds,
        maxCodingCases: definition.maxCodingCases,
        doubleCodingAbsolute: definition.doubleCodingAbsolute,
        doubleCodingPercentage: definition.doubleCodingPercentage,
        created_at: definition.created_at!,
        updated_at: definition.updated_at!
      }
    };

    const dialogRef = this.dialog.open(CodingJobDefinitionDialogComponent, {
      width: '1200px',
      height: '90vh',
      data: dialogData,
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadJobDefinitions();
      }
    });
  }

  submitForReview(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('No workspace selected');
      return;
    }

    this.backendService.updateJobDefinition(workspaceId, definition.id, { status: 'pending_review' })
      .subscribe({
        next: () => {
          this.snackBar.open('Job-Definition wurde zur Prüfung eingereicht', 'Schließen', { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(`Fehler beim Einreichen zur Prüfung: ${error.message}`);
        }
      });
  }

  approveDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('No workspace selected');
      return;
    }

    this.backendService.approveJobDefinition(workspaceId, definition.id, 'approved')
      .subscribe({
        next: () => {
          this.snackBar.open('Job-Definition wurde genehmigt', 'Schließen', { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(`Fehler bei der Genehmigung: ${error.message}`);
        }
      });
  }

  rejectDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('No workspace selected');
      return;
    }

    this.backendService.updateJobDefinition(workspaceId, definition.id, { status: 'draft' })
      .subscribe({
        next: () => {
          this.snackBar.open('Job-Definition wurde abgelehnt und wieder als Entwurf markiert', 'Schließen', { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(`Fehler bei der Ablehnung: ${error.message}`);
        }
      });
  }

  deleteDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('No workspace selected');
      return;
    }

    this.backendService.deleteJobDefinition(workspaceId, definition.id)
      .subscribe({
        next: () => {
          this.snackBar.open('Job-Definition wurde gelöscht', 'Schließen', { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(`Fehler beim Löschen: ${error.message}`);
        }
      });
  }

  async createCodingJobFromDefinition(definition: JobDefinition): Promise<void> {
    if (!definition.id || !definition.assignedCoders) {
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError('No workspace selected');
      return;
    }

    try {
      const allCoders = await this.coderService.getCoders().toPromise();
      const selectedCoders = allCoders?.filter(coder => definition.assignedCoders!.includes(coder.id)) || [];

      const dialogData: BulkCreationData = {
        selectedVariables: definition.assignedVariables || [],
        selectedVariableBundles: definition.assignedVariableBundles || [],
        selectedCoders: selectedCoders
      };
      const dialogRef = this.dialog.open(CodingJobBulkCreationDialogComponent, {
        width: '700px',
        data: dialogData
      });

      const result = await dialogRef.afterClosed().toPromise();

      if (result === true) {
        this.createBulkJobsFromDefinition(dialogData, definition, workspaceId);
      }
    } catch (error) {
      this.showError(`Fehler beim Laden der Kodierer: ${(error as Error).message}`);
    }
  }

  private async createBulkJobsFromDefinition(data: BulkCreationData, definition: JobDefinition, workspaceId: number): Promise<void> { // eslint-disable-line @typescript-eslint/no-unused-vars
    const selectedCoderIds = data.selectedCoders.map(c => c.id);
    let successCount = 0;
    let errorCount = 0;

    for (const variable of data.selectedVariables) {
      const jobName = `${variable.unitName}_${variable.variableId}`;
      const codingJob = {
        id: 0,
        workspace_id: workspaceId,
        name: jobName,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: selectedCoderIds,
        variables: [variable],
        variableBundles: [],
        assignedVariables: [variable],
        assignedVariableBundles: [],
        durationSeconds: definition.durationSeconds,
        maxCodingCases: definition.maxCodingCases,
        doubleCodingAbsolute: definition.doubleCodingAbsolute,
        doubleCodingPercentage: definition.doubleCodingPercentage,
        jobDefinitionId: definition.id
      };

      try {
        const createdJob = await this.backendService.createCodingJob(workspaceId, codingJob).toPromise();
        if (createdJob?.id && selectedCoderIds.length > 0) {
          await forkJoin(selectedCoderIds.map(id => this.codingJobService.assignCoder(createdJob.id, id))).toPromise();
        }
        successCount += 1;
      } catch (error) {
        errorCount += 1;
      }
    }

    for (const bundle of data.selectedVariableBundles) {
      const jobName = bundle.name;
      const codingJob = {
        id: 0,
        workspace_id: workspaceId,
        name: jobName,
        status: 'pending',
        created_at: new Date(),
        updated_at: new Date(),
        assignedCoders: selectedCoderIds,
        variables: bundle.variables,
        variableBundles: [bundle],
        assignedVariables: bundle.variables,
        assignedVariableBundles: [bundle],
        durationSeconds: definition.durationSeconds,
        maxCodingCases: definition.maxCodingCases,
        doubleCodingAbsolute: definition.doubleCodingAbsolute,
        doubleCodingPercentage: definition.doubleCodingPercentage,
        jobDefinitionId: definition.id
      };

      try {
        const createdJob = await this.backendService.createCodingJob(workspaceId, codingJob).toPromise();
        if (createdJob?.id && selectedCoderIds.length > 0) {
          await forkJoin(selectedCoderIds.map(id => this.codingJobService.assignCoder(createdJob.id, id))).toPromise();
        }
        successCount += 1;
      } catch (error) {
        errorCount += 1;
      }
    }

    if (errorCount === 0) {
      this.snackBar.open(`${successCount} Coding-Jobs wurden erfolgreich erstellt`, 'Schließen', { duration: 3000 });
    } else {
      this.snackBar.open(`${successCount} Jobs erstellt, ${errorCount} fehlgeschlagen`, 'Schließen', { duration: 5000 });
    }

    this.loadJobDefinitions();
  }

  private showError(message: string): void {
    this.snackBar.open(message, 'Schließen', { duration: 5000 });
  }
}
