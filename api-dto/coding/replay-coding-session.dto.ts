export type ReplayCodingBundleVariableStatus =
  | 'manual-open'
  | 'manual-coded'
  | 'auto-coded'
  | 'not-coded'
  | 'not-available';

export interface ReplayCodingBundleVariableContextDto {
  responseId: number | null;
  unitName: string;
  variableId: string;
  variableAnchor: string;
  variablePage: string;
  status: ReplayCodingBundleVariableStatus;
  code: number | null;
  score: number | null;
  source: 'manual' | 'auto' | 'none';
}

export interface ReplayCodingBundleContextDto {
  bundleId: number;
  bundleName: string;
  caseKey: string;
  caseOrderingMode: 'continuous' | 'alternating';
  variables: ReplayCodingBundleVariableContextDto[];
}

export interface ReplayCodingSessionUnitDto {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  variablePage: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  variableBundleId: number | null;
  bundleContext: ReplayCodingBundleContextDto | null;
}

export interface ReplayCodingProgressEntryDto {
  id: number;
  code?: string;
  label?: string;
  score?: number;
  codingIssueOption?: number;
}

export interface ReplayCodingSessionJobDto {
  status: string;
  comment: string | null;
  showScore: boolean;
  allowComments: boolean;
  suppressGeneralInstructions: boolean;
}

export type ReplayCodingSessionServerTimingsDto =
  Record<string, number | null>;

export interface ReplayCodingSessionDto {
  units: ReplayCodingSessionUnitDto[];
  progress: Record<string, ReplayCodingProgressEntryDto | null>;
  notes: Record<string, string>;
  job: ReplayCodingSessionJobDto;
  serverTimings: ReplayCodingSessionServerTimingsDto;
}
