import {
  Component,
  Inject,
  OnInit,
  ViewChild
} from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { UnitVariableDetailsDto } from '../../models/unit-variable-details.dto';
import { BackendService } from '../../services/backend.service';
import { AppService } from '../../services/app.service';
import { UnitInfoDialogComponent } from '../../ws-admin/components/unit-info-dialog/unit-info-dialog.component';
import { SchemeEditorDialogComponent } from '../../coding/components/scheme-editor-dialog/scheme-editor-dialog.component';
import { UnitInfoDto } from '../../../../../../api-dto/unit-info/unit-info.dto';
import { FileDownloadDto } from '../../../../../../api-dto/files/file-download.dto';

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
}

@Component({
  selector: 'coding-box-coding-variables-dialog',
  templateUrl: './coding-variables-dialog.component.html',
  styleUrls: ['./coding-variables-dialog.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
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
    MatSelectModule
  ]
})
export class CodingVariablesDialogComponent implements OnInit {
  dataSource = new MatTableDataSource<FlattenedVariable>([]);
  displayedColumns: string[] = ['unitName', 'variableAlias', 'variableType', 'actions'];

  unitNameFilter = '';
  variableIdFilter = '';
  hasCodingSchemeFilter = true;
  hasCodesFilter = true;
  isDerivedFilter = false;
  isManualOnlyFilter = false;
  isClosedCodingFilter = false;
  selectedTypes: string[] = [];
  availableTypes = ['string', 'integer', 'number', 'boolean', 'attachment', 'json'];
  isLoading = false;

  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    public dialogRef: MatDialogRef<CodingVariablesDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CodingVariablesDialogData,
    private backendService: BackendService,
    private appService: AppService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadData();
    this.setupFilter();
  }

  private setupFilter(): void {
    this.dataSource.filterPredicate = (data: FlattenedVariable, filter: string): boolean => {
      try {
        const {
          unitName, variableId, hasCodingScheme, hasCodes, isDerived, isManualOnly, isClosedCoding, types
        } = JSON.parse(filter || '{}');

        const matchesUnitName = !unitName ||
          data.unitName.toLowerCase().includes(unitName.toLowerCase());
        const matchesVariableId = !variableId ||
          data.variableAlias.toLowerCase().includes(variableId.toLowerCase());
        const matchesCodingScheme = !hasCodingScheme || data.hasCodingScheme;
        const matchesCodes = !hasCodes || (!!data.codes && data.codes.length > 0);
        const matchesDerived = !isDerived || data.isDerived === true;
        const matchesManualOnly = !isManualOnly || data.hasManualInstruction === true;
        const matchesClosedCoding = !isClosedCoding || data.hasClosedCoding === true;
        const matchesType = !types || types.length === 0 || types.includes(data.variableType);

        return matchesUnitName && matchesVariableId && matchesCodingScheme && matchesCodes && matchesDerived && matchesManualOnly && matchesClosedCoding && matchesType;
      } catch {
        return true;
      }
    };
  }

  private loadData(): void {
    this.isLoading = true;

    this.backendService.getUnitVariables(this.data.workspaceId).subscribe({
      next: (unitVariableDetails: UnitVariableDetailsDto[]) => {
        const flattenedData: FlattenedVariable[] = [];

        unitVariableDetails.forEach(unit => {
          unit.variables.forEach((variable: { id: string; alias: string; type: string; hasCodingScheme: boolean; codingSchemeRef?: string; codes?: CodeInfo[]; isDerived?: boolean; hasManualInstruction?: boolean; hasClosedCoding?: boolean }) => {
            flattenedData.push({
              unitName: unit.unitName,
              unitId: unit.unitId,
              variableId: variable.id,
              variableAlias: variable.alias,
              variableType: variable.type,
              hasCodingScheme: variable.hasCodingScheme,
              codingSchemeRef: variable.codingSchemeRef,
              codes: variable.codes,
              isDerived: variable.isDerived,
              hasManualInstruction: variable.hasManualInstruction,
              hasClosedCoding: variable.hasClosedCoding
            });
          });
        });

        this.dataSource.data = flattenedData;
        this.dataSource.sort = this.sort;
        this.applyFilter();
        this.isLoading = false;
      },
      error: () => {
        this.snackBar.open('Fehler beim Laden der Kodiervariablen', 'Schließen', {
          duration: 5000,
          panelClass: ['error-snackbar']
        });
        this.isLoading = false;
      }
    });
  }

  applyFilter(): void {
    const filterValue = JSON.stringify({
      unitName: this.unitNameFilter,
      variableId: this.variableIdFilter,
      hasCodingScheme: this.hasCodingSchemeFilter,
      hasCodes: this.hasCodesFilter,
      isDerived: this.isDerivedFilter,
      isManualOnly: this.isManualOnlyFilter,
      isClosedCoding: this.isClosedCodingFilter,
      types: this.selectedTypes
    });
    this.dataSource.filter = filterValue;
  }

  clearFilters(): void {
    this.unitNameFilter = '';
    this.variableIdFilter = '';
    this.hasCodingSchemeFilter = false;
    this.hasCodesFilter = false;
    this.isDerivedFilter = false;
    this.isManualOnlyFilter = false;
    this.isClosedCodingFilter = false;
    this.selectedTypes = [];
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

  getTypeClass(type: string): string {
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

    this.backendService.getUnitInfo(this.data.workspaceId, unitId).subscribe({
      next: (unitInfo: UnitInfoDto) => {
        loadingSnackBar.dismiss();

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

    this.backendService.getCodingSchemeFile(this.data.workspaceId, codingSchemeRef).subscribe({
      next: (schemeFile: FileDownloadDto | null) => {
        loadingSnackBar.dismiss();

        if (!schemeFile) {
          this.snackBar.open(
            'Kodierungsschema-Datei nicht gefunden',
            'Schließen',
            { duration: 3000 }
          );
          return;
        }

        let schemeContent: string;
        try {
          schemeContent = atob(schemeFile.base64Data);
        } catch (error) {
          schemeContent = schemeFile.base64Data;
        }

        this.dialog.open(SchemeEditorDialogComponent, {
          width: '100vw',
          height: '90vh',
          data: {
            workspaceId: this.data.workspaceId,
            fileId: codingSchemeRef,
            fileName: schemeFile.filename,
            content: schemeContent
          }
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

  close(): void {
    this.dialogRef.close();
  }
}
