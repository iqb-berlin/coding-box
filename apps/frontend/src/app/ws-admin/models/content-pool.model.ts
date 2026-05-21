import { TestFilesUploadResultDto } from '../../../../../../api-dto/files/test-files-upload-result.dto';

export interface ContentPoolSettings {
  enabled: boolean;
  baseUrl: string;
}

export interface ContentPoolAcpSummary {
  id: string;
  packageId?: string;
  name?: string;
  description?: string;
}

export interface ContentPoolAcpListResponse {
  settings: ContentPoolSettings;
  acps: ContentPoolAcpSummary[];
}

export interface ContentPoolImportAcpRequest {
  username: string;
  password: string;
  acpId: string;
  overwriteExisting?: boolean;
  overwriteFileIds?: string[];
}

export interface ContentPoolImportAcpStartResponse {
  jobId: string;
}

export type ContentPoolImportAcpJobStatus =
  'pending' |
  'running' |
  'completed' |
  'failed';

export type ContentPoolImportAcpJobPhase =
  'queued' |
  'authenticating' |
  'checking-acp' |
  'loading-files' |
  'downloading-files' |
  'uploading-files' |
  'completed' |
  'failed';

export interface ContentPoolImportAcpProgress {
  jobId: string;
  status: ContentPoolImportAcpJobStatus;
  phase: ContentPoolImportAcpJobPhase;
  message: string;
  processedFiles: number;
  totalFiles: number;
  progress: number;
  currentFileName?: string;
  result?: TestFilesUploadResultDto;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type ContentPoolImportAcpResponse = TestFilesUploadResultDto;

export interface ContentPoolUploadFileResult {
  fileId: number;
  filename: string;
  reason?: string;
}

export interface ContentPoolUploadFilesRequest {
  username: string;
  password: string;
  acpId: string;
  fileIds: number[];
  changelog?: string;
}

export interface ContentPoolUploadFilesResult {
  acpId: string;
  total: number;
  replaced: number;
  skipped: number;
  failed: number;
  replacedFiles: ContentPoolUploadFileResult[];
  skippedFiles: ContentPoolUploadFileResult[];
  failedFiles: ContentPoolUploadFileResult[];
  snapshotId?: string;
  versionNumber?: number;
  changelog?: string;
}

export interface ContentPoolUploadFilesStartResponse {
  jobId: string;
}

export type ContentPoolUploadFilesJobPhase =
  'queued' |
  'authenticating' |
  'checking-acp' |
  'loading-files' |
  'replacing-files' |
  'creating-snapshot' |
  'completed' |
  'failed';

export interface ContentPoolUploadFilesProgress {
  jobId: string;
  status: ContentPoolImportAcpJobStatus;
  phase: ContentPoolUploadFilesJobPhase;
  message: string;
  processedFiles: number;
  totalFiles: number;
  progress: number;
  currentFileName?: string;
  result?: ContentPoolUploadFilesResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
