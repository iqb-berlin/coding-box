import { VariableFrequencyDto } from './variable-frequency.dto';

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
  totalCount?: number;
  emptyCount?: number;
  emptyPercentage?: number;
  distinctValueCount?: number;
  statusCounts?: VariableStatusCountDto[];
}

export interface VariableStatusCountDto {
  status: number;
  count: number;
  percentage: number;
}

export class VariableAnalysisResultDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
