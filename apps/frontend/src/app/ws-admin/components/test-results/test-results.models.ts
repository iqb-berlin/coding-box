import { TestResultsDeleteRequestDto, TestResultsResponseCleanupRequestDto } from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import { UnitTagDto } from '../../../../../../../api-dto/unit-tags/unit-tag.dto';

export interface BookletLog {
  id: number;
  bookletid: number;
  ts: string;
  parameter: string;
  key: string;
}

export interface BookletSession {
  id: number;
  browser: string;
  os: string;
  screen: string;
  ts: string;
}

export interface UnitResult {
  id: number;
  unitid: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code?: number;
  score?: number;
  codedstatus?: string;
}

export interface UnitLog {
  id: number;
  unitid: number;
  ts: string;
  key: string;
  parameter: string;
}

export interface Unit {
  id: number;
  bookletid: number;
  name: string;
  alias: string | null;
  results: UnitResult[];
  logs: UnitLog[];
  tags: UnitTagDto[];
}

export interface Booklet {
  id: number;
  personid: number;
  name: string;
  title?: string;
  size: number;
  logs: BookletLog[];
  sessions?: BookletSession[];
  units: Unit[];
}

export interface Response {
  id: number;
  unitid: number;
  variableid: string;
  status: string;
  value: string;
  subform: string;
  code?: number;
  score?: number;
  codedstatus?: string;
  expanded?: boolean;
}

export interface TestResultPerson {
  id: number;
  code: string;
  group: string;
  login: string;
  uploaded_at: Date;
}

export type TestResultsDeleteCommand = { kind: 'results'; request: TestResultsDeleteRequestDto } |
{ kind: 'responses'; request: TestResultsResponseCleanupRequestDto };
