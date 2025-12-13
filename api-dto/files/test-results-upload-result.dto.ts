import { ApiProperty } from '@nestjs/swagger';

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

export type TestResultsUploadIssueDto = {
  level: 'error' | 'warning';
  message: string;
  fileName?: string;
  rowIndex?: number;
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
}
