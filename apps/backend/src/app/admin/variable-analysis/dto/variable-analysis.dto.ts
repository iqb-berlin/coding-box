import { VariableFrequencyDto } from './variable-frequency.dto';

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
