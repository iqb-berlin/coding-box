import { Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef
} from '@angular/material/dialog';
import { NgClass } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TranslateModule } from '@ngx-translate/core';
import { WorkspaceService } from '../../../services/workspace.service';

type FileStatus = {
  filename: string;
  exists: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  unused?: string[];
  unusedBooklets?: string[];
  files: FileStatus[];
};

type FilteredTestTaker = {
  testTaker: string;
  mode: string;
  login: string;
};

type FilesValidation = {
  testTaker: string,
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
};

interface ExpandedFilesLists {
  booklets: boolean;
  units: boolean;
  schemes: boolean;
  definitions: boolean;
  player: boolean;
}

@Component({
  selector: 'files-validation-dialog',
  templateUrl: './files-validation.component.html',
  imports: [
    NgClass,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslateModule,
    MatDialogClose,
    MatIcon,
    MatCheckbox,
    FormsModule,
    ScrollingModule
  ],
  styleUrls: ['./files-validation.component.scss']
})
export class FilesValidationDialogComponent {
  dialogRef = inject<MatDialogRef<FilesValidationDialogComponent>>(MatDialogRef);

  data = inject<{
    validationResults: FilesValidation[];
    filteredTestTakers?: FilteredTestTaker[];
    workspaceId?: number;
  }>(MAT_DIALOG_DATA);

  expandedFilesLists: Map<string, ExpandedFilesLists> = new Map();

  filteredTestTakers: FilteredTestTaker[] = [];

  selection = new SelectionModel<FilteredTestTaker>(true, []);

  modeGroups: { mode: string, count: number }[] = [];

  allSelected = false;

  private workspaceService = inject(WorkspaceService);

  isExcluding = false;
  excludingProgress = 0;

  constructor() {
    if (this.data) {
      if (this.data.validationResults) {
        this.data.validationResults.forEach((val: FilesValidation) => {
          this.expandedFilesLists.set(val.testTaker, {
            booklets: false,
            units: false,
            schemes: false,
            definitions: false,
            player: false
          });
        });
      }

      if (this.data.filteredTestTakers) {
        this.filteredTestTakers = this.data.filteredTestTakers;

        const modeMap = new Map<string, number>();
        this.filteredTestTakers.forEach(item => {
          const count = modeMap.get(item.mode) || 0;
          modeMap.set(item.mode, count + 1);
        });

        this.modeGroups = Array.from(modeMap.entries()).map(([mode, count]) => ({ mode, count }));
      }
    }
  }

  toggleSelection(testTaker: FilteredTestTaker): void {
    this.selection.toggle(testTaker);
    this.checkIfAllSelected();
  }

  toggleAllSelection(): void {
    if (this.allSelected) {
      this.selection.clear();
      this.allSelected = false;
    } else {
      if (this.filteredTestTakers.length > 1000) {
        // For very large datasets, use batch processing
        const batchSize = 500;
        const totalItems = this.filteredTestTakers.length;

        const processBatch = (startIndex: number) => {
          const endIndex = Math.min(startIndex + batchSize, totalItems);

          for (let i = startIndex; i < endIndex; i++) {
            this.selection.select(this.filteredTestTakers[i]);
          }

          if (endIndex < totalItems) {
            setTimeout(() => processBatch(endIndex), 0);
          }
        };

        processBatch(0);
      } else {
        // For smaller datasets, select all at once
        this.selection.select(...this.filteredTestTakers);
      }

      this.allSelected = true;
    }
  }

  toggleModeSelection(mode: string): void {
    const testTakersWithMode = this.filteredTestTakers.filter(item => item.mode === mode);

    if (testTakersWithMode.length === 0) {
      return;
    }

    const allModeSelected = testTakersWithMode.every(item => this.selection.isSelected(item));

    if (testTakersWithMode.length > 500) {
      const batchSize = 200;
      const totalItems = testTakersWithMode.length;

      const processBatch = (startIndex: number) => {
        const endIndex = Math.min(startIndex + batchSize, totalItems);

        for (let i = startIndex; i < endIndex; i++) {
          if (allModeSelected) {
            this.selection.deselect(testTakersWithMode[i]);
          } else {
            this.selection.select(testTakersWithMode[i]);
          }
        }

        if (endIndex < totalItems) {
          setTimeout(() => processBatch(endIndex), 0);
        } else {
          // When all batches are processed, check if all items are selected
          this.checkIfAllSelected();
        }
      };

      // Start batch processing
      processBatch(0);
    } else {
      // For smaller datasets, process all at once
      if (allModeSelected) {
        // Deselect all test takers with this mode
        testTakersWithMode.forEach(item => this.selection.deselect(item));
      } else {
        // Select all test takers with this mode
        this.selection.select(...testTakersWithMode);
      }

      this.checkIfAllSelected();
    }
  }

  checkIfAllSelected(): void {
    this.allSelected = this.filteredTestTakers.length > 0 &&
                       this.selection.selected.length === this.filteredTestTakers.length;
  }

  isModeSelected(mode: string): boolean {
    return this.filteredTestTakers
      .filter(item => item.mode === mode)
      .every(item => this.selection.isSelected(item));
  }

  markTestTakersAsExcluded(): void {
    if (!this.data.workspaceId || this.selection.selected.length === 0 || this.isExcluding) {
      return;
    }

    this.isExcluding = true;
    this.excludingProgress = 0;

    if (this.selection.selected.length > 500) {
      // Process in batches of 500 items
      const batchSize = 500;
      const selectedItems = [...this.selection.selected];
      const totalItems = selectedItems.length;

      const processBatch = (startIndex: number) => {
        const endIndex = Math.min(startIndex + batchSize, totalItems);
        const batchItems = selectedItems.slice(startIndex, endIndex);

        const batchLogins = batchItems.map(item => item.login);

        // Call service to mark this batch as excluded
        this.workspaceService.markTestTakersAsExcluded(this.data.workspaceId!, batchLogins)
          .subscribe({
            next: success => {
              if (success) {
                // Remove the processed items from the list
                this.filteredTestTakers = this.filteredTestTakers.filter(
                  item => !batchItems.some(selected => selected.login === item.login)
                );

                // Update progress
                this.excludingProgress = Math.round((endIndex / totalItems) * 100);

                // If more batches remain, process the next batch
                if (endIndex < totalItems) {
                  // Update progress before processing next batch
                  setTimeout(() => processBatch(endIndex), 100);
                } else {
                  // All batches processed
                  this.selection.clear();
                  this.updateModeGroups();
                  this.isExcluding = false;
                  this.excludingProgress = 0;
                }
              } else {
                this.isExcluding = false;
                this.excludingProgress = 0;
              }
            },
            error: () => {
              this.isExcluding = false;
              this.excludingProgress = 0;
            }
          });
      };

      // Start batch processing
      processBatch(0);
    } else {
      // For smaller datasets, process all at once
      const logins = this.selection.selected.map(item => item.login);

      // For smaller datasets, show 50% progress immediately and 100% when done
      this.excludingProgress = 50;

      // Call service to mark these test takers as excluded
      this.workspaceService.markTestTakersAsExcluded(this.data.workspaceId!, logins)
        .subscribe({
          next: success => {
            if (success) {
              // Success - remove the selected test takers from the list
              this.filteredTestTakers = this.filteredTestTakers.filter(
                item => !this.selection.isSelected(item)
              );
              this.selection.clear();
              this.updateModeGroups();
            }
            this.isExcluding = false;
            this.excludingProgress = 0;
          },
          error: () => {
            this.isExcluding = false;
            this.excludingProgress = 0;
          }
        });
    }
  }

  private updateModeGroups(): void {
    const modeMap = new Map<string, number>();
    this.filteredTestTakers.forEach(item => {
      const count = modeMap.get(item.mode) || 0;
      modeMap.set(item.mode, count + 1);
    });

    this.modeGroups = Array.from(modeMap.entries()).map(([mode, count]) => ({ mode, count }));
  }

  toggleFilesList(testTaker: string, section: keyof ExpandedFilesLists): void {
    const sections = this.expandedFilesLists.get(testTaker);
    if (sections) {
      sections[section] = !sections[section];
    }
  }

  isFilesListExpanded(testTaker: string, section: keyof ExpandedFilesLists): boolean {
    const sections = this.expandedFilesLists.get(testTaker);
    return sections ? sections[section] : false;
  }

  trackByFn(index: number, item: FilteredTestTaker): string {
    return `${item.testTaker}-${item.login}-${item.mode}`;
  }
}
