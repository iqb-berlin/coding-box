import {
  Component,
  OnDestroy,
  OnInit,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatChipsModule } from '@angular/material/chips';
import { Subject, takeUntil } from 'rxjs';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { Variable, VariableBundle } from '../../models/coding-job.model';
import { CoderService } from '../../services/coder.service';
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

interface Coder {
  id: number;
  name: string;
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
    MatCardModule,
    MatChipsModule
  ]
})
export class CodingJobDefinitionsComponent implements OnInit, OnDestroy {
  private backendService = inject(BackendService);
  private appService = inject(AppService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private coderService = inject(CoderService);
  private translateService = inject(TranslateService);
  private destroy$ = new Subject<void>();

  jobDefinitions: JobDefinition[] = [];
  isLoading = false;
  coders: Coder[] = [];

  displayedColumns: string[] = [
    'actions',
    'status',
    'variables',
    'codersCount',
    'bundlesCount'
  ];

  ngOnInit(): void {
    this.loadCoders();
    this.loadJobDefinitions();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadCoders(): void {
    this.coderService.getCoders()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: coders => {
          this.coders = coders || [];
        },
        error: () => {
          this.coders = [];
        }
      });
  }

  private loadJobDefinitions(): void {
    this.isLoading = true;
    const workspaceId = this.appService.selectedWorkspaceId;

    if (!workspaceId) {
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.no-workspace'));
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
          this.showError(this.translateService.instant('error.general', { error: error.message }));
          this.isLoading = false;
        }
      });
  }

  getCoderNames(definition: JobDefinition): string {
    if (!definition.assignedCoders || definition.assignedCoders.length === 0) {
      return '-';
    }
    const coderNames = definition.assignedCoders
      .map(id => this.coders.find(c => c.id === id)?.name)
      .filter(name => name)
      .join(', ');
    return coderNames || '-';
  }

  getBundleNames(definition: JobDefinition): string {
    if (!definition.assignedVariableBundles || definition.assignedVariableBundles.length === 0) {
      return '-';
    }
    return definition.assignedVariableBundles
      .map(bundle => bundle.name)
      .join(', ');
  }

  getVariableNames(definition: JobDefinition): string {
    if (!definition.assignedVariables || definition.assignedVariables.length === 0) {
      return '-';
    }
    return definition.assignedVariables
      .map(variable => `${variable.unitName}.${variable.variableId}`)
      .join(', ');
  }

  formatDate(date: Date | string): string {
    if (!date) return '-';
    const d = new Date(date);
    return d.toLocaleDateString();
  }

  getStatusLabel(status: string): string {
    return this.translateService.instant(`coding-job-definition-dialog.status.definition.${status}`) || status || '-';
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
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.no-workspace'));
      return;
    }

    this.backendService.updateJobDefinition(workspaceId, definition.id, { status: 'pending_review' })
      .subscribe({
        next: () => {
          this.snackBar.open(this.translateService.instant('coding-job-definitions.messages.snackbar.submitted-for-review'), this.translateService.instant('common.close'), { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.submit-failed', { error: error.message }));
        }
      });
  }

  approveDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.no-workspace'));
      return;
    }

    this.backendService.approveJobDefinition(workspaceId, definition.id, 'approved')
      .subscribe({
        next: () => {
          this.snackBar.open(this.translateService.instant('coding-job-definitions.messages.snackbar.approved'), this.translateService.instant('common.close'), { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.approve-failed', { error: error.message }));
        }
      });
  }

  rejectDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.no-workspace'));
      return;
    }

    this.backendService.updateJobDefinition(workspaceId, definition.id, { status: 'draft' })
      .subscribe({
        next: () => {
          this.snackBar.open(this.translateService.instant('coding-job-definitions.messages.snackbar.rejected'), this.translateService.instant('common.close'), { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.reject-failed', { error: error.message }));
        }
      });
  }

  deleteDefinition(definition: JobDefinition): void {
    if (!definition.id) return;

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.no-workspace'));
      return;
    }

    this.backendService.deleteJobDefinition(workspaceId, definition.id)
      .subscribe({
        next: () => {
          this.snackBar.open(this.translateService.instant('coding-job-definitions.messages.snackbar.deleted'), this.translateService.instant('common.close'), { duration: 3000 });
          this.loadJobDefinitions();
        },
        error: error => {
          this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.delete-failed', { error: error.message }));
        }
      });
  }

  async createCodingJobFromDefinition(definition: JobDefinition): Promise<void> {
    if (!definition.id || !definition.assignedCoders) {
      return;
    }

    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.no-workspace'));
      return;
    }

    try {
      const allCoders = await this.coderService.getCoders().toPromise();
      const selectedCoders = allCoders?.filter(coder => definition.assignedCoders!.includes(coder.id)) || [];

      const dialogData: BulkCreationData = {
        selectedVariables: definition.assignedVariables || [],
        selectedVariableBundles: definition.assignedVariableBundles || [],
        selectedCoders: selectedCoders,
        doubleCodingAbsolute: definition.doubleCodingAbsolute,
        doubleCodingPercentage: definition.doubleCodingPercentage
      };
      const dialogRef = this.dialog.open(CodingJobBulkCreationDialogComponent, {
        width: '1200px',
        data: dialogData
      });

      const result = await dialogRef.afterClosed().toPromise();

      if (result && result.confirmed) {
        this.createBulkJobsFromDefinition(dialogData, workspaceId);
      }
    } catch (error) {
      this.showError(this.translateService.instant('coding-job-definitions.messages.snackbar.coders-loading-failed', { error: (error as Error).message }));
    }
  }

  private async createBulkJobsFromDefinition(data: BulkCreationData, workspaceId: number): Promise<void> {
    try {
      const mappedCoders = data.selectedCoders.map(coder => ({
        id: coder.id,
        name: coder.name,
        username: coder.name
      }));

      const allVariables = [...data.selectedVariables];
      if (data.selectedVariableBundles) {
        for (const bundle of data.selectedVariableBundles) {
          allVariables.push(...bundle.variables);
        }
      }

      const result = await this.backendService.createDistributedCodingJobs(
        workspaceId,
        allVariables,
        mappedCoders,
        data.doubleCodingAbsolute,
        data.doubleCodingPercentage
      ).toPromise();

      if (result && result.success) {
        this.snackBar.open(result.message, this.translateService.instant('common.close'), { duration: 3000 });

        const hasDoubleCoding = (data.doubleCodingAbsolute && data.doubleCodingAbsolute > 0) ||
                                (data.doubleCodingPercentage && data.doubleCodingPercentage > 0);

        if (hasDoubleCoding) {
          const dialogData: BulkCreationData = {
            selectedVariables: data.selectedVariables,
            selectedVariableBundles: data.selectedVariableBundles,
            selectedCoders: data.selectedCoders,
            doubleCodingAbsolute: data.doubleCodingAbsolute,
            doubleCodingPercentage: data.doubleCodingPercentage,
            creationResults: {
              doubleCodingInfo: result.doubleCodingInfo,
              jobs: result.jobs
            }
          };

          const dialogRef = this.dialog.open(CodingJobBulkCreationDialogComponent, {
            width: '1200px',
            data: dialogData,
            disableClose: false
          });

          await dialogRef.afterClosed().toPromise();
        }
      } else if (result) {
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.bulk-creation-failed-with-message', { message: result.message }), this.translateService.instant('common.close'), { duration: 5000 });
      } else {
        this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.bulk-creation-no-response'), this.translateService.instant('common.close'), { duration: 5000 });
      }
    } catch (error) {
      this.snackBar.open(this.translateService.instant('coding-job-definition-dialog.snackbars.bulk-creation-failed', { error: error instanceof Error ? error.message : error }), this.translateService.instant('common.close'), { duration: 5000 });
    }

    this.loadJobDefinitions();
  }

  private showError(message: string): void {
    this.snackBar.open(message, this.translateService.instant('common.close'), { duration: 5000 });
  }
}
