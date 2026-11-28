import { FlatTestResultResponseRow } from '../../../shared/services/test-result/test-result.service';

export type FlatResponseRow = FlatTestResultResponseRow;

export interface FlatResponseFilters {
  code: string;
  group: string;
  login: string;
  booklet: string;
  unit: string;
  response: string;
  responseStatus: string;
  responseValue: string;
  tags: string;
  geogebra: boolean;
  audioLow: boolean;
  nonEmptyResponse: boolean;
  sessionFilter: boolean;
  shortProcessing: boolean;
  longLoading: boolean;
  logAnomalies: string;
}

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

export interface UnitLog {
  id: number;
  unitid: number;
  ts: string;
  key: string;
  parameter: string;
}

export interface UnitFromPersonTestResults {
  id: number;
  bookletid: number;
  name: string;
  alias: string | null;
  logs?: UnitLog[];
}

export interface BookletFromPersonTestResults {
  id: number;
  name: string;
  logs: BookletLog[];
  sessions?: BookletSession[];
  units: UnitFromPersonTestResults[];
}

export type FlatTableMediaFilter =
  | 'geogebra'
  | 'audioLow'
  | 'nonEmptyResponse'
  | 'sessionFilter'
  | 'shortProcessing'
  | 'longLoading'
  | 'processingDuration'
  | 'unitProgressComplete'
  | 'logAny'
  | 'logCritical'
  | 'logTechnical'
  | 'logIncomplete'
  | 'logConnectionLost'
  | 'logTimer'
  | 'logFocus'
  | 'logDebug'
  | 'logReloads';

export type RegexFlatResponseFilterField =
  | 'code'
  | 'group'
  | 'login'
  | 'booklet'
  | 'unit'
  | 'response';

export const REGEX_FLAT_RESPONSE_FILTER_FIELDS: RegexFlatResponseFilterField[] = [
  'code',
  'group',
  'login',
  'booklet',
  'unit',
  'response'
];

export const SPECIFIC_LOG_MEDIA_FILTERS: FlatTableMediaFilter[] = [
  'logCritical',
  'logTechnical',
  'logIncomplete',
  'logConnectionLost',
  'logTimer',
  'logFocus',
  'logDebug',
  'logReloads'
];
