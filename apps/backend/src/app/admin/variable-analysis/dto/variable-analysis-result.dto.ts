import { VariableFrequencyDto } from './variable-frequency.dto';

export interface VariableCombo {
  unitName: string;
  variableId: string;
}

export class VariableAnalysisResultDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
