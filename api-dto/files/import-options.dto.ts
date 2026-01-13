import { TestFilesUploadResultDto } from './test-files-upload-result.dto';

export interface ImportOptionsDto {
  responses: string;
  definitions: string;
  units: string;
  player: string;
  codings: string;
  logs: string;
  testTakers: string;
  booklets: string;
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
  testFilesUploadResult?: TestFilesUploadResultDto;
}
