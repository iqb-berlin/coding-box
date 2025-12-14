import { VariableFrequencyDto } from './variable-frequency.dto';

export interface VariableCombo {
  unitId: number;
  unitName: string;
  variableId: string;
}

export class VariableAnalysisResultDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
