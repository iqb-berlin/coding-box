import type { CodeBookContentSetting as SharedCodebookOptions } from '@iqb/ngx-coding-components/codebook-models';
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
