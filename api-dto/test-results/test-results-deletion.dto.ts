import { CodingFreshnessImpactDto } from '../coding/coding-freshness.dto';

export type TestResultsDeleteScope =
  | 'persons'
  | 'filteredPersons'
  | 'groups'
  | 'booklets'
  | 'units';

export type TestResultsDeleteTargetType = 'test-results' | 'logs' | 'responses';
export type TestResultsTimestampSource = 'chunk' | 'unknown';

export interface TestResultsDeleteRequestDto {
  scope: TestResultsDeleteScope;
  personIds?: number[];
  searchText?: string;
  groups?: string[];
  bookletNames?: string[];
  unitNames?: string[];
}

export interface TestResultsResponseCleanupRequestDto {
  unitNames: string[];
  answeredBefore: string | number;
  answeredFrom?: string | number;
  variableIds?: string[];
  subforms?: string[];
}

export interface TestResultsResponseCleanupSampleDto {
  responseId: number;
  personId: number;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletId: number;
  bookletName: string;
  unitId: number;
  unitName: string;
  variableId: string;
  subform: string | null;
  value: string | null;
  answeredAt: number | null;
  timestampSource: TestResultsTimestampSource;
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
  codingImpact?: CodingFreshnessImpactDto;
  responseCleanup?: {
    answeredFrom?: number;
    answeredBefore?: number;
    variableIds: string[];
    subforms: string[];
    timestampSourceCounts: Record<TestResultsTimestampSource, number>;
    unknownTimestampResponses: number;
    samples: TestResultsResponseCleanupSampleDto[];
  };
}

export interface TestResultsDeleteResultDto extends TestResultsDeletePreviewDto {
  deletedTargetCount: number;
  deletedBookletLogs?: number;
  deletedUnitLogs?: number;
  deletedSessions?: number;
}
