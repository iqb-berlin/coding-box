import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  OnInit
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MetadataResolver } from '@iqb/metadata-resolver';
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
import { MatSnackBar, MatSnackBarRef, TextOnlySnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { WorkspaceService } from '../../../workspace/services/workspace.service';
import { FileService } from '../../../shared/services/file/file.service';
import { TestResultService } from '../../../shared/services/test-result/test-result.service';
import { BookletInfoDialogComponent } from '../booklet-info-dialog/booklet-info-dialog.component';
import { UnitInfoDialogComponent } from '../unit-info-dialog/unit-info-dialog.component';
import { SchemeEditorDialogComponent } from '../../../coding/components/scheme-editor-dialog/scheme-editor-dialog.component';
import { UnitDefinitionPlayerDialogComponent } from '../unit-definition-player-dialog/unit-definition-player-dialog.component';
import {
  DuplicateTestTaker,
  FileValidationResultDto,
  UnusedTestFile
} from '../../../../../../../api-dto/files/file-validation-result.dto';
import { ContentDialogComponent } from '../../../shared/dialogs/content-dialog/content-dialog.component';
import {
  AffectedUnitsDialogComponent,
  AffectedUnitsDialogResult
} from './affected-units-dialog.component';
import { MetadataDialogComponent } from '../../../shared/dialogs/metadata-dialog/metadata-dialog.component';
import { base64ToUtf8 } from '../../../shared/utils/common-utils';
import { BookletInfoDto } from '../../../../../../../api-dto/booklet-info/booklet-info.dto';
import { BookletTestletDto } from '../../../../../../../api-dto/booklet-info/booklet-testlet.dto';
import { BookletUnitDto } from '../../../../../../../api-dto/booklet-info/booklet-unit.dto';

type FileStatus = {
  filename: string;
  exists: boolean;
  schemaValid?: boolean;
  schemaErrors?: string[];
  ignored?: boolean;
  parents?: string[];
};

type TestletDto = {
  id: string;
  label?: string;
  ignored?: boolean;
};

type DataValidation = {
  complete: boolean;
  missing: string[];
  missingUnitsPerBooklet?: { booklet: string; missingUnits: string[] }[];
  unitsWithoutPlayer?: string[];
  missingRefsPerUnit?: { unit: string; missingRefs: string[] }[];
  files: FileStatus[];
  testlets?: TestletDto[];
};

type FilteredTestTaker = {
  testTaker: string;
  mode: string;
  login: string;
  consider?: boolean | null;
};

type FilesValidation = {
  testTaker: string,
  testTakerSchemaValid?: boolean;
  testTakerSchemaErrors?: string[];
  booklets: DataValidation;
  units: DataValidation;
  schemes: DataValidation;
  schemer: DataValidation;
  definitions: DataValidation;
  player: DataValidation;
  metadata: DataValidation;
};

interface ExpandedFilesLists {
  booklets: boolean;
  units: boolean;
  schemes: boolean;
  schemer: boolean;
  definitions: boolean;
  player: boolean;
  metadata: boolean;
}

interface SectionSummary {
  complete: number;
  incomplete: number;
  missingFiles: number;
  missingFileNames: string[];
}

interface ValidationSummary {
  totalTestTakers: number;
  validTestTakerXmls: number;
  invalidTestTakerXmls: number;
  booklets: SectionSummary;
  units: SectionSummary;
  schemes: SectionSummary;
  schemer: SectionSummary;
  definitions: SectionSummary;
  player: SectionSummary;
  metadata: SectionSummary;
}

type ValidationSectionKey = keyof ExpandedFilesLists;

interface MissingRelationInfo {
  all: string[];
  preview: string[];
  remaining: number;
}

interface DerivedDataValidation extends DataValidation {
  existingCount: number;
  missingCount: number;
  filteredMissingCount: number;
  isCompleteForView: boolean;
  relatedEntitiesByMissingFile: Record<string, MissingRelationInfo>;
}

type FilesValidationView = Omit<FilesValidation, ValidationSectionKey> & {
  [K in ValidationSectionKey]: DerivedDataValidation;
};

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
    MatExpansionModule,
    MatProgressSpinnerModule
  ],
  styleUrls: ['./files-validation.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FilesValidationDialogComponent implements OnInit {
  dialogRef = inject<MatDialogRef<FilesValidationDialogComponent>>(MatDialogRef);
  private dialog = inject(MatDialog);
  private cdr = inject(ChangeDetectorRef);

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
  validationResults: FilesValidationView[] = [];

  selection = new SelectionModel<FilteredTestTaker>(true, []);
  duplicateSelection = new Map<string, string>(); // Maps login to selected testTaker file

  unusedFilesSelection = new SelectionModel<UnusedTestFile>(true, []);
  allUnusedFilesSelected = false;
  isDeletingUnusedFiles = false;

  modeGroups: { mode: string, count: number }[] = [];

  allSelected = false;
  isResolvingDuplicates = false;

  ignoredUnits = new Set<string>();
  ignoredBooklets = new Set<string>();
  ignoredTestlets: { bookletId: string; testletId: string }[] = [];

  bookletData: Map<string, BookletInfoDto> = new Map();
  expandedBooklets: Set<string> = new Set();
  loadingBooklets: Set<string> = new Set();
  selectedTabIndex = 0;

  private workspaceService = inject(WorkspaceService);
  private fileService = inject(FileService);
  private testResultService = inject(TestResultService);
  private snackBar = inject(MatSnackBar);

  isExcluding = false;
  excludingProgress = 0;

  isConsidering = false;
  consideringProgress = 0;

  summary: ValidationSummary = {
    totalTestTakers: 0,
    validTestTakerXmls: 0,
    invalidTestTakerXmls: 0,
    booklets: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    },
    units: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    },
    schemes: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    },
    schemer: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    },
    definitions: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    },
    player: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    },
    metadata: {
      complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
    }
  };

  expandedSummaryLists: Set<string> = new Set();
  private readonly relationPreviewLimit = 3;

  toggleSummaryList(section: string): void {
    if (this.expandedSummaryLists.has(section)) {
      this.expandedSummaryLists.delete(section);
    } else {
      this.expandedSummaryLists.add(section);
    }
  }

  isSummaryListExpanded(section: string): boolean {
    return this.expandedSummaryLists.has(section);
  }

  private calculateSummary(): void {
    if (!this.validationResults.length) {
      this.summary = {
        totalTestTakers: 0,
        validTestTakerXmls: 0,
        invalidTestTakerXmls: 0,
        booklets: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        },
        units: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        },
        schemes: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        },
        schemer: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        },
        definitions: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        },
        player: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        },
        metadata: {
          complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
        }
      };
      return;
    }

    const summaryData: ValidationSummary = {
      totalTestTakers: this.validationResults.length,
      validTestTakerXmls: 0,
      invalidTestTakerXmls: 0,
      booklets: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      },
      units: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      },
      schemes: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      },
      schemer: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      },
      definitions: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      },
      player: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      },
      metadata: {
        complete: 0, incomplete: 0, missingFiles: 0, missingFileNames: []
      }
    };

    const missingFilesSets = {
      booklets: new Set<string>(),
      units: new Set<string>(),
      schemes: new Set<string>(),
      schemer: new Set<string>(),
      definitions: new Set<string>(),
      player: new Set<string>(),
      metadata: new Set<string>()
    };

    this.validationResults.forEach(val => {
      if (val.testTakerSchemaValid === false) {
        summaryData.invalidTestTakerXmls += 1;
      } else {
        summaryData.validTestTakerXmls += 1;
      }

      const updateSectionStats = (section: keyof typeof missingFilesSets, data: DerivedDataValidation) => {
        if (data.isCompleteForView) {
          summaryData[section].complete += 1;
        } else {
          summaryData[section].incomplete += 1;
        }

        if (data.files) {
          data.files.forEach(f => {
            if (!f.exists) {
              if (section === 'units' && this.isUnitIgnored(f.filename)) {
                return;
              }
              missingFilesSets[section].add(f.filename);
            }
          });
        }
      };

      updateSectionStats('booklets', val.booklets);
      updateSectionStats('units', val.units);
      updateSectionStats('schemes', val.schemes);
      updateSectionStats('schemer', val.schemer);
      updateSectionStats('definitions', val.definitions);
      updateSectionStats('player', val.player);
      updateSectionStats('metadata', val.metadata);
    });

    // Sort missing files and assign to summary
    (Object.keys(missingFilesSets) as (keyof typeof missingFilesSets)[]).forEach(section => {
      summaryData[section].missingFileNames = Array.from(missingFilesSets[section]).sort();
      summaryData[section].missingFiles = summaryData[section].missingFileNames.length;
    });

    this.summary = summaryData;
  }

  private rebuildValidationResults(): void {
    const rawResults = this.data.validationResults || [];
    this.validationResults = rawResults.map(result => this.createValidationView(result));
    this.calculateSummary();
    this.cdr.markForCheck();
  }

  private resetExpandedFilesLists(results: FilesValidation[]): void {
    const previous = new Map(this.expandedFilesLists);
    this.expandedFilesLists.clear();
    results.forEach(val => {
      const prev = previous.get(val.testTaker);
      this.expandedFilesLists.set(val.testTaker, {
        booklets: prev?.booklets || false,
        units: prev?.units || false,
        schemes: prev?.schemes || false,
        schemer: prev?.schemer || false,
        definitions: prev?.definitions || false,
        player: prev?.player || false,
        metadata: prev?.metadata || false
      });
    });
  }

  private updateModeGroups(): void {
    const modeMap = new Map<string, number>();
    this.filteredTestTakers
      .filter(item => this.isKnownTestTaker(item))
      .forEach(item => {
        const count = modeMap.get(item.mode) || 0;
        modeMap.set(item.mode, count + 1);
      });
    this.modeGroups = Array.from(modeMap.entries()).map(([mode, count]) => ({ mode, count }));
  }

  private applyValidationResultData(resultDto: FileValidationResultDto): void {
    const filteredResults = (resultDto.validationResults || []).filter(v => !!v?.testTaker) as FilesValidation[];
    this.data.validationResults = filteredResults;
    this.filteredTestTakers = resultDto.filteredTestTakers || [];
    this.duplicateTestTakers = resultDto.duplicateTestTakers || [];
    this.unusedTestFiles = resultDto.unusedTestFiles || [];

    this.selection.clear();
    this.allSelected = false;
    this.unusedFilesSelection.clear();
    this.allUnusedFilesSelected = false;
    this.duplicateSelection.clear();

    this.duplicateTestTakers.forEach(duplicate => {
      if (duplicate.occurrences.length > 0) {
        this.duplicateSelection.set(duplicate.login, duplicate.occurrences[0].testTaker);
      }
    });

    this.resetExpandedFilesLists(filteredResults);
    this.updateModeGroups();
    this.rebuildValidationResults();
  }

  private refreshValidationData(successMessage?: string): void {
    if (!this.data.workspaceId) {
      return;
    }

    const refreshInProgressRef: MatSnackBarRef<TextOnlySnackBar> = this.snackBar.open(
      'Validierungsergebnisse werden aktualisiert...'
    );

    this.fileService.validateFiles(this.data.workspaceId).subscribe({
      next: response => {
        refreshInProgressRef.dismiss();
        if (typeof response === 'boolean') {
          this.snackBar.open('Validierungsergebnisse konnten nicht aktualisiert werden', 'OK', { duration: 3000 });
          return;
        }
        this.applyValidationResultData(response);
        if (successMessage) {
          this.snackBar.open(successMessage, 'OK', { duration: 2500 });
        }
      },
      error: () => {
        refreshInProgressRef.dismiss();
        this.snackBar.open('Fehler beim Aktualisieren der Validierungsergebnisse', 'OK', { duration: 3000 });
      }
    });
  }

  private createValidationView(result: FilesValidation): FilesValidationView {
    return {
      ...result,
      booklets: this.createDerivedValidation(result.booklets, 'booklets'),
      units: this.createDerivedValidation(result.units, 'units'),
      schemes: this.createDerivedValidation(result.schemes, 'schemes'),
      schemer: this.createDerivedValidation(result.schemer, 'schemer'),
      definitions: this.createDerivedValidation(result.definitions, 'definitions'),
      player: this.createDerivedValidation(result.player, 'player'),
      metadata: this.createDerivedValidation(result.metadata, 'metadata')
    };
  }

  private createDerivedValidation(
    data: DataValidation,
    sectionType: ValidationSectionKey
  ): DerivedDataValidation {
    const existingCount = data.files.filter(file => file.exists).length;
    const missingFiles = data.files.filter(file => !file.exists);
    const missingCount = missingFiles.length;
    const filteredMissingCount = sectionType === 'units' ?
      missingFiles.filter(file => !this.isUnitIgnored(file.filename)).length :
      missingCount;

    return {
      ...data,
      existingCount,
      missingCount,
      filteredMissingCount,
      isCompleteForView: this.computeSectionComplete(data, sectionType),
      relatedEntitiesByMissingFile: this.createRelatedEntitiesByMissingFile(data, sectionType, missingFiles)
    };
  }

  private createRelatedEntitiesByMissingFile(
    data: DataValidation,
    sectionType: ValidationSectionKey,
    missingFiles: FileStatus[]
  ): Record<string, MissingRelationInfo> {
    if (sectionType === 'booklets') {
      return {};
    }

    const relations: Record<string, MissingRelationInfo> = {};

    missingFiles.forEach(file => {
      const relatedEntities = sectionType === 'units' ?
        this.findBookletsForMissingUnit(data, file.filename) :
        this.findUnitsForMissingRef(data, file.filename);

      if (relatedEntities.length > 0) {
        relations[file.filename] = this.createMissingRelationInfo(relatedEntities);
      }
    });

    return relations;
  }

  private createMissingRelationInfo(values: string[]): MissingRelationInfo {
    const uniqueValues = Array.from(new Set(values));
    return {
      all: uniqueValues,
      preview: uniqueValues.slice(0, this.relationPreviewLimit),
      remaining: Math.max(0, uniqueValues.length - this.relationPreviewLimit)
    };
  }

  private computeSectionComplete(data: DataValidation, sectionType: ValidationSectionKey): boolean {
    if (data.complete || !data.missing || data.missing.length === 0) {
      return true;
    }

    if (sectionType === 'units') {
      return data.missing.every(unit => this.isUnitIgnored(unit));
    }

    return false;
  }

  private isKnownTestTaker(item: FilteredTestTaker): boolean {
    return item.consider === true || item.consider === false;
  }

  openAffectedUnitsDialog(title: string, units: string[], onSelect: (unitId: string) => void): void {
    if (!units || units.length === 0) {
      return;
    }

    const ref = this.dialog.open<
    AffectedUnitsDialogComponent,
    { title: string; units: string[] },
    AffectedUnitsDialogResult
    >(AffectedUnitsDialogComponent, {
      width: '600px',
      maxWidth: '95vw',
      data: {
        title,
        units
      }
    });

    ref.afterClosed().subscribe(result => {
      if (result?.unitId) {
        onSelect(result.unitId);
      }
    });
  }

  get knownFilteredTestTakers(): FilteredTestTaker[] {
    return this.filteredTestTakers.filter(item => this.isKnownTestTaker(item));
  }

  get knownFilteredCount(): number {
    return this.knownFilteredTestTakers.length;
  }

  get filteredTotalCount(): number {
    return this.filteredTestTakers.length;
  }

  get filteredExcludedCount(): number {
    return this.filteredTestTakers.filter(item => item.consider === false).length;
  }

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
            player: false,
            metadata: false
          });
        });
        this.rebuildValidationResults();
      }

      if (this.data.filteredTestTakers) {
        this.filteredTestTakers = this.data.filteredTestTakers;
        this.updateModeGroups();
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

  ngOnInit(): void {
    if (this.data.workspaceId) {
      this.loadWorkspaceSettings();
    }
  }

  loadWorkspaceSettings(): void {
    if (!this.data.workspaceId) return;
    this.workspaceService.getWorkspaceSettings(this.data.workspaceId).subscribe(settings => {
      this.ignoredUnits = new Set((settings.ignoredUnits || []).map(u => u.toUpperCase()));
      this.ignoredBooklets = new Set((settings.ignoredBooklets || []).map(b => b.toUpperCase()));
      this.ignoredTestlets = (settings.ignoredTestlets || []).map(t => ({ bookletId: t.bookletId.toUpperCase(), testletId: t.testletId.toUpperCase() }));
      this.rebuildValidationResults();
    });
  }

  isUnitIgnored(unit: string, parents?: string[]): boolean {
    if (!unit) return false;
    const normalizedUnit = unit.toUpperCase();

    // Direct unit ignore
    if (this.ignoredUnits.has(normalizedUnit)) return true;

    // Check parent exclusions if parents are provided
    if (parents && parents.length > 0) {
      return parents.some(bookletId => {
        const normalizedBooklet = bookletId.toUpperCase();
        if (this.ignoredBooklets.has(normalizedBooklet)) return true;

        // Check testlets if we have booklet data loaded
        const info = this.bookletData.get(normalizedBooklet);
        if (info && info.testlets) {
          return info.testlets.some((testlet: BookletTestletDto) => this.isTestletIgnored(normalizedBooklet, testlet.id) &&
            (testlet.units || []).some((u: BookletUnitDto) => u.id.toUpperCase() === normalizedUnit));
        }
        return false;
      });
    }

    return false;
  }

  isBookletIgnored(booklet: string): boolean {
    return !!booklet && this.ignoredBooklets.has(booklet.toUpperCase());
  }

  isTestletIgnored(bookletId: string, testletId: string): boolean {
    if (!bookletId || !testletId) return false;
    const normBooklet = bookletId.toUpperCase();
    const normTestlet = testletId.toUpperCase();
    return this.ignoredTestlets.some(t => t.bookletId === normBooklet && t.testletId === normTestlet);
  }

  hasIgnoredTestlets(bookletId: string): boolean {
    if (!bookletId) return false;
    const normBooklet = bookletId.toUpperCase();
    return this.ignoredTestlets.some(t => t.bookletId === normBooklet);
  }

  toggleBookletExpand(bookletId: string): void {
    if (!bookletId) return;
    const normalized = bookletId.toUpperCase();

    if (this.expandedBooklets.has(normalized)) {
      this.expandedBooklets.delete(normalized);
    } else {
      this.expandedBooklets.add(normalized);
      if (!this.bookletData.has(normalized) && !this.loadingBooklets.has(normalized)) {
        this.loadBookletData(normalized);
      }
    }
  }

  private loadBookletData(bookletId: string): void {
    if (!this.data.workspaceId || !bookletId) return;
    this.loadingBooklets.add(bookletId);
    this.fileService.getBookletInfo(this.data.workspaceId, bookletId).subscribe({
      next: info => {
        this.bookletData.set(bookletId, info);
        this.loadingBooklets.delete(bookletId);
        this.cdr.markForCheck();
      },
      error: () => {
        this.loadingBooklets.delete(bookletId);
        this.cdr.markForCheck();
      }
    });
  }

  private saveCurrentWorkspaceSettings(onSuccess: (message: string) => void, onRevert: () => void): void {
    if (!this.data.workspaceId) return;
    const settings = {
      ignoredUnits: Array.from(this.ignoredUnits),
      ignoredBooklets: Array.from(this.ignoredBooklets),
      ignoredTestlets: this.ignoredTestlets
    };
    this.workspaceService.saveWorkspaceSettings(this.data.workspaceId, settings).subscribe({
      next: success => {
        if (success) {
          if (this.data.workspaceId) {
            this.testResultService.invalidateCache(this.data.workspaceId);
          }
          onSuccess('Einstellungen gespeichert');
          this.refreshValidationData('Validierungsergebnisse wurden aktualisiert');
        } else {
          onRevert();
          this.snackBar.open('Fehler beim Speichern', 'OK', { duration: 3000 });
          this.cdr.markForCheck();
        }
      },
      error: () => {
        onRevert();
        this.snackBar.open('Fehler beim Speichern', 'OK', { duration: 3000 });
        this.cdr.markForCheck();
      }
    });
  }

  toggleUnitIgnore(unit: string): void {
    if (!unit || !this.data.workspaceId) return;
    const normalized = unit.toUpperCase();

    if (this.ignoredUnits.has(normalized)) {
      this.ignoredUnits.delete(normalized);
      this.saveCurrentWorkspaceSettings(() => this.snackBar.open('Aufgabe wiederhergestellt', 'OK', { duration: 3000 }), () => this.ignoredUnits.add(normalized));
    } else {
      this.ignoredUnits.add(normalized);
      this.saveCurrentWorkspaceSettings(() => this.snackBar.open('Aufgabe ignoriert', 'OK', { duration: 3000 }), () => this.ignoredUnits.delete(normalized));
    }
  }

  toggleBookletIgnore(booklet: string): void {
    if (!booklet || !this.data.workspaceId) return;
    const normalized = booklet.toUpperCase();

    if (this.ignoredBooklets.has(normalized)) {
      this.ignoredBooklets.delete(normalized);
      this.saveCurrentWorkspaceSettings(() => this.snackBar.open('Testheft wiederhergestellt', 'OK', { duration: 3000 }), () => this.ignoredBooklets.add(normalized));
    } else {
      this.ignoredBooklets.add(normalized);
      this.saveCurrentWorkspaceSettings(() => this.snackBar.open('Testheft ignoriert', 'OK', { duration: 3000 }), () => this.ignoredBooklets.delete(normalized));
    }
  }

  toggleTestletIgnore(bookletId: string, testletId: string): void {
    if (!bookletId || !testletId || !this.data.workspaceId) return;
    const normBooklet = bookletId.toUpperCase();
    const normTestlet = testletId.toUpperCase();

    const index = this.ignoredTestlets.findIndex(t => t.bookletId === normBooklet && t.testletId === normTestlet);

    if (index >= 0) {
      this.ignoredTestlets.splice(index, 1);
      this.saveCurrentWorkspaceSettings(
        () => this.snackBar.open('Testlet wiederhergestellt', 'OK', { duration: 3000 }),
        () => this.ignoredTestlets.push({ bookletId: normBooklet, testletId: normTestlet })
      );
    } else {
      this.ignoredTestlets.push({ bookletId: normBooklet, testletId: normTestlet });
      this.saveCurrentWorkspaceSettings(
        () => this.snackBar.open('Testlet ignoriert', 'OK', { duration: 3000 }),
        () => this.ignoredTestlets.splice(this.ignoredTestlets.findIndex(t => t.bookletId === normBooklet && t.testletId === normTestlet), 1)
      );
    }
  }

  filesDeleted = false;

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

    this.fileService.deleteFiles(this.data.workspaceId, idsToDelete)
      .subscribe({
        next: (success: boolean) => {
          this.isDeletingUnusedFiles = false;
          if (success) {
            this.filesDeleted = true;
            this.unusedTestFiles = this.unusedTestFiles.filter(f => !idsToDelete.includes(f.id));
            this.unusedFilesSelection.clear();
            this.checkIfAllUnusedFilesSelected();
            this.refreshValidationData('Validierungsergebnisse wurden aktualisiert');
            this.snackBar.open('Dateien erfolgreich gelöscht', 'OK', { duration: 3000 });
          } else {
            this.snackBar.open('Fehler beim Löschen der Dateien', 'Fehler', { duration: 3000 });
          }
        },
        error: () => {
          this.isDeletingUnusedFiles = false;
          this.snackBar.open('Fehler beim Löschen der Dateien', 'Fehler', { duration: 3000 });
        }
      });
  }

  close(): void {
    this.dialogRef.close(this.filesDeleted);
  }

  private findBookletsForMissingUnit(data: DataValidation, unit: string): string[] {
    if (!data.missingUnitsPerBooklet || data.missingUnitsPerBooklet.length === 0 || !unit) {
      return [];
    }
    const normalizedUnit = unit.toUpperCase().trim();
    return data.missingUnitsPerBooklet
      .filter(entry => (entry.missingUnits || []).map(u => u.toUpperCase().trim()).includes(normalizedUnit))
      .map(entry => entry.booklet);
  }

  private findUnitsForMissingRef(data: DataValidation, ref: string): string[] {
    if (!data.missingRefsPerUnit || data.missingRefsPerUnit.length === 0 || !ref) {
      return [];
    }

    const normalize = (value: string): { full: string; base: string; noExt: string } => {
      const full = (value || '').trim().toUpperCase().replace(/\\/g, '/');
      const base = full.includes('/') ? (full.split('/').pop() || full) : full;
      const dot = base.lastIndexOf('.');
      const noExt = dot > 0 ? base.substring(0, dot) : base;
      return { full, base, noExt };
    };

    const target = normalize(ref);

    const matches = (candidateRaw: string): boolean => {
      const candidate = normalize(candidateRaw);
      return (
        candidate.full === target.full ||
        candidate.base === target.base ||
        candidate.noExt === target.noExt
      );
    };

    return data.missingRefsPerUnit
      .filter(entry => (entry.missingRefs || []).some(r => matches(r || '')))
      .map(entry => entry.unit);
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
    if (!this.isKnownTestTaker(testTaker)) {
      return;
    }
    this.selection.toggle(testTaker);
    this.checkIfAllSelected();
  }

  toggleAllSelection(): void {
    if (this.allSelected) {
      this.selection.clear();
      this.allSelected = false;
    } else {
      const selectable = this.knownFilteredTestTakers;
      if (selectable.length > 1000) {
        // For very large datasets, use batch processing
        const batchSize = 500;
        const totalItems = selectable.length;

        const processBatch = (startIndex: number) => {
          const endIndex = Math.min(startIndex + batchSize, totalItems);

          for (let i = startIndex; i < endIndex; i++) {
            this.selection.select(selectable[i]);
          }

          if (endIndex < totalItems) {
            setTimeout(() => processBatch(endIndex), 0);
          }
        };

        processBatch(0);
      } else {
        // For smaller datasets, select all at once
        this.selection.select(...selectable);
      }

      this.allSelected = true;
    }
  }

  toggleModeSelection(mode: string): void {
    const testTakersWithMode = this.filteredTestTakers.filter(item => item.mode === mode && this.isKnownTestTaker(item));

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
    this.allSelected = this.knownFilteredCount > 0 &&
      this.selection.selected.length === this.knownFilteredCount;
  }

  isModeSelected(mode: string): boolean {
    return this.filteredTestTakers
      .filter(item => item.mode === mode && this.isKnownTestTaker(item))
      .every(item => this.selection.isSelected(item));
  }

  markTestTakersAsConsidered(): void {
    if (!this.data.workspaceId || this.selection.selected.length === 0 || this.isConsidering) {
      return;
    }

    this.isConsidering = true;
    this.consideringProgress = 0;

    if (this.selection.selected.length > 500) {
      const batchSize = 500;
      const selectedItems = [...this.selection.selected];
      const totalItems = selectedItems.length;

      const processBatch = (startIndex: number) => {
        const endIndex = Math.min(startIndex + batchSize, totalItems);
        const batchItems = selectedItems.slice(startIndex, endIndex);
        const batchLogins = batchItems.map(item => item.login);

        this.workspaceService.markTestTakersAsConsidered(this.data.workspaceId!, batchLogins)
          .subscribe({
            next: success => {
              if (success) {
                const loginSet = new Set(batchLogins);
                this.filteredTestTakers = this.filteredTestTakers.map(item => (loginSet.has(item.login) ? {
                  ...item,
                  consider: true
                } : item));

                this.testResultService.invalidateCache(this.data.workspaceId!);

                this.consideringProgress = Math.round((endIndex / totalItems) * 100);

                if (endIndex < totalItems) {
                  setTimeout(() => processBatch(endIndex), 100);
                } else {
                  this.selection.clear();
                  this.isConsidering = false;
                  this.consideringProgress = 0;
                }
              } else {
                this.isConsidering = false;
                this.consideringProgress = 0;
              }
            },
            error: () => {
              this.isConsidering = false;
              this.consideringProgress = 0;
            }
          });
      };

      processBatch(0);
    } else {
      const logins = this.selection.selected.map(item => item.login);
      this.consideringProgress = 50;

      this.workspaceService.markTestTakersAsConsidered(this.data.workspaceId!, logins)
        .subscribe({
          next: success => {
            if (success) {
              const loginSet = new Set(logins);
              this.filteredTestTakers = this.filteredTestTakers.map(item => (loginSet.has(item.login) ? {
                ...item,
                consider: true
              } : item));
              this.selection.clear();

              this.testResultService.invalidateCache(this.data.workspaceId!);
            }
            this.isConsidering = false;
            this.consideringProgress = 0;
          },
          error: () => {
            this.isConsidering = false;
            this.consideringProgress = 0;
          }
        });
    }
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
                const loginSet = new Set(batchLogins);
                this.filteredTestTakers = this.filteredTestTakers.map(item => (loginSet.has(item.login) ? {
                  ...item,
                  consider: false
                } : item));

                this.testResultService.invalidateCache(this.data.workspaceId!);

                // Update progress
                this.excludingProgress = Math.round((endIndex / totalItems) * 100);

                // If more batches remain, process the next batch
                if (endIndex < totalItems) {
                  // Update progress before processing next batch
                  setTimeout(() => processBatch(endIndex), 100);
                } else {
                  // All batches processed
                  this.selection.clear();
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
              const loginSet = new Set(logins);
              this.filteredTestTakers = this.filteredTestTakers.map(item => (loginSet.has(item.login) ? {
                ...item,
                consider: false
              } : item));
              this.selection.clear();

              this.testResultService.invalidateCache(this.data.workspaceId!);
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

    this.fileService.getBookletInfo(
      this.data.workspaceId,
      normalizedBookletId
    ).subscribe({
      next: (bookletInfo: unknown) => {
        loadingSnackBar.dismiss();

        this.dialog.open(BookletInfoDialogComponent, {
          width: '1200px',
          height: '80vh',
          data: {
            bookletInfo,
            bookletId: normalizedBookletId,
            isTestletIgnored: (testletId: string) => this.isTestletIgnored(normalizedBookletId, testletId),
            toggleTestletIgnore: (testletId: string) => this.toggleTestletIgnore(normalizedBookletId, testletId)
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

    this.fileService.getUnitInfo(
      this.data.workspaceId,
      unitId
    ).subscribe({
      next: (unitInfo: unknown) => {
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

    this.fileService.getCodingSchemeFile(
      this.data.workspaceId,
      schemeId
    ).subscribe({
      next: (fileDownload: { base64Data: string; filename: string } | null) => {
        loadingSnackBar.dismiss();

        if (!fileDownload) {
          this.snackBar.open(
            'Ressourcendatei nicht gefunden.',
            'Fehler',
            { duration: 3000 }
          );
          return;
        }

        const decodedContent = base64ToUtf8(fileDownload.base64Data);

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

    this.fileService.getTestTakerContentXml(this.data.workspaceId, testTakerId)
      .subscribe((xmlContent: string | null) => {
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

  async openMetadataFile(filename: string): Promise<void> {
    if (!this.data.workspaceId || !filename) {
      return;
    }

    const loadingSnackBar = this.snackBar.open('Lade Metadaten...', '', { duration: 3000 });

    try {
      // 1. Find file ID
      const filesList = await firstValueFrom(
        this.fileService.getFilesList(
          this.data.workspaceId,
          1,
          20,
          'Resource',
          undefined,
          filename
        )
      );

      // eslint-disable-next-line no-console
      console.log('Metadata file search:', {
        searchedFor: filename,
        found: filesList.data.length,
        results: filesList.data.map(f => f.filename)
      });

      let fileEntry = filesList.data.find(f => f.filename === filename);

      if (!fileEntry && filesList.data.length > 0) {
        fileEntry = filesList.data.find(f => f.filename.toLowerCase() === filename.toLowerCase());
      }

      if (!fileEntry) {
        // Fallback: if we have exactly one result and it contains the filename (e.g. funny path issues), log it
        if (filesList.data.length === 1) {
          // eslint-disable-next-line no-console
          console.warn('Exact match failed, but found 1 file:', filesList.data[0].filename);
        }

        loadingSnackBar.dismiss();
        this.snackBar.open(`Datei "${filename}" nicht gefunden.`, 'Fehler', { duration: 3000 });
        return;
      }

      // 2. Download file content
      const fileDownload = await firstValueFrom(
        this.fileService.downloadFile(this.data.workspaceId, fileEntry.id)
      );

      if (!fileDownload) {
        loadingSnackBar.dismiss();
        this.snackBar.open('Fehler beim Laden der Datei.', 'Fehler', { duration: 3000 });
        return;
      }

      // 3. Parse content
      const decodedContent = base64ToUtf8(fileDownload.base64Data);

      const vomdData = JSON.parse(decodedContent);

      // 4. Resolve profiles
      const unitProfile = vomdData.profiles?.[0];
      if (!unitProfile) {
        loadingSnackBar.dismiss();
        this.snackBar.open('Keine Metadaten-Profile in der Datei gefunden', 'Schließen', { duration: 5000 });
        return;
      }

      const resolver = new MetadataResolver();
      const unitProfileUrl = unitProfile.profileId;
      const unitProfileWithVocabs = await resolver.loadProfileWithVocabularies(unitProfileUrl);

      let itemProfileData = null;
      const firstItem = vomdData.items?.[0];
      const itemProfile = firstItem?.profiles?.[0];

      if (itemProfile) {
        const itemProfileUrl = itemProfile.profileId;
        const itemProfileWithVocabs = await resolver.loadProfileWithVocabularies(itemProfileUrl);
        itemProfileData = itemProfileWithVocabs.profile;
      }

      loadingSnackBar.dismiss();

      // 5. Open dialog
      this.dialog.open(MetadataDialogComponent, {
        width: '1200px',
        maxWidth: '95vw',
        maxHeight: '95vh',
        data: {
          title: filename,
          profileData: unitProfileWithVocabs.profile,
          itemProfileData: itemProfileData,
          metadataValues: vomdData,
          resolver: resolver,
          language: 'de',
          mode: 'readonly'
        }
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error opening metadata file:', error);
      loadingSnackBar.dismiss();
      this.snackBar.open('Fehler beim Öffnen der Metadaten-Datei.', 'Fehler', { duration: 3000 });
    }
  }
}
