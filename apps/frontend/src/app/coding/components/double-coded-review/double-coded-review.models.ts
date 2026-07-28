import type { PostMessage } from '../../../core/services/post-message.service';
import type {
  DoubleCodedManagerDecisionDto,
  DoubleCodedReviewCodeDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

export interface CoderResult {
  coderId: number;
  coderName: string;
  jobId: number;
  jobName: string;
  code: number | null;
  codingIssueOption?: number | null;
  score: number | null;
  notes: string | null;
  supervisorComment: string | null;
  codedAt: string;
  currentSelectionMatch?: boolean;
}

export interface DoubleCodedItem {
  responseId: number;
  sourceUnitId: number;
  unitName: string;
  variableId: string;
  personLogin: string;
  personCode: string;
  bookletName: string;
  givenAnswer: string;
  isResolved: boolean;
  appliedCode: number | null;
  appliedScore: number | null;
  appliedComment: string | null;
  availableCodes: DoubleCodedReviewCodeDto[];
  managerDrafts: DoubleCodedManagerDecisionDto[];
  managerHistory: DoubleCodedManagerDecisionDto[];
  coderResults: CoderResult[];
  selectedCoderResult?: CoderResult;
  currentSelectionCode?: number | null;
}

export interface AppliedReviewResult {
  code: number | null;
  score: number | null;
  comment: string | null;
}

export interface ReplayDecisionResult {
  source: 'replay';
  code: number;
  score: number | null;
  notes?: string;
}

export interface CatalogDecisionResult {
  source: 'catalog';
  code: number;
  score: number | null;
  label: string;
}

export type DecisionResult =
  CoderResult | ReplayDecisionResult | CatalogDecisionResult;

export interface ReplayCodeSelectedMessage extends PostMessage {
  testPerson: string;
  unitId: string;
  variableId: unknown;
  code: unknown;
  score?: unknown;
  notes?: unknown;
  responseId?: number;
}

export interface ReplayDecisionSelection {
  responseId: number;
  variableId: string;
  code: number;
  score: number | null;
  hasScore: boolean;
  notes: string;
  hasNotes: boolean;
}

export type ConflictType = 'none' | 'inter-coder' | 'same-coder' | 'mixed';
