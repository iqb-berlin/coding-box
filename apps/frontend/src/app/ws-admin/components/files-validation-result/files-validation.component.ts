import { Component, Inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef
} from '@angular/material/dialog';
import { NgForOf, NgIf, NgClass } from '@angular/common';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

// Local type for managing expanded state of sections within each booklet validation entry
interface ExpandedBookletSectionsState {
  bookletSelfStatus: boolean; // Though bookletSelfStatus might not be expandable, kept for structure
  units: boolean;
  schemes: boolean;
  definitions: boolean;
  player: boolean;
}

@Component({
  selector: 'files-validation-dialog',
  templateUrl: './files-validation.component.html',
  imports: [
    NgIf,
    NgForOf,
    NgClass,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    TranslateModule,
    MatDialogClose,
    MatIcon
  ],
  styleUrls: ['./files-validation.component.scss']
})
export class FilesValidationDialogComponent {
  // Stores the validation results for all booklets
  bookletValidationResults: any[] = [];

  // Manages the expanded state for each section of each booklet
  expandedStates: Map<string, ExpandedBookletSectionsState> = new Map();

  objectKeys = Object.keys;

  constructor(
    public dialogRef: MatDialogRef<FilesValidationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data && data.bookletValidationResults) {
      this.bookletValidationResults = data.bookletValidationResults;
      // Initialize expanded states for each booklet
      this.bookletValidationResults.forEach(bookletResult => {
        this.expandedStates.set(bookletResult.bookletId, {
          bookletSelfStatus: false, // Typically not an expandable list
          units: false,
          schemes: false,
          definitions: false,
          player: false
        });
      });
    }
  }

  /**
   * Toggles the expanded state of a specific section for a given booklet.
   * @param bookletId The ID of the booklet.
   * @param sectionKey The key of the section to toggle (e.g., 'units', 'schemes').
   */
  toggleFilesList(bookletId: string, sectionKey: keyof ExpandedBookletSectionsState): void {
    const bookletStates = this.expandedStates.get(bookletId);
    if (bookletStates) {
      bookletStates[sectionKey] = !bookletStates[sectionKey];
    }
  }

  /**
   * Checks if a specific section for a given booklet is expanded.
   * @param bookletId The ID of the booklet.
   * @param sectionKey The key of the section to check.
   * @returns True if the section is expanded, false otherwise.
   */
  isFilesListExpanded(bookletId: string, sectionKey: keyof ExpandedBookletSectionsState): boolean {
    const bookletStates = this.expandedStates.get(bookletId);
    return bookletStates ? bookletStates[sectionKey] : false;
  }

  // Helper to get the keys of DataValidation sections for iteration in the template
  getDataValidationSectionKeys(details: any | undefined): any {
    if (!details) return [];
    // Exclude bookletSelfStatus if it's not meant to be displayed as an expandable list in the same way
    return Object.keys(details).filter(key => key !== 'bookletSelfStatus') as (keyof any)[];
  }

  // Helper to get a display name for a section key
  getSectionDisplayName(sectionKey: string): string {
    switch (sectionKey) {
      case 'units': return 'Units';
      case 'schemes': return 'Kodierschemata';
      case 'definitions': return 'Aufgabendefinitionen';
      case 'player': return 'Player';
      case 'bookletSelfStatus': return 'Booklet Datei';
      default: return sectionKey;
    }
  }
}
