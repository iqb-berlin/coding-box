export interface TrainingComparison {
  responseId: number;
  unitName: string;
  variableId: string;
  personCode: string;
  personLogin: string;
  personGroup: string;
  bookletName?: string;
  testPerson: string;
  givenAnswer?: string;
  coders: Array<{
    trainingId: number;
    trainingLabel: string;
    coderId: number;
    coderName: string;
    code: string | null;
    score: number | null;
    notes?: string | null;
    codingIssueOption?: number | null;
  }>;
}

export interface WithinTrainingComparison {
  responseId: number;
  unitName: string;
  variableId: string;
  testperson?: string;
  personLogin?: string;
  personCode?: string;
  personGroup?: string;
  bookletName?: string;
  givenAnswer?: string;
  replayCode?: number | null;
  replayScore?: number | null;
  discussionCode?: number | null;
  discussionScore?: number | null;
  discussionNotes?: string | null;
  discussionManagerUserId?: number | null;
  discussionManagerName?: string | null;
  discussionSource?: 'manual' | 'auto_agreement' | null;
  modalValueDisplay?: ModalValueDisplay;
  coders: Array<{
    jobId: number;
    coderName: string;
    code: string | null;
    score: number | null;
    notes?: string | null;
    codingIssueOption?: number | null;
  }>;
}

export type NotesFilterMode = 'all' | 'none' | 'with-notes';
export type ComparisonStatus = 'match' | 'differ' | 'incomplete' | 'not_comparable';
export type ComparisonCoderResult = TrainingComparison['coders'][number] | WithinTrainingComparison['coders'][number];

export interface ModalValueDisplay {
  valueText: string;
  deviationText: string;
  tooltip: string;
}
