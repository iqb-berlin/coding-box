import { VariableFrequencyDto } from './variable-frequency.dto';

export interface VariableStatusCountDto {
  status: number;
  count: number;
  percentage: number;
}

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
  totalCount?: number;
  emptyCount?: number;
  emptyPercentage?: number;
  statusCounts?: VariableStatusCountDto[];
}

/**
 * DTO for variable analysis result
 */
export class VariableAnalysisResultDto {
  variableCombos?: VariableCombo[];

  /**
   * Map of combo key to frequency data
   */
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
