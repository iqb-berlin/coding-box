import { Request } from 'express';

export interface RequestWithUser extends Request {
  user: {
    id: string;
  };
}

export interface ExportJobStatus {
  jobId: string;
  status: string;
  progress: number;
  exportType: string;
  createdAt: Date;
  error: string;
}

export interface ExportResult {
  workspaceId: number;
  filePath: string;
  fileName: string;
}

export interface ResolveDuplicateResponsesRequest {
  resolutionMap: Record<string, number>;
}

export interface FlatResponseFrequenciesRequest {
  combos: Array<{ unitKey: string; variableId: string; values: string[] }>;
}

export interface FlatResponseFilterOptions {
  codes: string[];
  groups: string[];
  logins: string[];
  booklets: string[];
  units: string[];
  responses: string[];
  responseStatuses: string[];
  tags: string[];
  processingDurations: string[];
  unitProgresses: string[];
  sessionBrowsers: string[];
  sessionOs: string[];
  sessionScreens: string[];
  sessionIds: string[];
}

export interface BookletLogsResponse {
  bookletId: number;
  logs: {
    id: number;
    bookletid: number;
    ts: string;
    key: string;
    parameter: string;
  }[];
  sessions: {
    id: number;
    browser: string;
    os: string;
    screen: string;
    ts: string;
  }[];
  units: {
    id: number;
    bookletid: number;
    name: string;
    alias: string | null;
    logs: unknown[];
  }[];
}

export interface PersonTestResult {
  id: number;
  name: string;
  logs: {
    id: number;
    bookletid: number;
    ts: string;
    parameter: string;
    key: string;
  }[];
  units: {
    id: number;
    name: string;
    alias: string | null;
    results: {
      id: number;
      unitid: number;
      variableid: string;
      status: string;
      value: string;
      subform: string;
      code?: number;
      score?: number;
      codedstatus?: string;
    }[];
    tags: {
      id: number;
      unitId: number;
      tag: string;
      color?: string;
      createdAt: Date;
    }[];
  }[];
}

export interface BookletSearchResult {
  data: {
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
  }[];
  total: number;
}

export interface UnitSearchResult {
  data: {
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
  }[];
  total: number;
}

export interface ResponseSearchResult {
  data: {
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
  }[];
  total: number;
}
