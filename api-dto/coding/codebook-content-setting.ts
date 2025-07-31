/**
 * Settings for codebook content generation
 */
export interface CodeBookContentSetting {
  /** Export format (docx or json) */
  exportFormat: string;
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
}
