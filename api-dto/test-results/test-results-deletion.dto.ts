export type TestResultsDeleteScope =
  | 'persons'
  | 'filteredPersons'
  | 'groups'
  | 'booklets'
  | 'units';

export interface TestResultsDeleteRequestDto {
  scope: TestResultsDeleteScope;
  personIds?: number[];
  searchText?: string;
  groups?: string[];
  bookletNames?: string[];
  unitNames?: string[];
}

export interface TestResultsDeletePreviewDto {
  scope: TestResultsDeleteScope;
  label: string;
  persons: number;
  booklets: number;
  units: number;
  responses: number;
  groups: string[];
  bookletNames: string[];
  unitNames: string[];
  warnings: string[];
}

export interface TestResultsDeleteResultDto extends TestResultsDeletePreviewDto {
  deletedTargetCount: number;
}
