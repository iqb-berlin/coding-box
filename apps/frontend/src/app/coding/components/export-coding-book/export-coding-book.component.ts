import {
  Component, OnInit
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatOptionModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslateModule } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { CodeBookContentSetting } from '../../../../../../../api-dto/coding/codebook-content-setting';
import { BackendService } from '../../../services/backend.service';
import { AppService } from '../../../services/app.service';

@Component({
  selector: 'shared-export-coding-book',
  templateUrl: './export-coding-book.component.html',
  styleUrls: ['./export-coding-book.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatCheckboxModule,
    MatRadioModule,
    MatSelectModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatOptionModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    MatTableModule,
    MatProgressSpinnerModule,
    TranslateModule
  ],
  providers: [
    DatePipe
  ]
})
export class ExportCodingBookComponent implements OnInit {
  unitList: number[] = [];
  availableUnits: {
    unitId: number;
    unitName: string;
    unitAlias: string | null;
  }[] = [];

  dataSource = new MatTableDataSource<{
    unitId: number;
    unitName: string;
    unitAlias: string | null;
  }>([]);

  filterValue = '';
  filterTextChanged = new Subject<Event>();
  isLoading = false;

  selectedMissingsProfile: number = 0;
  missingsProfiles: { id: number, label: string }[] = [{ id: 0, label: '' }];
  workspaceChanges = false;

  displayedColumns: string[] = ['select', 'unitName'];

  contentOptions: CodeBookContentSetting = {
    exportFormat: 'docx',
    missingsProfile: '',
    hasOnlyManualCoding: true,
    hasGeneralInstructions: true,
    hasDerivedVars: true,
    hasOnlyVarsWithCodes: true,
    hasClosedVars: true,
    codeLabelToUpper: true,
    showScore: true,
    hideItemVarRelation: true
  };

  constructor(
    private backendService: BackendService,
    private appService: AppService,
    private datePipe: DatePipe
  ) {}

  ngOnInit(): void {
    this.workspaceChanges = this.checkWorkspaceChanges();
    this.loadMissingsProfiles();
    this.loadUnitsWithFileIds();

    this.filterTextChanged
      .pipe(
        debounceTime(300),
        distinctUntilChanged()
      )
      .subscribe(event => {
        this.applyFilter(event);
      });
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    // Apply the filter to the data source (will use the filterPredicate defined in loadUnitsWithFileIds)
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  private loadUnitsWithFileIds(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      // Show loading indicator while fetching data
      this.isLoading = true;

      this.backendService.getUnitsWithFileIds(workspaceId).subscribe({
        next: units => {
          if (units && units.length > 0) {
            this.availableUnits = units.map(unit => ({
              unitId: unit.id,
              unitName: unit.fileName,
              unitAlias: null
            }));

            // Initialize the data source with all units
            // MatTableDataSource will handle filtering internally
            this.dataSource.data = this.availableUnits;

            // Set up custom filter predicate to filter by formatted unit name
            // This allows users to search for units without the .vocs extension
            this.dataSource.filterPredicate = (data, filter: string) => {
              const formattedName = this.formatUnitName(data.unitName).toLowerCase();
              return formattedName.includes(filter);
            };

            this.unitList = [];
          }
          this.isLoading = false;
        },
        error: () => {
          // Error occurred while loading units with file IDs
          this.isLoading = false;
        }
      });
    }
  }

  toggleUnitSelection(unitId: number, isSelected: boolean): void {
    if (isSelected) {
      if (!this.unitList.includes(unitId)) {
        this.unitList.push(unitId);
      }
    } else {
      this.unitList = this.unitList.filter(id => id !== unitId);
    }
  }

  isUnitSelected(unitId: number): boolean {
    return this.unitList.includes(unitId);
  }

  formatUnitName(unitName: string): string {
    if (unitName && unitName.toLowerCase().endsWith('.vocs')) {
      return unitName.substring(0, unitName.length - 5);
    }
    return unitName;
  }

  toggleAllUnits(isSelected: boolean): void {
    if (isSelected) {
      this.unitList = this.availableUnits.map(unit => unit.unitId);
    } else {
      this.unitList = [];
    }
  }

  private checkWorkspaceChanges(): boolean {
    return false;
  }

  private loadMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.backendService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles = [{ id: 0, label: '' }, ...profiles.map(profile => ({ id: profile.id ?? 0, label: profile.label }))];
          this.selectedMissingsProfile = 0;
          this.contentOptions.missingsProfile = this.selectedMissingsProfile.toString();
        },
        error: () => {
          // Error occurred while loading missings profiles
        }
      });
    }
  }

  exportCodingBook(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }
    if (this.unitList.length === 0) {
      return;
    }

    this.contentOptions.missingsProfile = this.selectedMissingsProfile.toString();
    this.appService.dataLoading = true;
    this.backendService.getCodingBook(
      workspaceId,
      this.contentOptions.missingsProfile,
      this.contentOptions,
      this.unitList
    ).subscribe({
      next: blob => {
        if (blob) {
          // Create a download link for the blob
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          const timestamp = this.datePipe.transform(new Date(), 'yyyyMMdd_HHmmss');
          const fileExtension = this.contentOptions.exportFormat.toLowerCase();
          a.href = url;
          a.download = `codebook_${timestamp}.${fileExtension}`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
        }
        this.appService.dataLoading = false;
      },
      error: () => {
        this.appService.dataLoading = false;
      }
    });
  }
}
