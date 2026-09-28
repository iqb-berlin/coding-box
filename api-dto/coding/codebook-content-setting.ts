import type { CodeBookContentSetting as SharedCodebookOptions } from '@iqb/ngx-coding-components/codebook-models';
/**
 * Settings for codebook content generation
 */
export type CodebookExportFormat = 'docx' | 'json';
export type CodebookTrainingRequirementFilter = 'all' | 'required' | 'not-required';

export interface CodeBookContentSetting extends SharedCodebookOptions {
  /** Filter variables by increased coder training requirement */
  trainingRequirement?: CodebookTrainingRequirementFilter;
  /** Restrict variables to a job definition */
  jobDefinitionId?: number | null;
  /** Restrict variables to one or more variable bundles */
  variableBundleIds?: number[];
}
