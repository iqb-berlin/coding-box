/**
 * DTO for variable frequency data
 */
export class VariableFrequencyDto {
  /**
   * The ID of the variable
   */
  variableId: string;

  /**
   * The value of the variable
   */
  value: string;

  /**
   * The count of occurrences of this value
   */
  count: number;

  /**
   * The percentage of occurrences of this value
   */
  percentage: number;
}

/**
 * DTO for variable analysis result
 */
export class VariableAnalysisResultDto {
  /**
   * List of variable IDs
   */
  variables: string[];

  /**
   * Map of variable ID to frequency data
   */
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
