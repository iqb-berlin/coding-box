import { TestFilesUploadResultDto } from './test-files-upload-result.dto';
import { TestResultsUploadIssueDto } from './test-results-upload-result.dto';

export interface ImportOptionsDto {
  responses: string;
  definitions: string;
  units: string;
  player: string;
  codings: string;
  logs: string;
  testTakers: string;
  booklets: string;
  metadata: string;
}

export interface ImportResultDto {
  success: boolean;
  testFiles: number;
  responses: number;
  logs: number;
  booklets: number;
  units: number;
  persons: number;
  importedGroups: string[];
  filesPlayer?: number;
  filesUnits?: number;
  filesDefinitions?: number;
  filesCodings?: number;
  filesBooklets?: number;
  filesTestTakers?: number;
  filesMetadata?: number;
  testFilesUploadResult?: TestFilesUploadResultDto;
  issues?: TestResultsUploadIssueDto[];
  // Log coverage metrics
  bookletsWithLogs?: number;
  totalBooklets?: number;
  unitsWithLogs?: number;
  totalUnits?: number;
}
