import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject
} from '@angular/core';
import { CodebookExportComponent } from '@iqb/ngx-coding-components/codebook-export';
import type { CodebookExportConfig, UnitSelectionItem } from '@iqb/ngx-coding-components/codebook-models';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatOptionModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTableDataSource } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, Subscription, interval } from 'rxjs';
import {
  debounceTime, distinctUntilChanged, exhaustMap, takeUntil
} from 'rxjs/operators';
import {
  CodeBookContentSetting,
  CodebookTrainingRequirementFilter
} from '../../../../../../../api-dto/coding/codebook-content-setting';
import { CodingExportService } from '../../services/coding-export.service';
import { CodingJobBackendService, JobDefinition } from '../../services/coding-job-backend.service';
import { VariableBundle } from '../../models/coding-job.model';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { ValidationStateService, ValidationProgress } from '../../services/validation-state.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { ValidateCodingCompletenessResponseDto } from '../../../../../../../api-dto/coding/validate-coding-completeness-response.dto';
import {
  CodebookJobDefinitionOption,
  CodebookJobDefinitionPickerDialogComponent,
  CodebookJobDefinitionPickerDialogData
} from './codebook-job-definition-picker-dialog.component';

interface CodebookUnitOption {
  unitId: number;
  unitKey: string;
  unitName: string;
  unitAlias: string | null;
  unitData: string;
}
@Component({
  selector: 'coding-box-export-coding-book',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './export-coding-book.component.html',
  styleUrls: ['./export-coding-book.component.scss'],
  standalone: true,
  imports: [
    CodebookExportComponent,
    FormsModule,
    MatDialogModule,
    MatSelectModule,
    MatButtonModule,
    MatFormFieldModule,
    MatOptionModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressBarModule,
    TranslateModule
  ],
  providers: [DatePipe]
})
export class ExportCodingBookComponent implements OnInit, OnDestroy {
  readonly unitList = signal<number[]>([]);
  readonly availableUnits = signal<CodebookUnitOption[]>([]);
  dataSource = new MatTableDataSource<CodebookUnitOption>([]);
  readonly filterValue = signal('');
  filterTextChanged = new Subject<Event>();
  readonly isLoading = signal(false);
  readonly selectedMissingsProfile = signal<number>(0);
  readonly missingsProfiles = signal<
  {
    id: number;
    label: string;
  }[]
  >([{ id: 0, label: '' }]);

  readonly selectedJobDefinitionId = signal<number | null>(null);
  readonly availableJobDefinitions = signal<JobDefinition[]>([]);
  readonly jobDefinitionOptions = signal<CodebookJobDefinitionOption[]>([]);
  readonly selectedJobDefinitionLabel = signal('');
  readonly selectedJobDefinitionSummary = signal('');
  readonly isLoadingJobDefinitions = signal(false);
  readonly selectedVariableBundleIds = signal<number[]>([]);
  readonly availableVariableBundles = signal<VariableBundle[]>([]);
  readonly isLoadingVariableBundles = signal(false);
  readonly workspaceChanges = signal(false);
  displayedColumns: string[] = ['select', 'unitName'];
  readonly contentOptions = signal<CodeBookContentSetting>({
    exportFormat: 'docx',
    missingsProfile: '',
    hasOnlyManualCoding: true,
    hasGeneralInstructions: true,
    hasDerivedVars: true,
    hasOnlyVarsWithCodes: true,
    hasClosedVars: true,
    codeLabelToUpper: true,
    showScore: true,
    hideItemVarRelation: true,
    trainingRequirement: 'all',
    jobDefinitionId: null,
    variableBundleIds: []
  });

  // Initialize the shared form once; host filter and request updates must not reset user edits.
  protected readonly initialContentOptions = this.contentOptions();

  private destroy$ = new Subject<void>();
  readonly validationResults = signal<ValidateCodingCompletenessResponseDto | null>(null);
  readonly validationProgress = signal<ValidationProgress | null>(null);
  readonly isValidating = signal(false);
  readonly validationCacheKey = signal<string | null>(null);
  readonly codebookJobId = signal<string | null>(null);
  readonly codebookJobStatus = signal<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle');
  readonly codebookJobProgress = signal(0);
  readonly codebookJobError = signal<string | null>(null);
  private codebookPollingSubscription: Subscription | null = null;
  private readonly exportService = inject<CodingExportService>(CodingExportService);
  private readonly codingJobBackendService = inject<CodingJobBackendService>(CodingJobBackendService);
  private readonly missingsProfileService = inject<MissingsProfileService>(MissingsProfileService);
  private readonly fileService = inject<FileService>(FileService);
  private readonly appService = inject<AppService>(AppService);
  private readonly datePipe = inject<DatePipe>(DatePipe);
  private readonly validationStateService = inject<ValidationStateService>(ValidationStateService);
  private readonly translateService = inject<TranslateService>(TranslateService);
  private readonly dialog = inject<MatDialog>(MatDialog);
  private readonly dialogRef = inject<MatDialogRef<ExportCodingBookComponent>>(MatDialogRef);
  private readonly changeDetectorRef = inject<ChangeDetectorRef>(ChangeDetectorRef);
  private sharedUnitsSource: CodebookUnitOption[] | null = null;
  private sharedUnitsCache: UnitSelectionItem[] = [];
  private profilesSource:
  | {
    id: number;
    label: string;
  }[]
  | null = null;

  private profilesCache: {
    id: number;
    label: string;
  }[] = [];

  get sharedUnits(): UnitSelectionItem[] {
    if (this.sharedUnitsSource !== this.availableUnits()) {
      this.sharedUnitsSource = this.availableUnits();
      this.sharedUnitsCache = this.availableUnits().map(unit => ({
        unitId: unit.unitId,
        key: unit.unitKey.replace(/\.vocs$/i, ''),
        unitName: this.formatUnitName(unit.unitName),
        unitAlias: unit.unitAlias
      }));
    }
    return this.sharedUnitsCache;
  }

  get sharedMissingsProfiles(): {
    id: number;
    label: string;
  }[] {
    if (this.profilesSource !== this.missingsProfiles()) {
      this.profilesSource = this.missingsProfiles();
      this.profilesCache = this.missingsProfiles().filter(profile => profile.id !== 0);
    }
    return this.profilesCache;
  }

  get isExportBusy(): boolean {
    return this.codebookJobStatus() === 'pending' || this.codebookJobStatus() === 'processing';
  }

  onSharedExport(config: CodebookExportConfig): void {
    if (this.isExportBusy) return;
    this.unitList.set([...config.selectedUnits]);
    this.selectedMissingsProfile.set(config.missingsProfileId);
    this.contentOptions.set({ ...this.contentOptions(), ...config.contentOptions });
    this.exportCodingBook();
  }

  closeDialog(): void {
    this.dialogRef.close(false);
  }

  ngOnInit(): void {
    this.updateSelectedJobDefinitionDisplay();
    this.workspaceChanges.set(this.checkWorkspaceChanges());
    this.loadMissingsProfiles();
    this.loadJobDefinitions();
    this.loadVariableBundles();
    this.loadUnitsWithFileIds();
    this.filterTextChanged
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
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
      this.isLoading.set(true);
      this.fileService
        .getUnitsWithFileIds(workspaceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: units => {
            this.changeDetectorRef.markForCheck();
            if (units && units.length > 0) {
              this.availableUnits.set(
                units.map((unit: { id: number; unitId: string; fileName: string; data: string }) => ({
                  unitId: unit.id,
                  unitKey: unit.unitId,
                  unitName: unit.fileName,
                  unitAlias: null,
                  unitData: unit.data
                }))
              );
              this.dataSource.data = this.availableUnits();
              this.dataSource.filterPredicate = (data, filter: string) => {
                const formattedName = this.formatUnitName(data.unitName).toLowerCase();
                return formattedName.includes(filter);
              };
              this.unitList.set([]);
              this.applyQuickFilterUnitSelection();
            }
            this.isLoading.set(false);
          },
          error: () => {
            this.changeDetectorRef.markForCheck();
            this.isLoading.set(false);
          }
        });
    }
  }

  toggleUnitSelection(unitId: number, isSelected: boolean): void {
    if (isSelected) {
      if (!this.unitList().includes(unitId)) {
        this.unitList.set([...this.unitList(), unitId]);
      }
    } else {
      this.unitList.set(this.unitList().filter(id => id !== unitId));
    }
  }

  isUnitSelected(unitId: number): boolean {
    return this.unitList().includes(unitId);
  }

  formatUnitName(unitName: string): string {
    if (unitName && unitName.toLowerCase().endsWith('.vocs')) {
      return unitName.substring(0, unitName.length - 5);
    }
    return unitName;
  }

  toggleAllUnits(isSelected: boolean): void {
    if (isSelected) {
      this.unitList.set(this.availableUnits().map(unit => unit.unitId));
    } else {
      this.unitList.set([]);
    }
  }

  private checkWorkspaceChanges(): boolean {
    return false;
  }

  onTrainingRequirementChange(trainingRequirement: CodebookTrainingRequirementFilter): void {
    this.contentOptions.update(current => ({ ...current, trainingRequirement: trainingRequirement }));
  }

  onJobDefinitionFilterChange(jobDefinitionId: number | null): void {
    this.selectedJobDefinitionId.set(jobDefinitionId);
    this.contentOptions.update(current => ({ ...current, jobDefinitionId: jobDefinitionId }));
    this.updateSelectedJobDefinitionDisplay();
    this.applyQuickFilterUnitSelection();
  }

  onVariableBundleFilterChange(variableBundleIds: number[]): void {
    this.selectedVariableBundleIds.set(Array.isArray(variableBundleIds) ? variableBundleIds : []);
    this.contentOptions.update(current => ({ ...current, variableBundleIds: this.selectedVariableBundleIds() }));
    this.applyQuickFilterUnitSelection();
  }

  openJobDefinitionPicker(): void {
    if (this.isLoadingJobDefinitions()) {
      return;
    }
    const dialogData: CodebookJobDefinitionPickerDialogData = {
      options: this.jobDefinitionOptions(),
      selectedJobDefinitionId: this.selectedJobDefinitionId()
    };
    this.dialog
      .open(CodebookJobDefinitionPickerDialogComponent, {
        width: '960px',
        maxWidth: '94vw',
        maxHeight: '88vh',
        autoFocus: false,
        data: dialogData
      })
      .afterClosed()
      .pipe(takeUntil(this.destroy$))
      .subscribe(jobDefinitionId => {
        this.changeDetectorRef.markForCheck();
        if (jobDefinitionId !== undefined) {
          this.onJobDefinitionFilterChange(jobDefinitionId);
        }
      });
  }

  private getJobDefinitionLabel(jobDefinition: JobDefinition): string {
    return `${getJobDefinitionDisplayLabel(jobDefinition)} · ${this.getJobDefinitionStatusLabel(jobDefinition)}`;
  }

  private getJobDefinitionMeta(jobDefinition: JobDefinition): string {
    const variableCount = this.getJobDefinitionVariableCount(jobDefinition);
    const unitCount = this.getJobDefinitionUnitCount(jobDefinition);
    const bundleCount = jobDefinition.assignedVariableBundles?.length || 0;
    const coderCount = jobDefinition.assignedCoders?.length || 0;
    const caseOrderingMode = this.getJobDefinitionCaseOrderingLabel(jobDefinition);
    const maxCases = jobDefinition.maxCodingCases ?
      ` · ${this.translateService.instant('coding.job-definition-max-cases', {
        count: jobDefinition.maxCodingCases
      })}` :
      '';
    const scopeSummary = [
      this.formatCount(
        variableCount,
        'coding.job-definition-count-variable-one',
        'coding.job-definition-count-variable-many'
      ),
      this.formatCount(unitCount, 'coding.job-definition-count-unit-one', 'coding.job-definition-count-unit-many'),
      this.formatCount(
        bundleCount,
        'coding.job-definition-count-bundle-one',
        'coding.job-definition-count-bundle-many'
      ),
      this.formatCount(coderCount, 'coding.job-definition-count-coder-one', 'coding.job-definition-count-coder-many')
    ].join(' · ');
    return `${scopeSummary} · ${caseOrderingMode}${maxCases}`;
  }

  private getJobDefinitionBundleSummary(jobDefinition: JobDefinition): string {
    const bundleNames = (jobDefinition.assignedVariableBundles || [])
      .map(bundle => this.getHydratedVariableBundle(bundle.id)?.name || bundle.name)
      .filter((name): name is string => Boolean(name));
    if (bundleNames.length === 0) {
      return '';
    }
    const visibleNames = bundleNames.slice(0, 2).join(', ');
    const hiddenCount = bundleNames.length - 2;
    return hiddenCount > 0 ?
      this.translateService.instant('coding.job-definition-bundles-more', { names: visibleNames, count: hiddenCount }) :
      this.translateService.instant('coding.job-definition-bundles', { names: visibleNames });
  }

  private loadJobDefinitions(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }
    this.isLoadingJobDefinitions.set(true);
    this.codingJobBackendService
      .getJobDefinitions(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: jobDefinitions => {
          this.changeDetectorRef.markForCheck();
          this.availableJobDefinitions.set(
            jobDefinitions
              .filter(jobDefinition => jobDefinition.id !== undefined)
              .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
          );
          this.refreshJobDefinitionOptions();
          this.isLoadingJobDefinitions.set(false);
          this.applyQuickFilterUnitSelection();
        },
        error: () => {
          this.changeDetectorRef.markForCheck();
          this.availableJobDefinitions.set([]);
          this.refreshJobDefinitionOptions();
          this.isLoadingJobDefinitions.set(false);
        }
      });
  }

  private loadVariableBundles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }
    this.isLoadingVariableBundles.set(true);
    this.codingJobBackendService
      .getVariableBundles(workspaceId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: variableBundles => {
          this.changeDetectorRef.markForCheck();
          this.availableVariableBundles.set(
            variableBundles
              .filter(variableBundle => variableBundle.id !== undefined)
              .sort((a, b) => a.name.localeCompare(b.name))
          );
          this.refreshJobDefinitionOptions();
          this.isLoadingVariableBundles.set(false);
          this.applyQuickFilterUnitSelection();
        },
        error: () => {
          this.changeDetectorRef.markForCheck();
          this.availableVariableBundles.set([]);
          this.refreshJobDefinitionOptions();
          this.isLoadingVariableBundles.set(false);
        }
      });
  }

  private applyQuickFilterUnitSelection(): void {
    if (this.availableUnits().length === 0) {
      return;
    }
    const filterVariableSelections: Map<string, Set<string>>[] = [];
    const selectedJobDefinition = this.getSelectedJobDefinition();
    if (selectedJobDefinition) {
      filterVariableSelections.push(this.getJobDefinitionVariableSelections(selectedJobDefinition));
    }
    if (this.selectedVariableBundleIds().length > 0) {
      filterVariableSelections.push(this.getSelectedVariableBundleVariableSelections());
    }
    if (filterVariableSelections.length === 0) {
      this.unitList.set([]);
      return;
    }
    const variableSelections = this.intersectVariableSelectionMaps(filterVariableSelections);
    if (!this.hasVariableSelections(variableSelections)) {
      this.unitList.set([]);
      return;
    }
    const unitKeys = new Set(variableSelections.keys());
    this.unitList.set(
      this.availableUnits()
        .filter(
          unit => unitKeys.has(this.normalizeUnitKey(unit.unitKey)) || unitKeys.has(this.normalizeUnitKey(unit.unitName))
        )
        .map(unit => unit.unitId)
    );
  }

  private getSelectedJobDefinition(): JobDefinition | undefined {
    if (this.selectedJobDefinitionId() === null) {
      return undefined;
    }
    return this.availableJobDefinitions().find(jobDefinition => jobDefinition.id === this.selectedJobDefinitionId());
  }

  private refreshJobDefinitionOptions(): void {
    this.jobDefinitionOptions.set(
      this.availableJobDefinitions().map(jobDefinition => {
        const label = this.getJobDefinitionLabel(jobDefinition);
        const meta = this.getJobDefinitionMeta(jobDefinition);
        const bundleSummary = this.getJobDefinitionBundleSummary(jobDefinition);
        const summary = [meta, bundleSummary].filter(Boolean).join(' · ');
        return {
          id: jobDefinition.id ?? 0,
          jobDefinition,
          label,
          meta,
          bundleSummary,
          summary
        };
      })
    );
    this.updateSelectedJobDefinitionDisplay();
  }

  private updateSelectedJobDefinitionDisplay(): void {
    const selectedOption = this.jobDefinitionOptions().find(option => option.id === this.selectedJobDefinitionId());
    this.selectedJobDefinitionLabel.set(
      selectedOption?.label || this.translateService.instant('coding.job-definition-all')
    );
    this.selectedJobDefinitionSummary.set(selectedOption?.summary || '');
  }

  private getSelectedVariableBundles(): VariableBundle[] {
    if (this.selectedVariableBundleIds().length === 0) {
      return [];
    }
    return this.availableVariableBundles().filter(variableBundle => this.selectedVariableBundleIds().includes(variableBundle.id)
    );
  }

  private getSelectedVariableBundleVariableSelections(): Map<string, Set<string>> {
    const variableSelections = new Map<string, Set<string>>();
    this.getSelectedVariableBundles().forEach(variableBundle => this.addVariableSelections(variableSelections, variableBundle.variables)
    );
    return variableSelections;
  }

  private intersectVariableSelectionMaps(selectionMaps: Map<string, Set<string>>[]): Map<string, Set<string>> {
    const [firstSelectionMap, ...otherSelectionMaps] = selectionMaps;
    if (!firstSelectionMap) {
      return new Map<string, Set<string>>();
    }
    const intersection = new Map(
      [...firstSelectionMap.entries()].map(([unitKey, variableIds]) => [unitKey, new Set(variableIds)])
    );
    otherSelectionMaps.forEach(selectionMap => {
      [...intersection.entries()].forEach(([unitKey, variableIds]) => {
        const nextVariableIds = selectionMap.get(unitKey);
        if (!nextVariableIds) {
          intersection.delete(unitKey);
          return;
        }
        const intersectedVariableIds = new Set(
          [...variableIds].filter(variableId => nextVariableIds.has(variableId))
        );
        if (intersectedVariableIds.size === 0) {
          intersection.delete(unitKey);
          return;
        }
        intersection.set(unitKey, intersectedVariableIds);
      });
    });
    return intersection;
  }

  private getJobDefinitionVariableSelections(jobDefinition: JobDefinition): Map<string, Set<string>> {
    const variableSelections = new Map<string, Set<string>>();
    this.addVariableSelections(variableSelections, jobDefinition.assignedVariables || []);
    (jobDefinition.assignedVariableBundles || []).forEach(bundle => {
      const hydratedBundle = this.getHydratedVariableBundle(bundle.id);
      this.addVariableSelections(variableSelections, hydratedBundle?.variables || []);
    });
    return variableSelections;
  }

  private getHydratedVariableBundle(bundleId: number | undefined): VariableBundle | undefined {
    if (bundleId === undefined) {
      return undefined;
    }
    return this.availableVariableBundles().find(availableBundle => availableBundle.id === bundleId);
  }

  private getJobDefinitionVariables(jobDefinition: JobDefinition): Array<{
    unitName?: string;
    variableId?: string;
  }> {
    const directVariables = jobDefinition.assignedVariables || [];
    const bundleVariables = (jobDefinition.assignedVariableBundles || []).flatMap(
      bundle => this.getHydratedVariableBundle(bundle.id)?.variables || bundle.variables || []
    );
    return [...directVariables, ...bundleVariables];
  }

  private getJobDefinitionVariableCount(jobDefinition: JobDefinition): number {
    const variableKeys = new Set(
      this.getJobDefinitionVariables(jobDefinition)
        .map(variable => `${this.normalizeUnitKey(variable.unitName)}:${variable.variableId || ''}`)
        .filter(variableKey => variableKey !== ':')
    );
    return variableKeys.size;
  }

  private getJobDefinitionUnitCount(jobDefinition: JobDefinition): number {
    const unitKeys = new Set(
      this.getJobDefinitionVariables(jobDefinition)
        .map(variable => this.normalizeUnitKey(variable.unitName))
        .filter(Boolean)
    );
    return unitKeys.size;
  }

  private getJobDefinitionStatusLabel(jobDefinition: JobDefinition): string {
    const status = jobDefinition.status || 'draft';
    return this.translateService.instant(`coding-job-definition-dialog.status.definition.${status}`);
  }

  private getJobDefinitionCaseOrderingLabel(jobDefinition: JobDefinition): string {
    const caseOrderingMode = jobDefinition.caseOrderingMode || 'continuous';
    return this.translateService.instant(`coding.job-definition-case-ordering-${caseOrderingMode}`);
  }

  private formatCount(count: number, singularKey: string, pluralKey: string): string {
    return this.translateService.instant(count === 1 ? singularKey : pluralKey, { count });
  }

  private addVariableSelections(
    variableSelections: Map<string, Set<string>>,
    variables: Array<{
      unitName?: string;
      variableId?: string;
    }>
  ): void {
    variables.forEach(variable => {
      const unitKey = this.normalizeUnitKey(variable.unitName);
      const variableId = this.normalizeVariableIdForUnit(unitKey, variable.variableId);
      if (!unitKey || !variableId) {
        return;
      }
      const variableIds = variableSelections.get(unitKey) ?? new Set<string>();
      variableIds.add(variableId);
      variableSelections.set(unitKey, variableIds);
    });
  }

  private hasVariableSelections(variableSelections: Map<string, Set<string>>): boolean {
    return [...variableSelections.values()].some(variableIds => variableIds.size > 0);
  }

  private normalizeUnitKey(value: string | undefined): string {
    return (value || '')
      .trim()
      .replace(/\.vocs$/i, '')
      .toUpperCase();
  }

  private normalizeVariableIdForUnit(unitKey: string, value: string | undefined): string {
    const variableId = (value || '').trim();
    if (!unitKey || !variableId) {
      return '';
    }
    const unit = this.availableUnits().find(
      availableUnit => this.normalizeUnitKey(availableUnit.unitKey) === unitKey ||
        this.normalizeUnitKey(availableUnit.unitName) === unitKey
    );
    if (!unit?.unitData) {
      return variableId;
    }
    try {
      const scheme = JSON.parse(unit.unitData) as {
        variableCodings?: Array<{
          id?: string;
          alias?: string;
        }>;
      };
      const variableCodings = scheme.variableCodings || [];
      const matchingVariableCoding =
        variableCodings.find(variableCoding => variableCoding.alias?.trim() === variableId) ||
        variableCodings.find(variableCoding => variableCoding.id?.trim() === variableId);
      return matchingVariableCoding?.alias?.trim() || matchingVariableCoding?.id?.trim() || variableId;
    } catch {
      return variableId;
    }
  }

  private handleValidationResults(results: ValidateCodingCompletenessResponseDto | null): void {
    this.changeDetectorRef.markForCheck();
    this.validationResults.set(results);
    if (results) {
      this.validationCacheKey.set(results.cacheKey || null);
    }
  }

  private handleValidationProgress(progress: ValidationProgress): void {
    this.changeDetectorRef.markForCheck();
    this.validationProgress.set(progress);
    this.isValidating.set(progress.status === 'loading' || progress.status === 'processing');
  }

  private loadMissingsProfiles(): void {
    const workspaceId = this.appService.selectedWorkspaceId;
    if (workspaceId) {
      this.missingsProfileService
        .getMissingsProfiles(workspaceId)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: profiles => {
            this.changeDetectorRef.markForCheck();
            this.missingsProfiles.set([
              { id: 0, label: '' },
              ...profiles.map((profile: { label: string; id: number }) => ({
                id: profile.id ?? 0,
                label: profile.label
              }))
            ]);
            this.selectedMissingsProfile.set(0);
            this.contentOptions.update(current => ({
              ...current,
              missingsProfile: this.selectedMissingsProfile().toString()
            }));
          },
          error: () => {
            this.changeDetectorRef.markForCheck();
            // Error occurred while loading missings profiles
          }
        });
    }
  }

  exportCodingBook(): void {
    if (this.isExportBusy) return;
    const workspaceId = this.appService.selectedWorkspaceId;
    if (!workspaceId) {
      return;
    }
    if (this.unitList().length === 0) {
      return;
    }
    this.contentOptions.update(current => ({
      ...current,
      missingsProfile: this.selectedMissingsProfile().toString()
    }));
    this.contentOptions.update(current => ({ ...current, jobDefinitionId: this.selectedJobDefinitionId() }));
    this.contentOptions.update(current => ({ ...current, variableBundleIds: this.selectedVariableBundleIds() }));
    this.codebookJobStatus.set('pending');
    this.codebookJobProgress.set(0);
    this.codebookJobError.set(null);
    this.codebookJobId.set(null);
    this.exportService
      .startCodebookJob(workspaceId, this.contentOptions().missingsProfile, this.contentOptions(), this.unitList())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: response => {
          this.changeDetectorRef.markForCheck();
          this.codebookJobId.set(response.jobId);
          this.startCodebookPolling(workspaceId, response.jobId);
        },
        error: () => {
          this.changeDetectorRef.markForCheck();
          this.codebookJobStatus.set('failed');
          this.codebookJobError.set('Failed to start codebook generation job');
        }
      });
  }

  private startCodebookPolling(workspaceId: number, jobId: string): void {
    this.stopCodebookPolling();
    this.codebookPollingSubscription = interval(1500)
      .pipe(
        exhaustMap(() => this.exportService.getCodebookJobStatus(workspaceId, jobId)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: status => {
          this.changeDetectorRef.markForCheck();
          if (!status.status && status.error) {
            this.codebookJobStatus.set('failed');
            this.codebookJobError.set(status.error);
            this.stopCodebookPolling();
            return;
          }
          this.codebookJobProgress.set(status.progress || 0);
          if (status.status === 'completed') {
            this.codebookJobStatus.set('processing');
            this.stopCodebookPolling();
            this.downloadCodebookResult(workspaceId, jobId);
          } else if (status.status === 'failed') {
            this.codebookJobStatus.set('failed');
            this.codebookJobError.set(status.error || 'Codebook generation failed');
            this.stopCodebookPolling();
          } else if (status.status === 'processing') {
            this.codebookJobStatus.set('processing');
          } else {
            this.codebookJobStatus.set('pending');
          }
        },
        error: () => {
          this.changeDetectorRef.markForCheck();
          this.codebookJobStatus.set('failed');
          this.codebookJobError.set('Failed to get job status');
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
    this.exportService
      .downloadCodebookFile(workspaceId, jobId)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.changeDetectorRef.markForCheck();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          const timestamp = this.datePipe.transform(new Date(), 'yyyyMMdd_HHmmss');
          const fileExtension = this.contentOptions().exportFormat.toLowerCase();
          a.href = url;
          a.download = `codebook_${timestamp}.${fileExtension}`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
          this.codebookJobStatus.set('completed');
        },
        error: () => {
          this.changeDetectorRef.markForCheck();
          this.codebookJobStatus.set('failed');
          this.codebookJobError.set('Failed to download codebook file');
        }
      });
  }

  resetCodebookJob(): void {
    this.codebookJobId.set(null);
    this.codebookJobStatus.set('idle');
    this.codebookJobProgress.set(0);
    this.codebookJobError.set(null);
    this.stopCodebookPolling();
  }
}
