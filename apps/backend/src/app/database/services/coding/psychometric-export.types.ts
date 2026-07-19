import {
  PsychometricExportOptions,
  PsychometricVersion
} from '../../../../../../../api-dto/coding/psychometric-discrimination.dto';
import { VariableDetailDto } from '../../../models/unit-variable-details.dto';
import { CorrelationStatus } from './psychometric-statistics.util';

export type PsychometricMetricType = 'SCORE' | 'CODE' | 'CATEGORY';
export type PsychometricMetadataScope = 'UNIT' | 'ITEM';

export interface LanguageCodedText {
  lang?: string;
  value?: string;
}

export interface StoredVocabularyEntry {
  id?: string;
  label?: LanguageCodedText[];
}

export interface StoredSimpleValue {
  raw?: unknown;
  asText?: LanguageCodedText[];
}

export interface StoredMetadataValue {
  id?: string;
  label?: LanguageCodedText[];
  value?: unknown;
}

export interface StoredMetadataProfile {
  profileId?: string;
  isCurrent?: boolean;
  entries?: StoredMetadataValue[];
}

export interface StoredMetadataItem {
  id?: string;
  uuid?: string;
  variableId?: string | null;
  description?: string | null;
  profiles?: StoredMetadataProfile[];
}

export interface StoredVomd {
  profiles?: StoredMetadataProfile[];
  items?: StoredMetadataItem[];
}

export interface VomdDocument {
  fileName: string;
  unitKey: string;
  profiles: StoredMetadataProfile[];
  items: StoredMetadataItem[];
}

export interface MetadataScalarValue {
  id: string;
  label: string;
}

export interface PsychometricMappedItem {
  key: string;
  unitName: string;
  variableId: string;
  sourceVariableId: string;
  itemId: string;
  itemLabel: string;
  variable: VariableDetailDto;
  vomd: VomdDocument;
  vomdItem: StoredMetadataItem;
  domain?: MetadataScalarValue;
}

export interface PsychometricItemMapping {
  items: PsychometricMappedItem[];
  byLogicalKey: Map<string, PsychometricMappedItem>;
  issues: string[];
  fallbacks: string[];
}

export interface PsychometricMetricDefinition {
  value: string;
  label: string;
  score?: number;
  source: 'VOCS' | 'MISSING_PROFILE' | 'OBSERVED' | 'UNIT_DEFINITION';
}

export interface PsychometricMissingDefinition {
  id: string;
  code: number;
  score: number | null;
  label: string;
}

export interface PsychometricRawResponseRow {
  responseId: number | string;
  personId: number | string;
  unitName: string;
  variableId: string;
  value: string | null;
  code: number | string | null;
  score: number | string | null;
}

export interface PsychometricMetricRow {
  type: PsychometricMetricType;
  domain: string;
  domainLabel: string;
  unit: string;
  item: string;
  variable: string;
  itemLabel: string;
  code: string;
  category: string;
  label: string;
  score: number | '';
  source: string;
  n: number;
  positiveN: number | '';
  positiveShare: number | '';
  correlation: number | '';
  status: CorrelationStatus | 'TOO_MANY_CATEGORIES';
  note: string;
}

export interface PsychometricAnalysis {
  rows: PsychometricMetricRow[];
  summary: Array<{ key: string; value: string | number | boolean }>;
}

export interface PsychometricExportServiceOptions extends PsychometricExportOptions {
  workspaceId: number;
  onProgress?: (
    percentage: number,
    details?: { processedRows?: number; totalRows?: number }
  ) => Promise<void>;
  checkCancellation?: () => Promise<void>;
}

export type NormalizedPsychometricExportServiceOptions = Required<
Pick<
PsychometricExportServiceOptions,
| 'workspaceId'
| 'version'
| 'partWholeCorrection'
| 'domain'
| 'maxCategoryCount'
>
> &
PsychometricExportServiceOptions;

export interface PsychometricResponseSnapshot {
  duplicatePersonIds: Set<number>;
  totalRows: number;
  forEachBatch: (
    callback: (
      rows: PsychometricRawResponseRow[],
      processedRows: number
    ) => Promise<void>,
    checkCancellation?: () => Promise<void>
  ) => Promise<void>;
}

export interface PsychometricResponseReaderInput {
  workspaceId: number;
  version: PsychometricVersion;
  mapping: PsychometricItemMapping;
}
