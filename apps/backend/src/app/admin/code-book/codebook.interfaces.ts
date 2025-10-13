import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';

/**
 * Item metadata for codebook
 */
export interface ItemMetadata {
  [key: string]: unknown;
}

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

/**
 * Missing code definition
 */
export interface Missing {
  /** Missing code */
  code: string;
  /** Missing label */
  label: string;
  /** Missing description */
  description: string;
}

/**
 * Code information for codebook
 */
export interface CodeInfo {
  /** Code ID */
  id: string;
  /** Code label */
  label: string;
  /** Code description */
  description: string;
  /** Code score (optional) */
  score?: string;
}

/**
 * Variable information for codebook
 */
export interface BookVariable {
  /** Variable ID */
  id: string;
  /** Variable label */
  label: string;
  /** Variable source type */
  sourceType: string;
  /** General instruction */
  generalInstruction: string;
  /** Codes */
  codes: CodeInfo[];
}

/**
 * Unit data for codebook
 */
export interface CodebookUnitDto {
  /** Unit key */
  key: string;
  /** Unit name */
  name: string;
  /** Variables */
  variables: BookVariable[];
  /** Missings */
  missings: Missing[];
  /** Items (optional) */
  items?: ItemMetadata[];
}

/**
 * Unit properties for codebook generation
 */
export interface UnitPropertiesForCodebook {
  /** Unit ID */
  id: number;
  /** Unit key */
  key: string;
  /** Unit name */
  name: string;
  /** Coding scheme */
  scheme?: string;
  /** Scheme type */
  schemeType?: string;
  /** Metadata */
  metadata?: {
    /** Items */
    items?: ItemMetadata[];
  };
  /** Variables */
  variables?: VariableInfo[];
}
