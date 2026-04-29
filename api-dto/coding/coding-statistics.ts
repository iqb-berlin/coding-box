export interface CodingStatistics {
  totalResponses: number;
  baseResponseCount?: number;
  derivedResponseCount?: number;
  derivedVariableCount?: number;
  derivedStatusCounts?: {
    [key: string]: number;
  };
  statusCounts: {
    [key: string]: number;
  };
}
