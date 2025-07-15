import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatSortModule } from '@angular/material/sort';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

export interface VariableAnalysisData {
  unitId: number;
  title: string;
  responses?: {
    id: number;
    unitid: number;
    variableid: string;
    status: string;
    value: string;
    subform: string;
    code?: number;
    score?: number;
    codedstatus?: string;
    expanded?: boolean;
  }[];
  analysisResults?: {
    variableCombos: {
      unitName: string;
      variableId: string;
    }[];
    frequencies: { [key: string]: {
      unitName?: string;
      variableId: string;
      value: string;
      count: number;
      percentage: number;
    }[] };
    total: number;
  };
}

export interface VariableFrequency {
  unitName?: string;
  variableid: string;
  value: string;
  count: number;
  percentage: number;
}

export interface VariableCombo {
  unitName: string;
  variableId: string;
}

@Component({
  selector: 'coding-box-variable-analysis-dialog',
  templateUrl: './variable-analysis-dialog.component.html',
  styleUrls: ['./variable-analysis-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSortModule,
    MatPaginatorModule,
    MatInputModule,
    MatFormFieldModule
  ]
})
export class VariableAnalysisDialogComponent implements OnInit {
  isLoading = false;
  variableFrequencies: { [key: string]: VariableFrequency[] } = {};
  displayedColumns: string[] = ['value', 'count', 'percentage'];

  allVariableCombos: VariableCombo[] = [];

  // Filtered and paginated variable combinations
  variableCombos: VariableCombo[] = [];

  searchText = '';
  private searchSubject = new Subject<string>();
  currentPage = 0;
  pageSize = 10;
  pageSizeOptions = [5, 10, 25, 50];

  readonly MAX_VALUES_PER_VARIABLE = 20;

  constructor(
    public dialogRef: MatDialogRef<VariableAnalysisDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: VariableAnalysisData
  ) {}

  ngOnInit(): void {
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged()
    ).subscribe(searchText => {
      this.searchText = searchText;
      this.filterVariables();
    });

    this.analyzeVariables();
  }

  analyzeVariables(): void {
    this.isLoading = true;

    // Check if we have pre-calculated analysis results
    if (this.data.analysisResults) {
      // Use the pre-calculated results
      this.allVariableCombos = this.data.analysisResults!.variableCombos;

      // Convert the frequencies to our internal format
      Object.keys(this.data.analysisResults!.frequencies).forEach(comboKey => {
        // Get the first frequency item to extract unitName and variableId
        const firstFreq = this.data.analysisResults!.frequencies[comboKey][0];
        if (firstFreq) {
          // Create a key that matches what we use in the template
          const newComboKey = `${firstFreq.unitName || 'Unknown'}:${firstFreq.variableId}`;

          this.variableFrequencies[newComboKey] = this.data.analysisResults!.frequencies[comboKey].map(freq => ({
            unitName: freq.unitName,
            variableid: freq.variableId,
            value: freq.value,
            count: freq.count,
            percentage: freq.percentage
          }));
        }
      });
    } else if (this.data.responses && this.data.responses.length > 0) {
      // Fall back to the old behavior of analyzing responses
      // Group responses by variableid (without unitName since we don't have that info)
      const responsesByVariable: { [key: string]: { [key: string]: number } } = {};

      // Initialize the variables array with just variableId (no unitName)
      const variableIds = Array.from(new Set(this.data.responses.map(r => r.variableid)));
      this.allVariableCombos = variableIds.map(variableId => ({
        unitName: 'Unknown', // We don't have unitName in the old format
        variableId
      }));

      // Count occurrences of each value for each variable
      this.data.responses.forEach(response => {
        if (!responsesByVariable[response.variableid]) {
          responsesByVariable[response.variableid] = {};
        }

        const value = response.value || '';
        if (!responsesByVariable[response.variableid][value]) {
          responsesByVariable[response.variableid][value] = 0;
        }

        responsesByVariable[response.variableid][value] += 1;
      });

      // Calculate frequencies and percentages
      Object.keys(responsesByVariable).forEach(variableid => {
        const valueMap = responsesByVariable[variableid];
        const totalResponses = Object.values(valueMap).reduce((sum, count) => sum + count, 0);

        // Create a key that matches what we use in the template
        const comboKey = `Unknown:${variableid}`;

        // Sort by count in descending order and limit to MAX_VALUES_PER_VARIABLE
        this.variableFrequencies[comboKey] = Object.keys(valueMap)
          .map(value => {
            const count = valueMap[value];
            return {
              unitName: 'Unknown',
              variableid,
              value,
              count,
              percentage: (count / totalResponses) * 100
            };
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, this.MAX_VALUES_PER_VARIABLE); // Limit the number of values shown
      });
    } else {
      this.allVariableCombos = [];
    }

    // Sort by unitName and then by variableId
    this.allVariableCombos.sort((a, b) => {
      if (a.unitName !== b.unitName) {
        return a.unitName.localeCompare(b.unitName);
      }
      return a.variableId.localeCompare(b.variableId);
    });

    // Initialize the filtered and paginated variables
    this.filterVariables();

    this.isLoading = false;
  }

  /**
   * Filter variable combinations based on search text and update pagination
   */
  filterVariables(): void {
    const filteredCombos = this.searchText ?
      this.allVariableCombos.filter(combo => combo.unitName.toLowerCase().includes(this.searchText.toLowerCase()) ||
        combo.variableId.toLowerCase().includes(this.searchText.toLowerCase())) :
      this.allVariableCombos;

    const startIndex = this.currentPage * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    this.variableCombos = filteredCombos.slice(startIndex, endIndex);
  }

  onSearchChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject.next(value);
  }

  onPageChange(event: PageEvent): void {
    this.currentPage = event.pageIndex;
    this.pageSize = event.pageSize;
    this.filterVariables();
  }

  getTotalFilteredVariables(): number {
    return this.searchText ?
      this.allVariableCombos.filter(combo => combo.unitName.toLowerCase().includes(this.searchText.toLowerCase()) ||
        combo.variableId.toLowerCase().includes(this.searchText.toLowerCase())).length :
      this.allVariableCombos.length;
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
