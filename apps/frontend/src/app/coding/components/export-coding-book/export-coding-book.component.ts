import {
  Component, OnInit, OnDestroy
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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
  Subject, Subscription, interval
} from 'rxjs';
import {
  debounceTime, distinctUntilChanged, switchMap, takeUntil
} from 'rxjs/operators';
import { CodeBookContentSetting } from '../../../../../../../api-dto/coding/codebook-content-setting';
import { CodingExportService } from '../../services/coding-export.service';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationStateService, ValidationProgress } from '../../services/validation-state.service';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';

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
    MatProgressBarModule,
    TranslateModule
  ],
  providers: [
    DatePipe
  ]
})
export class ExportCodingBookComponent implements OnInit, OnDestroy {
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

  private destroy$ = new Subject<void>();
  validationResults: ValidateCodingCompletenessResponseDto | null = null;
  validationProgress: ValidationProgress | null = null;
  isValidating = false;
  validationCacheKey: string | null = null;

  codebookJobId: string | null = null;
  codebookJobStatus: 'idle' | 'pending' | 'processing' | 'completed' | 'failed' = 'idle';
  codebookJobProgress = 0;
  codebookJobError: string | null = null;
  private codebookPollingSubscription: Subscription | null = null;

  constructor(
    private exportService: CodingExportService,
    private missingsProfileService: MissingsProfileService,
    private fileService: FileService,
    private appService: AppService,
    private datePipe: DatePipe,
    private validationStateService: ValidationStateService
  ) { }

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

    this.validationStateService.validationProgress$
      .pipe(takeUntil(this.destroy$))
      .subscribe(progress => this.handleValidationProgress(progress));

    this.handleValidationProgress(this.validationStateService.getValidationProgress());

    this.validationStateService.validationResults$
      .pipe(takeUntil(this.destroy$))
      .subscribe(results => this.handleValidationResults(results));

    this.handleValidationResults(this.validationStateService.getValidationResults());
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.stopCodebookPolling();
  }

  applyFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  private loadUnitsWithFileIds(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.isLoading = true;

      this.fileService.getUnitsWithFileIds(workspaceId).subscribe({
        next: units => {
          if (units && units.length > 0) {
            this.availableUnits = units.map((unit: { id: number; unitId: string; fileName: string; data: string }) => ({
              unitId: unit.id,
              unitName: unit.fileName,
              unitAlias: null
            }));
            this.dataSource.data = this.availableUnits;
            this.dataSource.filterPredicate = (data, filter: string) => {
              const formattedName = this.formatUnitName(data.unitName).toLowerCase();
              return formattedName.includes(filter);
            };

            this.unitList = [];
          }
          this.isLoading = false;
        },
        error: () => {
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

  private handleValidationResults(results: ValidateCodingCompletenessResponseDto | null): void {
    this.validationResults = results;
    if (results) {
      this.validationCacheKey = results.cacheKey || null;
    }
  }

  private handleValidationProgress(progress: ValidationProgress): void {
    this.validationProgress = progress;
    this.isValidating = progress.status === 'loading' || progress.status === 'processing';
  }

  private loadMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.missingsProfileService.getMissingsProfiles(workspaceId).subscribe({
        next: profiles => {
          this.missingsProfiles = [{ id: 0, label: '' }, ...profiles.map((profile: { label: string; id: number }) => ({ id: profile.id ?? 0, label: profile.label }))];
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
    this.codebookJobStatus = 'pending';
    this.codebookJobProgress = 0;
    this.codebookJobError = null;
    this.codebookJobId = null;

    this.exportService.startCodebookJob(
      workspaceId,
      this.contentOptions.missingsProfile,
      this.contentOptions,
      this.unitList
    ).subscribe({
      next: response => {
        this.codebookJobId = response.jobId;
        this.startCodebookPolling(workspaceId, response.jobId);
      },
      error: () => {
        this.codebookJobStatus = 'failed';
        this.codebookJobError = 'Failed to start codebook generation job';
      }
    });
  }

  private startCodebookPolling(workspaceId: number, jobId: string): void {
    this.stopCodebookPolling();

    this.codebookPollingSubscription = interval(1500)
      .pipe(
        takeUntil(this.destroy$),
        switchMap(() => this.exportService.getCodebookJobStatus(workspaceId, jobId))
      )
      .subscribe({
        next: status => {
          if (!status.status && status.error) {
            this.codebookJobStatus = 'failed';
            this.codebookJobError = status.error;
            this.stopCodebookPolling();
            return;
          }

          this.codebookJobProgress = status.progress || 0;

          if (status.status === 'completed') {
            this.codebookJobStatus = 'completed';
            this.stopCodebookPolling();
            this.downloadCodebookResult(workspaceId, jobId);
          } else if (status.status === 'failed') {
            this.codebookJobStatus = 'failed';
            this.codebookJobError = status.error || 'Codebook generation failed';
            this.stopCodebookPolling();
          } else if (status.status === 'processing') {
            this.codebookJobStatus = 'processing';
          } else {
            this.codebookJobStatus = 'pending';
          }
        },
        error: () => {
          this.codebookJobStatus = 'failed';
          this.codebookJobError = 'Failed to get job status';
          this.stopCodebookPolling();
        }
      });
  }

  private stopCodebookPolling(): void {
    if (this.codebookPollingSubscription) {
      this.codebookPollingSubscription.unsubscribe();
      this.codebookPollingSubscription = null;
    }
  }

  private downloadCodebookResult(workspaceId: number, jobId: string): void {
    this.exportService.downloadCodebookFile(workspaceId, jobId).subscribe({
      next: blob => {
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
      },
      error: () => {
        this.codebookJobError = 'Failed to download codebook file';
      }
    });
  }

  resetCodebookJob(): void {
    this.codebookJobId = null;
    this.codebookJobStatus = 'idle';
    this.codebookJobProgress = 0;
    this.codebookJobError = null;
    this.stopCodebookPolling();
  }
}
