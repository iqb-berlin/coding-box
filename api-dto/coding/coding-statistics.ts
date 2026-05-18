export interface CodingStatistics {
  /**
   * Count of coding-relevant responses only. Raw response states
   * (UNSET, NOT_REACHED, DISPLAYED, VALUE_CHANGED, PARTLY_DISPLAYED)
   * are excluded from the statistic contract.
   */
  totalResponses: number;
  /**
   * Non-generated responses within totalResponses.
   */
  baseResponseCount?: number;
  /**
   * Autocoder-generated/derived responses within totalResponses.
   */
  derivedResponseCount?: number;
  /**
   * Currently defined derived variables, not generated response rows.
   */
  derivedVariableCount?: number;
  derivedStatusCounts?: {
    [key: string]: number;
  };
  statusCounts: {
    [key: string]: number;
  };
}
