import type * as Autocoder from '@iqb/responses';
import type { EntityManager } from 'typeorm';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import type { CodedResponse, CodingStatistics } from '../shared';
import type { AutocoderOutputShadow } from './autocoder-output-shadow.util';

// Use the installed engine's contract here. The application's persistence and
// manual-coding contract remains response 1.5.1, including legacy status 13.
export type AutocoderResponse = Parameters<typeof Autocoder.CodingSchemeFactory.code>[0][number];

export type UnitCodingJobMetadata = {
  source?: 'manual-selection' | 'coding-freshness';
  freshnessVersion?: 'v1' | 'v3';
  freshnessStates?: ('PENDING' | 'STALE')[];
  freshnessSourceRevision?: number;
  groupNames?: string;
};

export type ProcessTestPersonsBatchOptions = {
  persist?: boolean;
  capturePlan?: (plan: AutocoderBatchPlan) => void;
  preflightContext?: AutocoderPreflightContext;
  maxCodedResponses?: number;
  preflightManager?: EntityManager;
};

export type AutocoderPreflightContext = {
  codingSchemeValidations: Map<string, Promise<void>>;
};

export type AutocoderBatchPlan = {
  workspaceId: number;
  codedResponses: CodedResponse[];
  statistics: CodingStatistics;
  unitIds: number[];
  autoCoderRun: 1 | 2;
  freshnessSourceRevision?: number;
};

export type AutocoderPersistenceSource = {
  resultId: string;
  resultIndex: number;
  targetVariableId: string;
  unitId: number;
  unitName: string;
  codingSchemeRef?: string;
  subform: string;
  status: string;
  code: number | null;
  possibleOrigins: string[];
};

export type AutocoderNamespace = {
  variableCodings: VariableCodingData[];
  inputTechnicalIdByAlias: Map<string, string>;
  outputAliasByTechnicalId: Map<string, string>;
  componentById: Map<string, AutocoderNamespaceComponent>;
  outputShadows: AutocoderOutputShadow[];
};

export type AutocoderNamespaceComponent = {
  aliasOnlyIds: Set<string>;
  outputAliasIds: Set<string>;
  technicalOnlyIds: Set<string>;
};

export type AutocoderInputOrigin = {
  responseId: number;
  storedVariableId: string;
  isAutocoderGenerated: boolean;
};

export type CompleteDerivedTuple = {
  version: 'v1' | 'v2';
  code: number | null;
  score: number | null;
};

export type CompleteDerivedTupleResolution =
  { action: 'NOT_APPLICABLE' } |
  {
    action: 'PRESERVE';
    tuple: CompleteDerivedTuple;
    reason: CompleteDerivedTuplePreservationReason;
  } |
  {
    action: 'RECALCULATE_INVALIDATED';
    recalculatedResult: AutocoderResponse;
  } |
  {
    action: 'DERIVED_VALUE_CHANGED';
    tuple: CompleteDerivedTuple;
    recalculatedResult: AutocoderResponse;
  };

export type CompleteDerivedTuplePreservationReason =
  'UNCHANGED' |
  'V2_RECALCULATION_NOT_COMPLETE';

export type CompleteDerivedRecalculation = {
  targetResults: Map<string, AutocoderResponse>;
  authoritativeResults: AutocoderResponse[] | null;
  independentRecalculationAvailable: boolean;
};

export type BatchCheckpoint = (progress: number | undefined, stage: string) => Promise<boolean>;
