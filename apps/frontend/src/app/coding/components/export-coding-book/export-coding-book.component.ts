import {
  ChangeDetectionStrategy,
  computed,
  DestroyRef,
  Component,
  OnInit,
  signal,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CodebookExportComponent } from '@iqb/ngx-coding-components/codebook-export';
import type { CodebookExportConfig, UnitSelectionItem } from '@iqb/ngx-coding-components/codebook-models';
import { DatePipe } from '@angular/common';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { TranslateModule } from '@ngx-translate/core';
import {
  catchError, filter, of, take, takeUntil
} from 'rxjs';
import { takeUntilWorkspaceChanged } from '../../../shared/utils/workspace-request.operator';
import { CodebookExportJobFacade } from './codebook-export-job.facade';
import {
  CodeBookContentSetting,
  CodebookTrainingRequirementFilter
} from '../../../../../../../api-dto/coding/codebook-content-setting';
import { CodingJobBackendService, JobDefinition } from '../../services/coding-job-backend.service';
import { VariableBundle } from '../../models/coding-job.model';
import { MissingsProfileService } from '../../services/missings-profile.service';
import { FileService } from '../../../shared/services/file/file.service';
import { AppService } from '../../../core/services/app.service';
import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { injectUiTranslator } from '../../../shared/utils/ui-translator';
import {
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
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressBarModule,
    TranslateModule
  ],
  providers: [DatePipe, CodebookExportJobFacade]
})
export class ExportCodingBookComponent implements OnInit {
  readonly unitList = signal<number[]>([]);
  readonly availableUnits = signal<CodebookUnitOption[]>([]);
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
  readonly isLoadingJobDefinitions = signal(false);
  readonly selectedVariableBundleIds = signal<number[]>([]);
  readonly availableVariableBundles = signal<VariableBundle[]>([]);
  private readonly draftOptions = signal<CodeBookContentSetting>({
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

  readonly contentOptions = computed(() => ({
    ...this.draftOptions(),
    jobDefinitionId: this.selectedJobDefinitionId(),
    variableBundleIds: this.selectedVariableBundleIds()
  }));

  // Snapshot the defaults so catalog and filter updates preserve edits in the shared form.
  protected readonly initialContentOptions = this.draftOptions();
  private readonly job = inject(CodebookExportJobFacade);
  readonly jobState = this.job.state;
  protected readonly isExportBusy = this.job.busy;
  private readonly destroyRef = inject(DestroyRef);
  private readonly codingJobBackendService = inject<CodingJobBackendService>(CodingJobBackendService);
  private readonly missingsProfileService = inject<MissingsProfileService>(MissingsProfileService);
  private readonly fileService = inject<FileService>(FileService);
  private readonly appService = inject<AppService>(AppService);
  private readonly datePipe = inject<DatePipe>(DatePipe);
  private readonly uiTranslate = injectUiTranslator();
  private readonly dialog = inject<MatDialog>(MatDialog);
  private readonly dialogRef = inject<MatDialogRef<ExportCodingBookComponent>>(MatDialogRef);
  private workspaceId = this.appService.selectedWorkspaceId;
  private readonly closing$ = this.dialogRef.beforeClosed();
  private closing = false;

  protected readonly sharedUnits = computed<UnitSelectionItem[]>(() => this.availableUnits().map(unit => ({
    unitId: unit.unitId,
    key: this.formatUnitName(unit.unitKey),
    unitName: this.formatUnitName(unit.unitName),
    unitAlias: unit.unitAlias
  })));

  protected readonly sharedMissingsProfiles = computed(() => this.missingsProfiles().filter(profile => profile.id !== 0));
  protected readonly jobDefinitionOptions = computed(() => this.availableJobDefinitions().map(jobDefinition => {
    const label = this.getJobDefinitionLabel(jobDefinition);
    const meta = this.getJobDefinitionMeta(jobDefinition);
    const bundleSummary = this.getJobDefinitionBundleSummary(jobDefinition);
    return {
      id: jobDefinition.id ?? 0,
      jobDefinition,
      label,
      meta,
      bundleSummary,
      summary: [meta, bundleSummary].filter(Boolean).join(' · ')
    };
  }));

  private readonly selectedJobDefinitionOption = computed(() => this.jobDefinitionOptions().find(
    option => option.id === this.selectedJobDefinitionId()
  ));

  protected readonly selectedJobDefinitionLabel = computed(() => this.selectedJobDefinitionOption()?.label ||
    this.uiTranslate('coding.job-definition-all'));

  protected readonly selectedJobDefinitionSummary = computed(() => this.selectedJobDefinitionOption()?.summary || '');

  onSharedExport(config: CodebookExportConfig): void {
    if (this.closing || this.isExportBusy()) return;
    this.unitList.set([...config.selectedUnits]);
    this.selectedMissingsProfile.set(config.missingsProfileId);
    this.draftOptions.update(options => ({ ...options, ...config.contentOptions }));
    this.exportCodingBook();
  }

  closeDialog(): void {
    this.closing = true;
    this.dialogRef.close(false);
  }

  ngOnInit(): void {
    this.workspaceId = this.appService.selectedWorkspaceId;
    this.closing$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.closing = true;
    });
    this.appService.selectedWorkspaceId$.pipe(
      filter(workspaceId => workspaceId !== this.workspaceId),
      take(1),
      takeUntil(this.closing$),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.closeDialog());
    this.loadMissingsProfiles();
    this.loadJobDefinitions();
    this.loadVariableBundles();
    this.loadUnitsWithFileIds();
  }

  private loadUnitsWithFileIds(): void {
    const workspaceId = this.workspaceId;
    if (workspaceId) {
      this.isLoading.set(true);
      this.fileService
        .getUnitsWithFileIds(workspaceId)
        .pipe(
          takeUntilWorkspaceChanged(this.appService, workspaceId),
          takeUntil(this.closing$),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe({
          next: units => {
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
              this.unitList.set([]);
              this.applyQuickFilterUnitSelection();
            }
            this.isLoading.set(false);
          },
          error: () => {
            this.isLoading.set(false);
          }
        });
    }
  }

  formatUnitName(unitName: string): string {
    if (unitName && unitName.toLowerCase().endsWith('.vocs')) {
      return unitName.substring(0, unitName.length - 5);
    }
    return unitName;
  }

  onTrainingRequirementChange(trainingRequirement: CodebookTrainingRequirementFilter): void {
    this.draftOptions.update(current => ({ ...current, trainingRequirement }));
  }

  onJobDefinitionFilterChange(jobDefinitionId: number | null): void {
    this.selectedJobDefinitionId.set(jobDefinitionId);
    this.applyQuickFilterUnitSelection();
  }

  onVariableBundleFilterChange(variableBundleIds: number[]): void {
    this.selectedVariableBundleIds.set(Array.isArray(variableBundleIds) ? variableBundleIds : []);
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
    const picker = this.dialog.open(CodebookJobDefinitionPickerDialogComponent, {
      width: '960px',
      maxWidth: '94vw',
      maxHeight: '88vh',
      autoFocus: false,
      data: dialogData
    });
    this.closing$.pipe(
      takeUntil(picker.afterClosed()),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => picker.close());
    picker.afterClosed().pipe(
      takeUntil(this.closing$),
      takeUntilWorkspaceChanged(this.appService, this.workspaceId),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(jobDefinitionId => {
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
      ` · ${this.uiTranslate('coding.job-definition-max-cases', {
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
      this.uiTranslate('coding.job-definition-bundles-more', { names: visibleNames, count: hiddenCount }) :
      this.uiTranslate('coding.job-definition-bundles', { names: visibleNames });
  }

  private loadJobDefinitions(): void {
    const workspaceId = this.workspaceId;
    if (!workspaceId) {
      return;
    }
    this.isLoadingJobDefinitions.set(true);
    this.codingJobBackendService
      .getJobDefinitions(workspaceId)
      .pipe(
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntil(this.closing$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: jobDefinitions => {
          this.availableJobDefinitions.set(
            jobDefinitions
              .filter(jobDefinition => jobDefinition.id !== undefined)
              .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
          );
          this.isLoadingJobDefinitions.set(false);
          this.applyQuickFilterUnitSelection();
        },
        error: () => {
          this.availableJobDefinitions.set([]);
          this.isLoadingJobDefinitions.set(false);
        }
      });
  }

  private loadVariableBundles(): void {
    const workspaceId = this.workspaceId;
    if (!workspaceId) {
      return;
    }
    this.codingJobBackendService
      .getVariableBundles(workspaceId)
      .pipe(
        takeUntilWorkspaceChanged(this.appService, workspaceId),
        takeUntil(this.closing$),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: variableBundles => {
          this.availableVariableBundles.set(
            variableBundles
              .filter(variableBundle => variableBundle.id !== undefined)
              .sort((a, b) => a.name.localeCompare(b.name))
          );
          this.applyQuickFilterUnitSelection();
        },
        error: () => {
          this.availableVariableBundles.set([]);
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
    return this.uiTranslate(`coding-job-definition-dialog.status.definition.${status}`);
  }

  private getJobDefinitionCaseOrderingLabel(jobDefinition: JobDefinition): string {
    const caseOrderingMode = jobDefinition.caseOrderingMode || 'continuous';
    return this.uiTranslate(`coding.job-definition-case-ordering-${caseOrderingMode}`);
  }

  private formatCount(count: number, singularKey: string, pluralKey: string): string {
    return this.uiTranslate(count === 1 ? singularKey : pluralKey, { count });
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

  private loadMissingsProfiles(): void {
    const workspaceId = this.workspaceId;
    if (workspaceId) {
      this.missingsProfileService
        .getMissingsProfiles(workspaceId)
        .pipe(
          takeUntilWorkspaceChanged(this.appService, workspaceId),
          takeUntil(this.closing$),
          takeUntilDestroyed(this.destroyRef),
          catchError(() => of([]))
        )
        .subscribe({
          next: profiles => {
            this.missingsProfiles.set([
              { id: 0, label: '' },
              ...profiles.map((profile: { label: string; id: number }) => ({
                id: profile.id ?? 0,
                label: profile.label
              }))
            ]);
          }
        });
    }
  }

  exportCodingBook(): void {
    const workspaceId = this.workspaceId;
    const units = this.unitList();
    if (this.closing || this.isExportBusy() || !workspaceId || workspaceId !== this.appService.selectedWorkspaceId || units.length === 0) {
      return;
    }

    this.job.start(workspaceId, [...units], {
      ...this.contentOptions(),
      missingsProfile: this.selectedMissingsProfile().toString(),
      variableBundleIds: [...this.selectedVariableBundleIds()]
    }, (file, format) => this.saveFile(file, format));
  }

  private saveFile(file: Blob, format: CodeBookContentSetting['exportFormat']): void {
    const url = window.URL.createObjectURL(file);
    const link = document.createElement('a');
    const timestamp = this.datePipe.transform(new Date(), 'yyyyMMdd_HHmmss');
    link.href = url;
    link.download = `codebook_${timestamp}.${format.toLowerCase()}`;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      window.URL.revokeObjectURL(url);
    }
  }

  protected resetCodebookJob(): void {
    this.job.reset();
  }
}
