/* eslint-disable max-classes-per-file */
import { ApiProperty } from '@nestjs/swagger';
import { CodingFreshnessSummaryDto } from '../coding/coding-freshness.dto';

export class TestResultsUploadStatsDto {
  @ApiProperty({ type: Number })
    testPersons!: number;

  @ApiProperty({ type: Number })
    testGroups!: number;

  @ApiProperty({ type: Number })
    uniqueBooklets!: number;

  @ApiProperty({ type: Number })
    uniqueUnits!: number;

  @ApiProperty({ type: Number })
    uniqueResponses!: number;
}

export type TestResultsUploadIssueCategory =
  'log_format' |
  'unit_not_found' |
  'invalid_unit' |
  'laststate' |
  'missing_booklet' |
  'missing_status' |
  'invalid_status' |
  'csv_columns' |
  'missing_identity' |
  'timestamp' |
  'missing_booklet_log' |
  'no_logs_saved' |
  'other';

export type TestResultsUploadIssueDto = {
  level: 'error' | 'warning';
  category?: TestResultsUploadIssueCategory;
  message: string;
  fileName?: string;
  rowIndex?: number;
};

export type TestResultsUploadSummaryDto = {
  totalRows: number;
  responseRows?: number;
  logRows?: number;
  bookletLogRows?: number;
  unitLogRows?: number;
  savedLogs?: number;
  skippedRows?: number;
  skippedLogs?: number;
  issueCounts?: Partial<Record<TestResultsUploadIssueCategory | 'uncategorized', number>>;
};

export class TestResultsUploadResultDto {
  @ApiProperty({ type: TestResultsUploadStatsDto })
    expected!: TestResultsUploadStatsDto;

  @ApiProperty({ type: TestResultsUploadStatsDto })
    before!: TestResultsUploadStatsDto;

  @ApiProperty({ type: TestResultsUploadStatsDto })
    after!: TestResultsUploadStatsDto;

  @ApiProperty({ type: TestResultsUploadStatsDto })
    delta!: TestResultsUploadStatsDto;

  @ApiProperty({ type: Object, required: false })
    responseStatusCounts?: Record<string, number>;

  @ApiProperty({ type: [Object], required: false })
    issues?: TestResultsUploadIssueDto[];

  @ApiProperty({ type: Object, required: false })
    importSummary?: TestResultsUploadSummaryDto;

  @ApiProperty({ type: Object, required: false })
    logMetrics?: {
    bookletsWithLogs: number;
    totalBooklets: number;
    unitsWithLogs: number;
    totalUnits: number;
    bookletDetails?: { name: string; hasLog: boolean }[];
    unitDetails?: { bookletName: string; unitKey: string; hasLog: boolean }[];
  };

  @ApiProperty({ type: Boolean, required: false })
    importedLogs?: boolean;

  @ApiProperty({ type: Boolean, required: false })
    importedResponses?: boolean;

  @ApiProperty({ type: Boolean, required: false })
    overviewPending?: boolean;

  @ApiProperty({ type: String, required: false })
    overviewMessage?: string;

  @ApiProperty({ type: Object, required: false })
    codingFreshness?: CodingFreshnessSummaryDto;
}
