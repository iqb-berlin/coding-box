import {
  AfterViewInit, Component, OnInit, signal, computed, WritableSignal, viewChild, effect, ChangeDetectionStrategy, DestroyRef, inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateModule } from '@ngx-translate/core';
import { finalize, forkJoin } from 'rxjs';
import { activateOnKeyboard } from '../../shared/utils/keyboard-activation.util';
import { FileService } from '../../shared/services/file/file.service';
import {
  FileBackendService,
  ReplayAnchorOverride
} from '../../shared/services/file/file-backend.service';
import { UnitInfoDialogComponent } from '../../ws-admin/components/unit-info-dialog/unit-info-dialog.component';
import { SchemeEditorDialogComponent } from '../../coding/components/scheme-editor-dialog/scheme-editor-dialog.component';
import { UnitInfoDto } from '../../../../../../api-dto/unit-info/unit-info.dto';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';
import { base64ToUtf8 } from '../../shared/utils/common-utils';

export interface CodingVariablesDialogData {
  workspaceId: number;
}

export interface CodeInfo {
  id: string | number;
  label: string;
  score?: number;
}

export interface FlattenedVariable {
  unitName: string;
  unitId: string;
  variableId: string;
  variableAlias: string;
  variableType: string;
  hasCodingScheme: boolean;
  codingSchemeRef?: string;
  codes?: CodeInfo[];
  isDerived?: boolean;
  hasManualInstruction?: boolean;
  hasClosedCoding?: boolean;
  coderTrainingRequired?: boolean;
  readonly replayAnchor: WritableSignal<string>;
  readonly savedReplayAnchor: WritableSignal<string>;
  readonly isSavingReplayAnchor: WritableSignal<boolean>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'coding-box-coding-variables-dialog',
  templateUrl: './coding-variables-dialog.component.html',
  styleUrls: ['./coding-variables-dialog.component.scss'],
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatSortModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    MatChipsModule,
    MatCheckboxModule,
    MatSelectModule,
    TranslateModule
  ]
})
export class CodingVariablesDialogComponent implements OnInit, AfterViewInit {
  dialogRef = inject<MatDialogRef<CodingVariablesDialogComponent>>(MatDialogRef);
  data = inject<CodingVariablesDialogData>(MAT_DIALOG_DATA);
  private fileService = inject(FileService);
  private fileBackendService = inject(FileBackendService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  protected readonly onActionKeydown = activateOnKeyboard;

  private readonly destroyRef = inject(DestroyRef);

  dataSource = new MatTableDataSource<FlattenedVariable>([]);
  protected displayedColumns: string[] = ['unitName', 'variableId', 'variableType', 'replayAnchor', 'actions'];

  protected readonly unitNameFilter = signal('');
  readonly variableIdFilter = signal('');
  readonly hasCodingSchemeFilter = signal(false);
  readonly hasCodesFilter = signal(false);
  readonly isDerivedFilter = signal(false);
  protected readonly isManualOnlyFilter = signal(false);
  protected readonly isClosedCodingFilter = signal(false);
  readonly trainingRequiredFilter = signal<'all' | 'required' | 'not-required'>('all');
  readonly selectedTypes = signal<string[]>([]);
  protected availableTypes = ['string', 'integer', 'number', 'boolean', 'attachment', 'json'];
  protected readonly isLoading = signal(false);

  readonly sort = viewChild(MatSort);
  private readonly synchronizeSort = effect(() => {
    this.dataSource.sort = this.sort() ?? null;
  });

  ngOnInit(): void {
    this.setupFilter();
    this.loadData();
  }

  ngAfterViewInit(): void {
    this.dataSource.sort = this.sort() ?? null;
  }

  get hasVariables(): boolean {
    return this.dataSource.data.length > 0;
  }

  get hasFilteredVariables(): boolean {
    return this.dataSource.filteredData.length > 0;
  }

  protected readonly hasActiveFilters = computed<boolean>(() => !!(
    this.unitNameFilter().trim() ||
      this.variableIdFilter().trim() ||
      this.hasCodingSchemeFilter() ||
      this.hasCodesFilter() ||
      this.isDerivedFilter() ||
      this.isManualOnlyFilter() ||
      this.isClosedCodingFilter() ||
      this.trainingRequiredFilter() !== 'all' ||
      this.selectedTypes().length
  ));

  private setupFilter(): void {
    this.dataSource.filterPredicate = (data: FlattenedVariable, filter: string): boolean => {
      try {
        const {
          unitName,
          variableId,
          hasCodingScheme,
          hasCodes,
          isDerived,
          isManualOnly,
          isClosedCoding,
          trainingRequired,
          types
        } = JSON.parse(filter || '{}');

        const matchesUnitName = !unitName ||
          this.includesFilter(data.unitName, unitName);
        const matchesVariableId = !variableId ||
          this.includesFilter(data.variableId, variableId) ||
          this.includesFilter(data.variableAlias, variableId);
        const matchesCodingScheme = !hasCodingScheme || data.hasCodingScheme;
        const matchesCodes = !hasCodes || (!!data.codes && data.codes.length > 0);
        const matchesDerived = !isDerived || data.isDerived === true;
        const matchesManualOnly = !isManualOnly || data.hasManualInstruction === true;
        const matchesClosedCoding = !isClosedCoding || data.hasClosedCoding === true;
        const matchesTrainingRequired = this.matchesTrainingRequiredFilter(
          data,
          trainingRequired
        );
        const matchesType = !types || types.length === 0 || types.includes(data.variableType);

        return matchesUnitName &&
          matchesVariableId &&
          matchesCodingScheme &&
          matchesCodes &&
          matchesDerived &&
          matchesManualOnly &&
          matchesClosedCoding &&
          matchesTrainingRequired &&
          matchesType;
      } catch {
        return true;
      }
    };
  }

  private matchesTrainingRequiredFilter(
    variable: FlattenedVariable,
    filter: 'all' | 'required' | 'not-required'
  ): boolean {
    if (filter === 'required') {
      return variable.coderTrainingRequired === true;
    }

    if (filter === 'not-required') {
      return variable.coderTrainingRequired !== true;
    }

    return true;
  }

  private includesFilter(value: string | undefined, filter: string): boolean {
    return (value || '').toLowerCase().includes(filter.toLowerCase());
  }

  private loadData(): void {
    this.isLoading.set(true);

    forkJoin({
      unitVariableDetails: this.fileBackendService.getUnitVariables(this.data.workspaceId),
      replayAnchorOverrides: this.fileBackendService.getReplayAnchorOverrides(this.data.workspaceId)
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ unitVariableDetails, replayAnchorOverrides }) => {
        const replayAnchorByVariable = this.toReplayAnchorMap(replayAnchorOverrides);
        const flattenedData: FlattenedVariable[] = [];

        unitVariableDetails.forEach(unit => {
          unit.variables.forEach((variable: {
            id: string;
            alias: string;
            type: string;
            hasCodingScheme: boolean;
            codingSchemeRef?: string;
            codes?: CodeInfo[];
            isDerived?: boolean;
            hasManualInstruction?: boolean;
            hasClosedCoding?: boolean;
            coderTrainingRequired?: boolean;
          }) => {
            const publicVariableId = variable.alias || variable.id;
            const savedReplayAnchor = replayAnchorByVariable.get(
              this.getVariableKey(unit.unitName, publicVariableId)
            ) || '';
            flattenedData.push({
              unitName: unit.unitName,
              unitId: unit.unitId,
              variableId: publicVariableId,
              variableAlias: publicVariableId,
              variableType: variable.type,
              hasCodingScheme: variable.hasCodingScheme,
              codingSchemeRef: variable.codingSchemeRef,
              codes: variable.codes,
              isDerived: variable.isDerived,
              hasManualInstruction: variable.hasManualInstruction,
              hasClosedCoding: variable.hasClosedCoding,
              coderTrainingRequired: variable.coderTrainingRequired,
              replayAnchor: signal(savedReplayAnchor),
              savedReplayAnchor: signal(savedReplayAnchor),
              isSavingReplayAnchor: signal(false)
            });
          });
        });

        this.dataSource.data = flattenedData;
        const sort = this.sort();
        if (sort) {
          this.dataSource.sort = sort;
        }
        this.applyFilter();
        this.isLoading.set(false);
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der Kodiervariablen', 'Schließen', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
        this.isLoading.set(false);
      }
    });
  }

  protected saveReplayAnchor(variable: FlattenedVariable): void {
    const replayAnchor = variable.replayAnchor().trim();
    if (!replayAnchor) {
      this.clearReplayAnchor(variable);
      return;
    }

    variable.isSavingReplayAnchor.set(true);
    this.fileBackendService.saveReplayAnchorOverride(this.data.workspaceId, {
      unitName: variable.unitName,
      variableId: variable.variableId,
      replayAnchor
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: saved => {
        variable.replayAnchor.set(saved.replayAnchor);
        variable.savedReplayAnchor.set(saved.replayAnchor);
        variable.isSavingReplayAnchor.set(false);
        this.snackBar.open('Replay-Anchor gespeichert', 'Schließen', {
          duration: 2500
        });
      },
      error: () => {
        variable.isSavingReplayAnchor.set(false);
        this.snackBar.open('Replay-Anchor konnte nicht gespeichert werden', 'Schließen', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  protected clearReplayAnchor(variable: FlattenedVariable): void {
    variable.isSavingReplayAnchor.set(true);
    this.fileBackendService.deleteReplayAnchorOverride(
      this.data.workspaceId,
      variable.unitName,
      variable.variableId
    ).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        variable.replayAnchor.set('');
        variable.savedReplayAnchor.set('');
        variable.isSavingReplayAnchor.set(false);
        this.snackBar.open('Replay-Anchor zurückgesetzt', 'Schließen', {
          duration: 2500
        });
      },
      error: () => {
        variable.isSavingReplayAnchor.set(false);
        this.snackBar.open('Replay-Anchor konnte nicht zurückgesetzt werden', 'Schließen', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
      }
    });
  }

  protected hasReplayAnchorChanges(variable: FlattenedVariable): boolean {
    return variable.replayAnchor().trim() !== variable.savedReplayAnchor();
  }

  private toReplayAnchorMap(
    overrides: ReplayAnchorOverride[]
  ): Map<string, string> {
    return new Map(
      overrides.map(override => [
        this.getVariableKey(override.unitName, override.variableId),
        override.replayAnchor
      ])
    );
  }

  private getVariableKey(unitName: string, variableId: string): string {
    return `${unitName}\u001F${variableId}`;
  }

  applyFilter(): void {
    const filterValue = JSON.stringify({
      unitName: this.unitNameFilter().trim(),
      variableId: this.variableIdFilter().trim(),
      hasCodingScheme: this.hasCodingSchemeFilter(),
      hasCodes: this.hasCodesFilter(),
      isDerived: this.isDerivedFilter(),
      isManualOnly: this.isManualOnlyFilter(),
      isClosedCoding: this.isClosedCodingFilter(),
      trainingRequired: this.trainingRequiredFilter(),
      types: this.selectedTypes()
    });
    this.dataSource.filter = filterValue;
  }

  clearFilters(): void {
    this.unitNameFilter.set('');
    this.variableIdFilter.set('');
    this.hasCodingSchemeFilter.set(false);
    this.hasCodesFilter.set(false);
    this.isDerivedFilter.set(false);
    this.isManualOnlyFilter.set(false);
    this.isClosedCodingFilter.set(false);
    this.trainingRequiredFilter.set('all');
    this.selectedTypes.set([]);
    this.applyFilter();
  }

  getTypeColor(type: string): string {
    switch (type) {
      case 'string':
        return 'primary'; // blue
      case 'integer':
        return 'accent'; // green
      case 'number':
        return 'warn'; // orange
      case 'boolean':
        return ''; // purple (custom)
      default:
        return '';
    }
  }

  protected getTypeClass(type: string): string {
    switch (type) {
      case 'boolean':
        return 'type-boolean';
      case 'attachment':
        return 'type-attachment';
      case 'json':
        return 'type-json';
      default:
        return '';
    }
  }

  openUnitInfo(unitId: string): void {
    const loadingSnackBar = this.snackBar.open(
      'Aufgaben-Informationen werden geladen...',
      '',
      { duration: 0 }
    );

    this.fileService.getUnitInfo(this.data.workspaceId, unitId).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss())
    ).subscribe({
      next: (unitInfo: UnitInfoDto) => {
        this.dialog.open(UnitInfoDialogComponent, {
          width: '1200px',
          height: '80vh',
          data: { unitInfo, unitId }
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden der Aufgaben-Informationen',
          'Schließen',
          { duration: 3000 }
        );
      }
    });
  }

  openCodingScheme(codingSchemeRef: string): void {
    const loadingSnackBar = this.snackBar.open(
      'Kodierungsschema wird geladen...',
      '',
      { duration: 0 }
    );

    this.fileService.getCodingSchemeFile(this.data.workspaceId, codingSchemeRef).pipe(
      takeUntilDestroyed(this.destroyRef), finalize(() => loadingSnackBar.dismiss())
    ).subscribe({
      next: (schemeFile: FileDownloadDto | null) => {
        if (!schemeFile) {
          this.snackBar.open(
            'Kodierungsschema-Datei nicht gefunden',
            'Schließen',
            { duration: 3000 }
          );
          return;
        }

        const schemeContent = base64ToUtf8(schemeFile.base64Data);

        this.dialog.open(SchemeEditorDialogComponent, {
          width: '95vw',
          height: '95vh',
          maxWidth: '1400px',
          data: {
            workspaceId: this.data.workspaceId,
            fileId: codingSchemeRef,
            fileName: schemeFile.filename,
            content: schemeContent
          },
          panelClass: 'scheme-editor-dialog-container'
        });
      },
      error: () => {
        loadingSnackBar.dismiss();
        this.snackBar.open(
          'Fehler beim Laden des Kodierungsschemas',
          'Schließen',
          { duration: 3000 }
        );
      }
    });
  }

  protected close(): void {
    this.dialogRef.close();
  }
}
