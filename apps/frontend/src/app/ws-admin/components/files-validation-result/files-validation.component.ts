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

interface ExpandedBookletSectionsState {
  bookletSelfStatus: boolean;
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
  bookletValidationResults: any[] = [];

  expandedStates: Map<string, ExpandedBookletSectionsState> = new Map();

  objectKeys = Object.keys;

  constructor(
    public dialogRef: MatDialogRef<FilesValidationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data && data.bookletValidationResults) {
      this.bookletValidationResults = data.bookletValidationResults;
      this.bookletValidationResults.forEach(bookletResult => {
        this.expandedStates.set(bookletResult.bookletId, {
          bookletSelfStatus: false,
          units: false,
          schemes: false,
          definitions: false,
          player: false
        });
      });
    }
  }

  toggleFilesList(bookletId: string, sectionKey: keyof ExpandedBookletSectionsState): void {
    const bookletStates = this.expandedStates.get(bookletId);
    if (bookletStates) {
      bookletStates[sectionKey] = !bookletStates[sectionKey];
    }
  }

  isFilesListExpanded(bookletId: string, sectionKey: keyof ExpandedBookletSectionsState): boolean {
    const bookletStates = this.expandedStates.get(bookletId);
    return bookletStates ? bookletStates[sectionKey] : false;
  }

  getDataValidationSectionKeys(details: any | undefined): any {
    if (!details) return [];
    return Object.keys(details).filter(key => key !== 'bookletSelfStatus') as (keyof any)[];
  }

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
