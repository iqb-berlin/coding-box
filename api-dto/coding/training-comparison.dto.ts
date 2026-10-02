export type TrainingComparisonSortBy =
  | 'responseId'
  | 'unitName'
  | 'variableId'
  | 'personLogin'
  | 'personGroup'
  | 'bookletName';

export type TrainingComparisonSortDirection = 'asc' | 'desc';
export type TrainingComparisonMatchFilter = 'all' | 'match' | 'differ';
export type TrainingComparisonNotesFilter = 'all' | 'none' | 'with-notes';

export interface TrainingComparisonFiltersDto {
  unitName?: string;
  variableId?: string;
  personLogin?: string;
  personGroup?: string;
  bookletName?: string;
  match?: TrainingComparisonMatchFilter;
  notesMode?: TrainingComparisonNotesFilter;
  regexSearch?: boolean;
}

export interface TrainingComparisonSummaryDto {
  visibleRows: number;
  comparableRows: number;
  matchingRows: number;
  matchingPercentage: number;
  incompleteRows: number;
  notComparableRows: number;
  deviationRows: number;
  completionRate: number;
}

export interface TrainingComparisonCoderDto {
  trainingId: number;
  trainingLabel: string;
  coderId: number;
  coderName: string;
}

export interface WithinTrainingComparisonCoderDto {
  jobId: number;
  coderName: string;
}

export interface TrainingComparisonCoderResultDto extends TrainingComparisonCoderDto {
  code: string | null;
  score: number | null;
  notes: string | null;
  codingIssueOption: number | null;
}

export interface WithinTrainingComparisonCoderResultDto extends WithinTrainingComparisonCoderDto {
  code: string | null;
  score: number | null;
  notes: string | null;
  codingIssueOption: number | null;
}

export interface TrainingCodingComparisonRowDto {
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletName: string;
  testPerson: string;
  coders: TrainingComparisonCoderResultDto[];
}

export interface WithinTrainingCodingComparisonRowDto {
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletName: string;
  testPerson: string;
  givenAnswer: string;
  replayCode: number | null;
  replayScore: number | null;
  discussionCode: number | null;
  discussionScore: number | null;
  discussionNotes: string | null;
  discussionManagerUserId: number | null;
  discussionManagerName: string | null;
  discussionSource: 'manual' | 'auto_agreement' | null;
  coders: WithinTrainingComparisonCoderResultDto[];
}

export interface TrainingComparisonPageDto<TData, TCoder> {
  data: TData[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: TrainingComparisonSummaryDto;
  availableCoders: TCoder[];
}

export type TrainingCodingComparisonPageDto = TrainingComparisonPageDto<
TrainingCodingComparisonRowDto,
TrainingComparisonCoderDto
>;

export type WithinTrainingCodingComparisonPageDto = TrainingComparisonPageDto<
WithinTrainingCodingComparisonRowDto,
WithinTrainingComparisonCoderDto
>;
