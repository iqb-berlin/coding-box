import * as ExcelJS from 'exceljs';

export interface ByVariableCombination {
  unitName: string;
  variableId: string;
  bookletName?: string;
}

export interface ByVariableExportEstimate {
  exportType: 'by-variable' | 'by-variable-compact';
  unitVariableCount: number;
  worksheetLimit: number | null;
  exceedsWorksheetLimit: boolean;
}

export interface CompactByVariableRawRow {
  cjuId: string | number;
  unitName: string;
  variableId: string;
  login: string;
  personCode: string;
  personGroup: string | null;
  bookletName: string | null;
  cju_code: string | number | null;
  coding_issue_option: string | number | null;
  updatedAt: Date | string | null;
  code_v1: string | number | null;
  code_v2: string | number | null;
  code_v3: string | number | null;
  autocoder_invalidated_version: string | null;
  status_v1: string | number | null;
  username: string | null;
  notes: string | null;
  pId: string | number;
  trainingId: string | number | null;
  missingsProfileId: string | number | null;
  responseId: string | number | null;
}

export interface CompactByVariableCoding {
  code: number | null;
  notes: string | null;
  codingIssueOption: number | null;
  updatedAt: Date | string | null;
}

export interface StreamingWorkbookTarget {
  workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  chunks: Buffer[];
}

export interface CodingTimesRawRow {
  id: number | string;
  variableId: string;
  updatedAt: Date | string;
  unitName: string;
  bookletName: string | null;
  coderAssignmentId: number | string | null;
  coderName: string | null;
}

export interface DetailedCodingResultRawRow {
  id: number | string;
  createdAt: Date | string | null;
  trainingId: number | string | null;
  missingsProfileId: number | string | null;
  responseId: number | string | null;
  unitName: string | null;
  responseUnitName: string | null;
  variableId: string;
  code: number | string | null;
  notes: string | null;
  codingIssueOption: number | string | null;
  updatedAt: Date | string | null;
  coderName: string | null;
  statusV1: number | string | null;
  bookletName: string | null;
  personLogin: string | null;
  personCode: string | null;
  personGroup: string | null;
  responseValue: string | null;
}

export interface CoderJobRawRow {
  jobId: number | string;
  trainingId: number | string | null;
  userId: number | string | null;
  username: string | null;
}

export interface CoderExportJob {
  id: number;
  training_id: number | null;
}

export interface TrainingDiscussionExportResult {
  code: number | null;
  score: number | null;
  notes: string | null;
  managerUsername: string | null;
  updatedAt: Date | null;
}

export interface AggregatedMostFrequentCoding {
  code: number;
  codingIssueOption: number | null;
}

export interface AggregatedMostFrequentVariableData {
  codings: AggregatedMostFrequentCoding[];
  comments: string[];
}

export interface CompactByVariableGroup {
  key: string;
  unitName: string;
  variableId: string;
  login: string;
  personCode: string;
  personGroup: string;
  bookletName: string;
  codings: Map<string, CompactByVariableCoding>;
}
