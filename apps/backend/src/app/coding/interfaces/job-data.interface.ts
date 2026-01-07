export interface TestPersonCodingJobData {
  workspaceId: number;
  personIds: string[];
  groupNames?: string;
  isPaused?: boolean;
  autoCoderRun?: number;
}

export interface ExportJobData {
  workspaceId: number;
  userId: number;
  exportType:
  | 'aggregated'
  | 'by-coder'
  | 'by-variable'
  | 'detailed'
  | 'coding-times'
  | 'test-results'
  | 'test-logs';
  outputCommentsInsteadOfCodes?: boolean;
  includeReplayUrl?: boolean;
  anonymizeCoders?: boolean;
  usePseudoCoders?: boolean;
  doubleCodingMethod?:
  | 'new-row-per-variable'
  | 'new-column-per-coder'
  | 'most-frequent';
  includeComments?: boolean;
  includeModalValue?: boolean;
  includeDoubleCoded?: boolean;
  excludeAutoCoded?: boolean;
  authToken?: string;
  isCancelled?: boolean;
  testResultFilters?: {
    groupNames?: string[];
    bookletNames?: string[];
    unitNames?: string[];
    personIds?: number[];
  };
}

export interface ExportJobResult {
  fileId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  workspaceId: number;
  userId: number;
  exportType: string;
  createdAt: number;
}
