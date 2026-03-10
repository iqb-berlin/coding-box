import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { JobDefinition } from '../../../coding/services/coding-job-backend.service';
import { CoderTraining } from '../../../coding/models/coder-training.model';
import { Coder } from '../../../coding/models/coder.model';

export interface ExportSelectionDialogData {
  jobDefinitions: JobDefinition[];
  coderTrainings: CoderTraining[];
  coders: Coder[];
  selectedCombinedJobIds: string[];
}

export interface ExportSelectionDialogResult {
  selectedCombinedJobIds: string[];
}

@Component({
  selector: 'coding-box-export-selection-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatTabsModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>Filter auswählen</h2>

    <mat-dialog-content class="dialog-content">
      <mat-tab-group>
        <mat-tab label="Job-Definitionen">
          <div class="section">
            <div class="list">
              <mat-expansion-panel *ngFor="let def of data.jobDefinitions" class="definition-panel">
                <mat-expansion-panel-header>
                  <mat-panel-title>
                    <mat-checkbox
                      [checked]="isSelected(jobValue(def))"
                      (click)="$event.stopPropagation()"
                      (change)="toggle(jobValue(def))">
                      Definition #{{ def.id }} {{ def.status ? '(' + def.status + ')' : '' }}
                    </mat-checkbox>
                  </mat-panel-title>
                  <mat-panel-description>
                    {{ getDefinitionSummary(def) }}
                  </mat-panel-description>
                </mat-expansion-panel-header>

                <div class="details">
                  <div class="details-row">
                    <div class="details-title">Kodierer</div>
                    <div class="details-value">{{ getDefinitionCoders(def) || '-' }}</div>
                  </div>

                  <div class="details-row">
                    <div class="details-title">Variablen</div>
                    <div class="details-value prewrap">{{ getDefinitionVariables(def) || '-' }}</div>
                  </div>

                  <div class="details-row">
                    <div class="details-title">Variablenbündel</div>
                    <div class="details-value prewrap">{{ getDefinitionBundles(def) || '-' }}</div>
                  </div>
                </div>
              </mat-expansion-panel>

              <div *ngIf="!data.jobDefinitions?.length" class="empty">Keine Job-Definitionen vorhanden.</div>
            </div>
          </div>
        </mat-tab>

        <mat-tab label="Coder-Trainings">
          <div class="section">
            <div class="list">
              <div *ngFor="let training of data.coderTrainings" class="training-row">
                <mat-checkbox
                  [checked]="isSelected(trainingValue(training))"
                  (change)="toggle(trainingValue(training))">
                  {{ training.label || ('Training #' + training.id) }}
                </mat-checkbox>
              </div>
              <div *ngIf="!data.coderTrainings?.length" class="empty">Keine Coder-Trainings vorhanden.</div>
            </div>
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="clear()">Zurücksetzen</button>
      <button mat-button (click)="cancel()">Abbrechen</button>
      <button mat-raised-button color="primary" (click)="apply()">
        Übernehmen
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-content {
      width: min(1100px, 92vw);
      max-width: 92vw;
      max-height: 70vh;
      overflow: auto;
    }

    .section {
      padding: 12px 4px;
    }

    .list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .definition-panel {
      border: 1px solid rgba(0, 0, 0, 0.08);
    }

    .details {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 8px 0;
    }

    .details-row {
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 12px;
      align-items: start;
    }

    .details-title {
      font-weight: 600;
      color: rgba(0, 0, 0, 0.72);
    }

    .details-value {
      color: rgba(0, 0, 0, 0.84);
    }

    .prewrap {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.35;
    }

    .training-row {
      padding: 6px 0;
    }

    .empty {
      padding: 12px 0;
      color: rgba(0, 0, 0, 0.6);
    }
  `]
})
export class ExportSelectionDialogComponent {
  private selected = new Set<string>();

  constructor(
    public dialogRef: MatDialogRef<ExportSelectionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ExportSelectionDialogData
  ) {
    for (const id of data.selectedCombinedJobIds ?? []) {
      this.selected.add(id);
    }
  }

  jobValue(def: JobDefinition): string {
    return `job_${def.id}`;
  }

  trainingValue(training: CoderTraining): string {
    return `training_${training.id}`;
  }

  isSelected(value: string): boolean {
    return this.selected.has(value);
  }

  toggle(value: string): void {
    if (this.selected.has(value)) this.selected.delete(value);
    else this.selected.add(value);
  }

  clear(): void {
    this.selected.clear();
  }

  cancel(): void {
    this.dialogRef.close();
  }

  apply(): void {
    const result: ExportSelectionDialogResult = {
      selectedCombinedJobIds: Array.from(this.selected)
    };
    this.dialogRef.close(result);
  }

  getDefinitionSummary(def: JobDefinition): string {
    const varsCount = def.assignedVariables?.length ?? 0;
    const bundlesCount = def.assignedVariableBundles?.length ?? 0;
    const codersCount = def.assignedCoders?.length ?? 0;
    return `${varsCount} Variablen, ${bundlesCount} Bündel, ${codersCount} Kodierer`;
  }

  getDefinitionVariables(def: JobDefinition): string {
    const vars = def.assignedVariables ?? [];
    return vars.map(v => `${v.unitName}_${v.variableId}`).join(', ');
  }

  getDefinitionBundles(def: JobDefinition): string {
    const bundles = def.assignedVariableBundles ?? [];
    return bundles
      .map(b => {
        const count = b.variables?.length ?? 0;
        return `${b.name}${count ? ` (${count})` : ''}`;
      })
      .join(', ');
  }

  getDefinitionCoders(def: JobDefinition): string {
    const coderIds = def.assignedCoders ?? [];
    const codersById = new Map<number, Coder>();
    for (const coder of this.data.coders ?? []) {
      codersById.set(coder.id, coder);
    }

    return coderIds
      .map(id => {
        const coder = codersById.get(id);
        return coder?.displayName || coder?.name || `${id}`;
      })
      .join(', ');
  }
}
