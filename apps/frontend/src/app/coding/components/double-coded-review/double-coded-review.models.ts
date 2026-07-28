import type { PostMessage } from '../../../core/services/post-message.service';
import type {
  DoubleCodedReviewCoderResultDto,
  DoubleCodedReviewItemDto
} from '../../../../../../../api-dto/coding/double-coded-review.dto';

export interface CoderResult
  extends Omit<DoubleCodedReviewCoderResultDto, 'codingIssueOption'> {
  codingIssueOption?: number | null;
  currentSelectionMatch?: boolean;
}

export interface DoubleCodedItem extends Omit<DoubleCodedReviewItemDto, 'coderResults'> {
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
