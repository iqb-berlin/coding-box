import {
  CodingJob, JobDefinitionCoderConfig, Variable, VariableBundle
} from '../../models/coding-job.model';
import { CodingJobFormValue } from './coding-job-definition-form';
import { JobDefinition } from './coding-job-definition.models';

/** Pure normalization and refresh decisions; independent of the dialog lifecycle. */
export class CodingJobDefinitionRules {
  private readonly defaultCoderCapacityPercent = 100;
  private readonly minCoderCapacityPercent = 10;
  private readonly maxCoderCapacityPercent = 300;

  buildDefinitionPayload(
    value: CodingJobFormValue,
    selections: Required<Pick<JobDefinition, 'assignedVariables' | 'assignedVariableBundles' | 'assignedCoders' | 'assignedCoderConfigs'>>
  ): JobDefinition {
    return {
      name: (value.name ?? '').trim(),
      description: this.sanitizeDescription(value.description),
      ...selections,
      durationSeconds: this.sanitizeNumber(value.durationSeconds),
      maxCodingCases: this.sanitizeNumber(value.maxCodingCases),
      doubleCodingAbsolute: this.sanitizeNumber(value.doubleCodingAbsolute),
      doubleCodingPercentage: this.sanitizeNumber(value.doubleCodingPercentage),
      caseOrderingMode: value.caseOrderingMode,
      missingsProfileId: this.sanitizeNumber(value.missingsProfileId),
      showScore: value.showScore,
      allowComments: value.allowComments,
      suppressGeneralInstructions: value.suppressGeneralInstructions
    };
  }

  normalizeCoderCapacityPercent(value: unknown): number {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return this.defaultCoderCapacityPercent;
    }

    return Math.min(
      this.maxCoderCapacityPercent,
      Math.max(this.minCoderCapacityPercent, numericValue)
    );
  }

  buildExistingJobsDirectUpdatePayload(
    jobDefinition: Partial<JobDefinition>
  ): Partial<JobDefinition> {
    return {
      name: jobDefinition.name,
      description: jobDefinition.description,
      durationSeconds: jobDefinition.durationSeconds,
      showScore: jobDefinition.showScore,
      allowComments: jobDefinition.allowComments,
      suppressGeneralInstructions: jobDefinition.suppressGeneralInstructions
    };
  }

  private normalizeVariablesForComparison(variables?: Variable[]): Array<{
    unitName: string;
    variableId: string;
    includeDeriveError: boolean;
  }> {
    return (variables || [])
      .map(variable => ({
        unitName: variable.unitName || '',
        variableId: variable.variableId || '',
        includeDeriveError: variable.includeDeriveError === true
      }))
      .sort((left, right) => `${left.unitName}::${left.variableId}`
        .localeCompare(`${right.unitName}::${right.variableId}`));
  }

  private normalizeBundlesForComparison(bundles?: VariableBundle[]): Array<{
    id: number;
    caseOrderingMode?: 'continuous' | 'alternating';
    variables: Array<{
      unitName: string;
      variableId: string;
      includeDeriveError: boolean;
    }>;
  }> {
    return (bundles || [])
      .map(bundle => ({
        id: Number(bundle.id),
        caseOrderingMode: bundle.caseOrderingMode,
        variables: this.normalizeVariablesForComparison(
          (bundle.variables || []).filter(variable => variable.includeDeriveError === true)
        )
      }))
      .sort((left, right) => left.id - right.id);
  }

  private normalizeCoderIdsForComparison(coderIds?: number[]): number[] {
    return [...(coderIds || [])].sort((left, right) => left - right);
  }

  private normalizeCoderConfigsForComparison(
    coderConfigs?: JobDefinitionCoderConfig[],
    fallbackCoderIds?: number[]
  ): JobDefinitionCoderConfig[] {
    const configs = coderConfigs && coderConfigs.length > 0 ?
      coderConfigs :
      (fallbackCoderIds || []).map(coderId => ({
        coderId,
        capacityPercent: this.defaultCoderCapacityPercent
      }));

    return configs
      .map(config => ({
        coderId: Number(config.coderId),
        capacityPercent: this.normalizeCoderCapacityPercent(config.capacityPercent)
      }))
      .sort((left, right) => left.coderId - right.coderId);
  }

  private valuesDiffer(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) !== JSON.stringify(right);
  }

  private normalizedOptionalNumber(value: unknown): number | undefined {
    return this.sanitizeNumber(value);
  }

  private normalizedDoubleCodingNumber(value: unknown): number {
    return this.sanitizeNumber(value) ?? 0;
  }

  hasRefreshRelevantDefinitionChanges(
    existingDefinition: CodingJob | undefined,
    jobDefinition: Partial<JobDefinition>
  ): boolean {
    if (!existingDefinition) {
      return false;
    }

    const existingVariables = existingDefinition.assignedVariables ??
      existingDefinition.variables;
    const existingBundles = existingDefinition.assignedVariableBundles ??
      existingDefinition.variableBundles;
    const existingMissingProfileId =
      existingDefinition.missingsProfileId ??
      existingDefinition.missings_profile_id;

    return [
      this.valuesDiffer(
        this.normalizeVariablesForComparison(jobDefinition.assignedVariables),
        this.normalizeVariablesForComparison(existingVariables)
      ),
      this.valuesDiffer(
        this.normalizeBundlesForComparison(jobDefinition.assignedVariableBundles),
        this.normalizeBundlesForComparison(existingBundles)
      ),
      this.valuesDiffer(
        this.normalizeCoderIdsForComparison(jobDefinition.assignedCoders),
        this.normalizeCoderIdsForComparison(existingDefinition.assignedCoders)
      ),
      this.valuesDiffer(
        this.normalizeCoderConfigsForComparison(
          jobDefinition.assignedCoderConfigs,
          jobDefinition.assignedCoders
        ),
        this.normalizeCoderConfigsForComparison(
          existingDefinition.assignedCoderConfigs,
          existingDefinition.assignedCoders
        )
      ),
      this.normalizedOptionalNumber(jobDefinition.missingsProfileId) !==
        this.normalizedOptionalNumber(existingMissingProfileId),
      this.normalizedOptionalNumber(jobDefinition.maxCodingCases) !==
        this.normalizedOptionalNumber(existingDefinition.maxCodingCases),
      this.normalizedDoubleCodingNumber(jobDefinition.doubleCodingAbsolute) !==
        this.normalizedDoubleCodingNumber(existingDefinition.doubleCodingAbsolute),
      this.normalizedDoubleCodingNumber(jobDefinition.doubleCodingPercentage) !==
        this.normalizedDoubleCodingNumber(existingDefinition.doubleCodingPercentage),
      (jobDefinition.caseOrderingMode || 'continuous') !==
        (existingDefinition.caseOrderingMode || 'continuous')
    ].some(Boolean);
  }

  sanitizeNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
  }

  sanitizeDescription(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const description = value.trim();
    return description.length > 0 ? description : null;
  }
}
