import { Component, Inject, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatStepperModule } from '@angular/material/stepper';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';
import { VariableValidationDto } from '../../../../../../../api-dto/files/variable-validation.dto';

@Component({
  selector: 'coding-box-validation-dialog',
  templateUrl: './validation-dialog.component.html',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatStepperModule,
    MatButtonModule,
    FormsModule,
    ReactiveFormsModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatExpansionModule,
    MatSnackBarModule
  ],
  styles: [`
    .actions-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }

    .mat-expansion-panel {
      margin-bottom: 16px;
    }

    .mat-spinner {
      display: inline-block;
      margin-right: 8px;
      vertical-align: middle;
    }

    table {
      width: 100%;
    }
  `]
})
export class ValidationDialogComponent {
  firstStepCompleted = true;
  backendService = inject(BackendService);
  appService = inject(AppService);
  variableValidationResult: VariableValidationDto | null = null;
  isVariableValidationRunning: boolean = false;
  isDeletingResponses: boolean = false;
  expandedPanel: boolean = false;
  selectedResponses: Set<number> = new Set<number>();

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: unknown,
    private dialogRef: MatDialogRef<ValidationDialogComponent>,
    private snackBar: MatSnackBar
  ) {}

  validateVariables(): void {
    this.isVariableValidationRunning = true;
    this.variableValidationResult = null;
    this.selectedResponses.clear();
    this.backendService.validateVariables(this.appService.selectedWorkspaceId)
      .subscribe(result => {
        this.variableValidationResult = result;
        this.isVariableValidationRunning = false;
      });
  }

  toggleResponseSelection(responseId: number | undefined): void {
    if (responseId === undefined) return;

    if (this.selectedResponses.has(responseId)) {
      this.selectedResponses.delete(responseId);
    } else {
      this.selectedResponses.add(responseId);
    }
  }

  isResponseSelected(responseId: number | undefined): boolean {
    return responseId !== undefined && this.selectedResponses.has(responseId);
  }

  selectAllResponses(): void {
    if (!this.variableValidationResult) return;

    this.variableValidationResult.invalidVariables.forEach(variable => {
      if (variable.responseId !== undefined) {
        this.selectedResponses.add(variable.responseId);
      }
    });
  }

  deselectAllResponses(): void {
    this.selectedResponses.clear();
  }

  deleteSelectedResponses(): void {
    if (this.selectedResponses.size === 0) {
      this.snackBar.open('Keine Antworten ausgewählt', 'Schließen', { duration: 3000 });
      return;
    }

    this.isDeletingResponses = true;
    const responseIds = Array.from(this.selectedResponses);

    this.backendService.deleteInvalidResponses(this.appService.selectedWorkspaceId, responseIds)
      .subscribe(deletedCount => {
        this.isDeletingResponses = false;
        this.snackBar.open(`${deletedCount} Antworten gelöscht`, 'Schließen', { duration: 3000 });

        // Remove deleted responses from the list
        if (this.variableValidationResult) {
          this.variableValidationResult.invalidVariables = this.variableValidationResult.invalidVariables
            .filter(variable => variable.responseId === undefined || !this.selectedResponses.has(variable.responseId));
        }

        this.selectedResponses.clear();
      });
  }

  toggleExpansion(): void {
    this.expandedPanel = !this.expandedPanel;
  }

  closeWithResults(): void {
    this.dialogRef.close({
      variableValidationResult: this.variableValidationResult
    });
  }
}
