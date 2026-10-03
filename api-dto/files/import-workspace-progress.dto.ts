import { ImportResultDto } from './import-options.dto';

export type TestcenterImportPhase =
  | 'fetching-responses' | 'saving-responses'
  | 'fetching-logs' | 'saving-logs' | 'finalizing';

export type ImportWorkspaceOptionKey =
  | 'definitions'
  | 'units'
  | 'player'
  | 'codings'
  | 'booklets'
  | 'testTakers'
  | 'metadata';

export interface ImportWorkspaceOptionProgressDto {
  optionKey: ImportWorkspaceOptionKey;
  planned: number;
  processed: number;
  uploaded: number;
  failed: number;
  currentFile?: string;
  status: 'pending' | 'active' | 'completed';
}

export interface ImportWorkspaceFilesProgressDto {
  importRunId: string;
  status: 'running' | 'completed' | 'failed' | 'unknown';
  totalPlanned: number;
  totalProcessed: number;
  totalUploaded: number;
  totalFailed: number;
  currentFile?: string;
  currentOption?: ImportWorkspaceOptionKey;
  options: ImportWorkspaceOptionProgressDto[];
  error?: string;
  updatedAt: number;
  startedAt?: number;
  phaseStartedAt?: number;
  phase?: TestcenterImportPhase;
  currentGroup?: string;
  result?: ImportResultDto;
}
