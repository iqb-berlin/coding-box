export type PsychometricVersion = 'v1' | 'v2' | 'v3';
export type PsychometricExportFormat = 'csv' | 'excel';
export type PsychometricDomainScope = 'UNIT' | 'ITEM';

export interface PsychometricDomainFieldSelection {
  mode: 'vomd-field';
  scope: PsychometricDomainScope;
  profileId: string;
  entryId: string;
}

export interface PsychometricWholeWorkspaceSelection {
  mode: 'workspace';
}

export type PsychometricDomainSelection =
  PsychometricWholeWorkspaceSelection | PsychometricDomainFieldSelection;

export interface PsychometricDomainCandidateDto {
  scope: PsychometricDomainScope;
  profileId: string;
  entryId: string;
  label: string;
  coverage: number;
  itemCount: number;
  singleValued: boolean;
  selectable: boolean;
}

export interface PsychometricDomainCandidatesDto {
  candidates: PsychometricDomainCandidateDto[];
  mappingIssueCount: number;
}

export interface PsychometricExportOptions {
  version?: PsychometricVersion;
  format?: PsychometricExportFormat;
  partWholeCorrection?: boolean;
  missingsProfileId?: number;
  domain?: PsychometricDomainSelection;
  maxCategoryCount?: number;
}
