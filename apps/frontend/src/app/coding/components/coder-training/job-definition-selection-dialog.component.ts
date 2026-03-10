import { Component, inject } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { CodingJobDefinitionsComponent } from '../coding-job-definitions/coding-job-definitions.component';
import { JobDefinition } from '../../services/coding-job-backend.service';

@Component({
  selector: 'coding-box-job-definition-selection-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    CodingJobDefinitionsComponent
  ],
  template: `
    <div class="dialog-header">
      <h2>Job-Definition auswählen</h2>
      <button mat-icon-button (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <div class="dialog-config">
      <mat-form-field appearance="outline" class="sample-count-field">
        <mat-label>Standard-Stichprobenanzahl</mat-label>
        <input matInput type="number" [formControl]="defaultSampleCountControl" min="1" max="1000">
        <mat-hint>Dieser Wert wird für alle importierten Variablen verwendet</mat-hint>
      </mat-form-field>
    </div>
    <div class="dialog-content">
      <coding-box-coding-job-definitions
        [selectionMode]="true"
        (definitionSelected)="onSelect($event)">
      </coding-box-coding-job-definitions>
    </div>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      border-bottom: 1px solid var(--color-border-light, #e0e0e0);
    }
    .dialog-header h2 {
      margin: 0;
      font-size: 20px;
    }
    .dialog-config {
      padding: 16px 24px;
      background-color: #f5f5f5;
      border-bottom: 1px solid var(--color-border-light, #e0e0e0);
    }
    .sample-count-field {
      width: 100%;
      max-width: 300px;
    }
    .dialog-content {
      padding: 24px;
      height: 60vh;
      overflow-y: auto;
    }
  `]
})
export class JobDefinitionSelectionDialogComponent {
  private dialogRef = inject(MatDialogRef<JobDefinitionSelectionDialogComponent>);

  defaultSampleCountControl = new FormControl(10, [
    Validators.required,
    Validators.min(1),
    Validators.max(1000)
  ]);

  close(): void {
    this.dialogRef.close();
  }

  onSelect(definition: JobDefinition): void {
    if (this.defaultSampleCountControl.valid) {
      this.dialogRef.close({
        jobDefinition: definition,
        defaultSampleCount: this.defaultSampleCountControl.value
      });
    }
  }
}
