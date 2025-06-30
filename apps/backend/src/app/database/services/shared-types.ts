// This file contains shared types used across multiple services
// to prevent circular dependencies

export type Response = {
  groupname: string,
  loginname: string,
  code: string,
  bookletname: string,
  unitname: string,
  originalUnitId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responses: any,
  laststate: string,
};

export type Log = {
  groupname: string,
  loginname: string,
  code: string,
  bookletname: string,
  unitname: string,
  originalUnitId: string,
  timestamp: string,
  logentry: string,
};

export type File = {
  filename: string,
  file_id: string,
  file_type: string,
  file_size: number,
  workspace_id: string,
  data: string
};

export type Person = {
  workspace_id: number,
  group: string,
  login: string,
  code: string,
  booklets: TcMergeBooklet[],
};

export type TcMergeBooklet = {
  id: string,
  logs: TcMergeLog[],
  units: TcMergeUnit[],
  sessions: TcMergeSession[]
};

export type TcMergeLog = {
  ts: string,
  key: string,
  parameter: string
};

export type TcMergeSession = {
  browser: string,
  os: string,
  screen: string,
  ts: string,
  loadCompleteMS: number,
};

export type TcMergeUnit = {
  id: string,
  alias: string,
  laststate: TcMergeLastState[],
  subforms: TcMergeSubForms[],
  chunks: TcMergeChunk[],
  logs: TcMergeLog[],
};

export type TcMergeChunk = {
  id: string,
  type: string,
  ts: number,
  variables: string[]
};

export type Chunk = {
  id: string,
  content: string,
  ts: number,
  responseType: string
};

export type TcMergeSubForms = {
  id: string,
  responses: TcMergeResponse[],
};

export type TcMergeResponse = {
  id: string,
  ts: number,
  content: string,
  responseType: string
};

export type TcMergeLastState = {
  key: string,
  value: string
};

export interface CodingStatistics {
  totalResponses: number;
  statusCounts: {
    [key: string]: number;
  };
}
