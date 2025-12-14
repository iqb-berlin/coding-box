import { VariableFrequencyDto } from './variable-frequency.dto';

/**
 * DTO for variable analysis result
 */
export class VariableAnalysisResultDto {
  /**
   * Map of combo key to frequency data
   */
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
