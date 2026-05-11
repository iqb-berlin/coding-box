export type TestResultsDeleteScope =
  | 'persons'
  | 'filteredPersons'
  | 'groups'
  | 'booklets'
  | 'units';

export type TestResultsDeleteTargetType = 'test-results' | 'logs';

export interface TestResultsDeleteRequestDto {
  scope: TestResultsDeleteScope;
  personIds?: number[];
  searchText?: string;
  groups?: string[];
  bookletNames?: string[];
  unitNames?: string[];
}

export interface TestResultsDeletePreviewDto {
  targetType?: TestResultsDeleteTargetType;
  scope: TestResultsDeleteScope;
  label: string;
  persons: number;
  booklets: number;
  units: number;
  responses: number;
  bookletLogs?: number;
  unitLogs?: number;
  sessions?: number;
  groups: string[];
  bookletNames: string[];
  unitNames: string[];
  warnings: string[];
}

export interface TestResultsDeleteResultDto extends TestResultsDeletePreviewDto {
  deletedTargetCount: number;
  deletedBookletLogs?: number;
  deletedUnitLogs?: number;
  deletedSessions?: number;
}
