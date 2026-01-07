import { ResponseStatusType, ResponseValueType } from '@iqbspecs/response/response.interface';
// eslint-disable-next-line import/no-cycle
import Persons from '../entities/persons.entity';
// eslint-disable-next-line import/no-cycle
import { Unit } from '../entities/unit.entity';

export type Response = {
  groupname: string,
  loginname: string,
  code: string,
  bookletname: string,
  unitname: string,
  originalUnitId: string,
  responses: string | Chunk[],
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
  responseType: string,
  subForm: string
};

export type TcMergeSubForms = {
  id: string,
  responses: TcMergeResponse[],
};

export type TcMergeResponse = {
  id: string,
  value: ResponseValueType,
  status: ResponseStatusType
  subform?: string;
  code?: number;
  score?: number;
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

export interface CodingStatisticsWithJob extends CodingStatistics {
  jobId?: string;
  message?: string;
}

export type PersonsWithUnits = Persons & { units: Unit[] };
