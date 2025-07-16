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
import { MatIcon } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

type FileStatus = {
  filename: string;
  exists: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  unused?: string[];
  files: FileStatus[];
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
    MatIcon
  ],
  styleUrls: ['./files-validation.component.scss']
})
export class FilesValidationDialogComponent {
  dialogRef = inject<MatDialogRef<FilesValidationDialogComponent>>(MatDialogRef);
  data = inject<FilesValidation[]>(MAT_DIALOG_DATA);
  expandedFilesLists: Map<string, ExpandedFilesLists> = new Map();

  constructor() {
    const data = this.data;
    if (data) {
      data.forEach((val: FilesValidation) => {
        this.expandedFilesLists.set(val.testTaker, {
          booklets: false,
          units: false,
          schemes: false,
          definitions: false,
          player: false
        });
      });
    }
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
}
