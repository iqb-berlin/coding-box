import { CommonModule } from '@angular/common';
import { Component, Inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { forkJoin } from 'rxjs';
import { TestResultBackendService } from '../../../shared/services/test-result/test-result-backend.service';
import { FileBackendService } from '../../../shared/services/file/file-backend.service';
import { UnitVariableDetailsDto } from '../../../models/unit-variable-details.dto';
import { TestResultsResponseCleanupRequestDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';

export interface TestResultsResponseCleanupDialogData {
  workspaceId: number;
}

interface VariableOption {
  unitName: string;
  value: string;
  label: string;
}

@Component({
  selector: 'coding-box-test-results-response-cleanup-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule
  ],
  templateUrl: './test-results-response-cleanup-dialog.component.html',
  styleUrls: ['./test-results-response-cleanup-dialog.component.scss']
})
export class TestResultsResponseCleanupDialogComponent implements OnInit {
  availableUnits: string[] = [];
  private variableOptions: VariableOption[] = [];
  selectedUnitNames: string[] = [];
  selectedVariableIds: string[] = [];
  answeredFrom = '';
  answeredBefore = '';
  subformsText = '';
  isLoading = false;
  loadFailed = false;

  constructor(
    private dialogRef: MatDialogRef<
    TestResultsResponseCleanupDialogComponent,
    TestResultsResponseCleanupRequestDto | false
    >,
    private testResultBackendService: TestResultBackendService,
    private fileBackendService: FileBackendService,
    @Inject(MAT_DIALOG_DATA) public data: TestResultsResponseCleanupDialogData
  ) {}

  ngOnInit(): void {
    this.isLoading = true;
    forkJoin({
      exportOptions:
        this.testResultBackendService.getExportOptions(this.data.workspaceId),
      unitVariables: this.fileBackendService.getUnitVariables(
        this.data.workspaceId
      )
    }).subscribe({
      next: ({ exportOptions, unitVariables }) => {
        this.availableUnits = Array.from(
          new Set((exportOptions.units || []).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b));
        this.variableOptions = this.buildVariableOptions(unitVariables);
        this.isLoading = false;
      },
      error: () => {
        this.loadFailed = true;
        this.isLoading = false;
      }
    });
  }

  get availableVariables(): VariableOption[] {
    const selectedUnits = new Set(
      this.selectedUnitNames.map(TestResultsResponseCleanupDialogComponent.normalizeUnitName)
    );
    return this.variableOptions
      .filter(option => selectedUnits.has(
        TestResultsResponseCleanupDialogComponent.normalizeUnitName(
          option.unitName
        )
      ))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  get canSubmit(): boolean {
    return this.selectedUnitNames.length > 0 &&
      this.toTimestamp(this.answeredBefore) !== null &&
      (
        !this.answeredFrom ||
        (
          this.toTimestamp(this.answeredFrom) !== null &&
          (this.toTimestamp(this.answeredFrom) || 0) <
            (this.toTimestamp(this.answeredBefore) || 0)
        )
      );
  }

  onUnitsChanged(): void {
    const available = new Set(this.availableVariables.map(option => option.value));
    this.selectedVariableIds = this.selectedVariableIds.filter(
      variableId => available.has(variableId)
    );
  }

  submit(): void {
    if (!this.canSubmit) {
      return;
    }

    const answeredBefore = this.toTimestamp(this.answeredBefore);
    if (!answeredBefore) {
      return;
    }

    const answeredFrom = this.toTimestamp(this.answeredFrom);
    const request: TestResultsResponseCleanupRequestDto = {
      unitNames: this.selectedUnitNames,
      answeredBefore,
      variableIds: this.selectedVariableIds,
      subforms: this.parseSubforms()
    };

    if (answeredFrom) {
      request.answeredFrom = answeredFrom;
    }

    this.dialogRef.close(request);
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  private buildVariableOptions(
    units: UnitVariableDetailsDto[]
  ): VariableOption[] {
    const options = new Map<string, VariableOption>();
    units.forEach(unit => {
      unit.variables.forEach(variable => {
        [variable.alias || variable.id]
          .map(value => String(value || '').trim())
          .filter(Boolean)
          .forEach(value => {
            const key = `${unit.unitName}\u001F${value}`;
            if (!options.has(key)) {
              options.set(key, {
                unitName: unit.unitName,
                value,
                label: value
              });
            }
          });
      });
    });
    return Array.from(options.values());
  }

  private parseSubforms(): string[] {
    return Array.from(
      new Set(
        this.subformsText
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
      )
    );
  }

  private toTimestamp(value: string): number | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return null;
    }

    const timestamp = new Date(trimmed).getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }

  private static normalizeUnitName(value: string): string {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\.XML$/i, '');
  }
}
