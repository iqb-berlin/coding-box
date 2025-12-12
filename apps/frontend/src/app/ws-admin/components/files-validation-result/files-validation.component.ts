import { Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { FormsModule } from '@angular/forms';
import { SelectionModel } from '@angular/cdk/collections';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { TranslateModule } from '@ngx-translate/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { WorkspaceService } from '../../../services/workspace.service';
import { BackendService } from '../../../services/backend.service';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { SchemeEditorDialogComponent } from '../../../coding/components/scheme-editor-dialog/scheme-editor-dialog.component';
import { UnitDefinitionPlayerDialogComponent } from '../unit-definition-player-dialog/unit-definition-player-dialog.component';
import { DuplicateTestTaker, UnusedTestFile } from '../../../../../../../api-dto/files/file-validation-result.dto';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';

type FileStatus = {
  filename: string;
  exists: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
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
  schemer: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
};

interface ExpandedFilesLists {
  booklets: boolean;
  units: boolean;
  schemes: boolean;
  schemer: boolean;
  definitions: boolean;
  player: boolean;
}

@Component({
  selector: 'files-validation-dialog',
  templateUrl: './files-validation.component.html',
  imports: [
    MatDialogModule,
    MatButtonModule,
    TranslateModule,
    MatIcon,
    MatTabsModule,
    MatTooltip,
    MatCheckbox,
    FormsModule,
    ScrollingModule,
    MatExpansionModule
  ],
  styleUrls: ['./files-validation.component.scss']
})
export class FilesValidationDialogComponent {
  dialogRef = inject<MatDialogRef<FilesValidationDialogComponent>>(MatDialogRef);
  private dialog = inject(MatDialog);

  data = inject<{
    validationResults: FilesValidation[];
    filteredTestTakers?: FilteredTestTaker[];
    duplicateTestTakers?: DuplicateTestTaker[];
    unusedTestFiles?: UnusedTestFile[];
    workspaceId?: number;
  }>(MAT_DIALOG_DATA);

  expandedFilesLists: Map<string, ExpandedFilesLists> = new Map();

  filteredTestTakers: FilteredTestTaker[] = [];
  duplicateTestTakers: DuplicateTestTaker[] = [];
  unusedTestFiles: UnusedTestFile[] = [];

  selection = new SelectionModel<FilteredTestTaker>(true, []);
  duplicateSelection = new Map<string, string>(); // Maps login to selected testTaker file

  unusedFilesSelection = new SelectionModel<UnusedTestFile>(true, []);
  allUnusedFilesSelected = false;
  isDeletingUnusedFiles = false;

  modeGroups: { mode: string, count: number }[] = [];

  allSelected = false;
  isResolvingDuplicates = false;

  private workspaceService = inject(WorkspaceService);
  private backendService = inject(BackendService);
  private snackBar = inject(MatSnackBar);

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
            schemer: false,
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

      if (this.data.duplicateTestTakers) {
        this.duplicateTestTakers = this.data.duplicateTestTakers;

        // Initialize selection with the first occurrence for each duplicate
        this.duplicateTestTakers.forEach(duplicate => {
          if (duplicate.occurrences.length > 0) {
            this.duplicateSelection.set(duplicate.login, duplicate.occurrences[0].testTaker);
          }
        });
      }

      if (this.data.unusedTestFiles) {
        this.unusedTestFiles = this.data.unusedTestFiles;
      }
    }
  }

  toggleUnusedFilesSelection(file: UnusedTestFile): void {
    this.unusedFilesSelection.toggle(file);
    this.checkIfAllUnusedFilesSelected();
  }

  toggleAllUnusedFilesSelection(): void {
    if (this.allUnusedFilesSelected) {
      this.unusedFilesSelection.clear();
      this.allUnusedFilesSelected = false;
    } else {
      this.unusedFilesSelection.select(...this.unusedTestFiles);
      this.allUnusedFilesSelected = true;
    }
  }

  checkIfAllUnusedFilesSelected(): void {
    this.allUnusedFilesSelected = this.unusedTestFiles.length > 0 &&
                                 this.unusedFilesSelection.selected.length === this.unusedTestFiles.length;
  }

  deleteSelectedUnusedFiles(): void {
    if (!this.data.workspaceId || this.unusedFilesSelection.selected.length === 0 || this.isDeletingUnusedFiles) {
      return;
    }

    this.isDeletingUnusedFiles = true;
    const idsToDelete = this.unusedFilesSelection.selected.map(f => f.id);

    this.backendService.deleteFiles(this.data.workspaceId, idsToDelete)
      .subscribe({
        next: success => {
          if (success) {
            this.unusedTestFiles = this.unusedTestFiles.filter(f => !idsToDelete.includes(f.id));
            this.unusedFilesSelection.clear();
            this.checkIfAllUnusedFilesSelected();
          }
          this.isDeletingUnusedFiles = false;
        },
        error: () => {
          this.isDeletingUnusedFiles = false;
        }
      });
  }

  getExistingCount(data: DataValidation): number {
    return data.files.filter(file => file.exists).length;
  }

  getMissingCount(data: DataValidation): number {
    return data.files.filter(file => !file.exists).length;
  }

  // Select which occurrence of a duplicate test taker to keep
  selectDuplicateOccurrence(login: string, testTaker: string): void {
    this.duplicateSelection.set(login, testTaker);
  }

  // Get the selected occurrence for a duplicate test taker
  getSelectedOccurrence(login: string): string | undefined {
    return this.duplicateSelection.get(login);
  }

  // Resolve duplicate test takers by keeping only the selected occurrences
  resolveDuplicateTestTakers(): void {
    if (!this.data.workspaceId || this.duplicateTestTakers.length === 0 || this.isResolvingDuplicates) {
      return;
    }

    this.isResolvingDuplicates = true;

    // Create a map of login -> selected testTaker file
    const resolutionMap = new Map<string, string>();
    this.duplicateTestTakers.forEach(duplicate => {
      const selectedTestTaker = this.duplicateSelection.get(duplicate.login);
      if (selectedTestTaker) {
        resolutionMap.set(duplicate.login, selectedTestTaker);
      }
    });

    // Call service to resolve duplicates
    this.workspaceService.resolveDuplicateTestTakers(this.data.workspaceId, Object.fromEntries(resolutionMap))
      .subscribe({
        next: success => {
          if (success) {
            // Remove resolved duplicates from the list
            this.duplicateTestTakers = [];
          }
          this.isResolvingDuplicates = false;
        },
        error: () => {
          this.isResolvingDuplicates = false;
        }
      });
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

  openBookletInfo(bookletId: string): void {
    if (!this.data.workspaceId || !bookletId) {
      return;
    }

    const normalizedBookletId = bookletId.toUpperCase();

    const loadingSnackBar = this.snackBar.open(
      'Lade Testheft-Informationen...',
      '',
      { duration: 3000 }
    );

    this.backendService.getBookletInfo(
      this.data.workspaceId,
      normalizedBookletId
    ).subscribe({
      next: bookletInfo => {
        loadingSnackBar.dismiss();

        this.dialog.open(BookletInfoDialogComponent, {
          width: '1200px',
          height: '80vh',
          data: {
            bookletInfo,
            bookletId: normalizedBookletId
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Testheft-Informationen',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  openUnitInfo(unitId: string): void {
    if (!this.data.workspaceId || !unitId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Aufgaben-Informationen...',
      '',
      { duration: 3000 }
    );

    this.backendService.getUnitInfo(
      this.data.workspaceId,
      unitId
    ).subscribe({
      next: unitInfo => {
        loadingSnackBar.dismiss();

        this.dialog.open(UnitInfoDialogComponent, {
          width: '1200px',
          height: '80vh',
          data: {
            unitInfo,
            unitId
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Aufgaben-Informationen',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  openSchemeFile(schemeId: string): void {
    if (!this.data.workspaceId || !schemeId) {
      return;
    }

    const loadingSnackBar = this.snackBar.open(
      'Lade Ressourcendatei...',
      '',
      { duration: 3000 }
    );

    this.backendService.getCodingSchemeFile(
      this.data.workspaceId,
      schemeId
    ).subscribe({
      next: fileDownload => {
        loadingSnackBar.dismiss();

        if (!fileDownload) {
          this.snackBar.open(
            'Ressourcendatei nicht gefunden.',
            'Fehler',
            { duration: 3000 }
          );
          return;
        }

        let decodedContent: string;
        try {
          decodedContent = atob(fileDownload.base64Data);
        } catch {
          decodedContent = fileDownload.base64Data;
        }

        this.dialog.open(SchemeEditorDialogComponent, {
          width: '100vw',
          height: '90vh',
          data: {
            workspaceId: this.data.workspaceId,
            fileId: fileDownload.filename || schemeId,
            fileName: fileDownload.filename || schemeId,
            content: decodedContent
          }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Ressourcendatei',
          'Fehler',
          { duration: 3000 }
        );
      }
    });
  }

  openDefinitionFile(definitionRef: string): void {
    if (!this.data.workspaceId || !definitionRef) {
      return;
    }

    const upperRef = definitionRef.toUpperCase();
    const unitId = upperRef.endsWith('.VOUD') ? upperRef.slice(0, -5) : upperRef;

    this.dialog.open(UnitDefinitionPlayerDialogComponent, {
      width: '1200px',
      height: '80vh',
      data: {
        workspaceId: this.data.workspaceId!,
        unitId
      }
    });
  }

  showTestTakerXml(testTakerId: string): void {
    if (!this.data.workspaceId || !testTakerId) {
      return;
    }

    this.backendService.getTestTakerContentXml(this.data.workspaceId, testTakerId)
      .subscribe(xmlContent => {
        if (xmlContent) {
          this.dialog.open(ContentDialogComponent, {
            width: '80%',
            data: {
              title: `TestTakers XML: ${testTakerId}`,
              content: xmlContent,
              isXml: true
            }
          });
        } else {
          this.snackBar.open(
            `Keine XML-Daten für TestTaker-Datei ${testTakerId} gefunden`,
            'Schließen',
            { duration: 3000 }
          );
        }
      });
  }
}
