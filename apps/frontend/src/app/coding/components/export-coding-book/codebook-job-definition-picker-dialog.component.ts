import { CommonModule } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import { JobDefinition } from '../../services/coding-job-backend.service';

export interface CodebookJobDefinitionOption {
  id: number;
  jobDefinition: JobDefinition;
  label: string;
  meta: string;
  bundleSummary: string;
  summary: string;
}

export interface CodebookJobDefinitionPickerDialogData {
  options: CodebookJobDefinitionOption[];
  selectedJobDefinitionId: number | null;
}

@Component({
  selector: 'coding-box-codebook-job-definition-picker-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatTooltipModule,
    TranslateModule
  ],
  templateUrl: './codebook-job-definition-picker-dialog.component.html',
  styleUrls: ['./codebook-job-definition-picker-dialog.component.scss']
})
export class CodebookJobDefinitionPickerDialogComponent {
  filterText = '';
  selectedJobDefinitionId: number | null = this.data.selectedJobDefinitionId;

  constructor(
    public dialogRef: MatDialogRef<CodebookJobDefinitionPickerDialogComponent, number | null | undefined>,
    @Inject(MAT_DIALOG_DATA) public data: CodebookJobDefinitionPickerDialogData
  ) {}

  get filteredOptions(): CodebookJobDefinitionOption[] {
    const normalizedFilter = this.filterText.trim().toLowerCase();
    if (!normalizedFilter) {
      return this.data.options;
    }

    return this.data.options.filter(option => this.optionMatchesFilter(option, normalizedFilter));
  }

  get selectedOption(): CodebookJobDefinitionOption | undefined {
    if (this.selectedJobDefinitionId === null) {
      return undefined;
    }

    return this.data.options.find(option => option.id === this.selectedJobDefinitionId);
  }

  selectJobDefinition(jobDefinitionId: number | null): void {
    this.selectedJobDefinitionId = jobDefinitionId;
  }

  clearFilter(): void {
    this.filterText = '';
  }

  applySelection(): void {
    this.dialogRef.close(this.selectedJobDefinitionId);
  }

  private optionMatchesFilter(
    option: CodebookJobDefinitionOption,
    normalizedFilter: string
  ): boolean {
    return [
      option.label,
      option.meta,
      option.bundleSummary,
      String(option.id)
    ].some(value => value.toLowerCase().includes(normalizedFilter));
  }
}
