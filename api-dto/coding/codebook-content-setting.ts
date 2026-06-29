/**
 * Settings for codebook content generation
 */
export type CodebookExportFormat = 'docx' | 'json';
export type CodebookTrainingRequirementFilter = 'all' | 'required' | 'not-required';

export interface CodeBookContentSetting {
  /** Export format (docx or json) */
  exportFormat: CodebookExportFormat;
  /** Missings profile name */
  missingsProfile: string;
  /** Include only manual coding */
  hasOnlyManualCoding: boolean;
  /** Include general instructions */
  hasGeneralInstructions: boolean;
  /** Include derived variables */
  hasDerivedVars: boolean;
  /** Include only variables with codes */
  hasOnlyVarsWithCodes: boolean;
  /** Include closed variables */
  hasClosedVars: boolean;
  /** Convert code labels to uppercase */
  codeLabelToUpper: boolean;
  /** Show score */
  showScore: boolean;
  /** Hide item-variable relation */
  hideItemVarRelation: boolean;
  /** Filter variables by increased coder training requirement */
  trainingRequirement?: CodebookTrainingRequirementFilter;
  /** Restrict variables to a job definition */
  jobDefinitionId?: number | null;
  /** Restrict variables to one or more variable bundles */
  variableBundleIds?: number[];
}
