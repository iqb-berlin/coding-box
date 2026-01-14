export interface CodingScheme {
  variableCodings: VariableCoding[];
  version: string;
}

export interface VariableCoding {
  id: string;
  alias: string;
  label: string;
  sourceType: string;
  processing: string[];
  codeModel: string;
  codes: Code[];
  manualInstruction: string;
}

export interface Code {
  id: number;
  type: 'FULL_CREDIT' | 'RESIDUAL';
  label: string;
  score: number;
  ruleSetOperatorAnd: boolean;
  ruleSets: RuleSet[];
  manualInstruction: string;
}

export interface RuleSet {
  ruleOperatorAnd: boolean;
  rules: Rule[];
}

export interface Rule {
  method: string;
  parameters: string[];
}

export interface CodingIssueDto {
  id: string;
  label: string;
  description: string;
  code: number;
}

export interface CodeSelectedEvent {
  variableId: string;
  code: Code | CodingIssueDto | null;
  codingIssueOption?: CodingIssueDto | null;
}

export interface SelectableItem {
  id: number;
  label: string;
  type: string;
  score?: number;
  manualInstruction?: string;
  description?: string;
  originalCode?: Code;
}

export interface CodingJobStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'paused';
  progress: number;
  result?: {
    totalResponses: number;
    statusCounts: Record<string, number>;
  };
  error?: string;
}

export interface BulkApplyResultItem {
  jobId: number;
  jobName: string;
  hasIssues: boolean;
  skipped: boolean;
  result?: {
    success: boolean;
    updatedResponsesCount: number;
    skippedReviewCount: number;
    message: string;
  };
}

export interface BulkApplyCodingResultsResponse {
  success: boolean;
  jobsProcessed: number;
  totalUpdatedResponses: number;
  totalSkippedReview: number;
  message: string;
  results: BulkApplyResultItem[];
}

export interface ExportJobStatus {
  status: string;
  progress: number;
  result?: {
    fileId: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    workspaceId: number;
    userId: number;
    exportType: string;
    createdAt: number;
  };
  error?: string;
}

export interface SearchResponsesParams {
  value?: string;
  variableId?: string;
  unitName?: string;
  bookletName?: string;
  status?: string;
  codedStatus?: string;
  group?: string;
  code?: string;
  version?: 'v1' | 'v2' | 'v3';
}

export interface SearchResponseItem {
  responseId: number;
  variableId: string;
  value: string;
  status: string;
  code?: number;
  score?: number;
  codedStatus?: string;
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  variablePage?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface CodingJobItem {
  responseId: number;
  unitName: string;
  unitAlias: string | null;
  variableId: string;
  variableAnchor: string;
  bookletName: string;
  personLogin: string;
  personCode: string;
  personGroup: string;
  replayUrl: string;
}

export interface SearchBookletItem {
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  units: {
    unitId: number;
    unitName: string;
    unitAlias: string | null;
  }[];
}

export interface SearchUnitItem {
  unitId: number;
  unitName: string;
  unitAlias: string | null;
  bookletId: number;
  bookletName: string;
  personId: number;
  personLogin: string;
  personCode: string;
  personGroup: string;
  tags: {
    id: number;
    unitId: number;
    tag: string;
    color?: string;
    createdAt: Date;
  }[];
  responses: {
    variableId: string;
    value: string;
    status: string;
    code?: number;
    score?: number;
    codedStatus?: string;
  }[];
}
