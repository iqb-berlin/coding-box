import { VariableFrequencyDto } from './variable-frequency.dto';
import { VariableCombo } from './variable-analysis-result.dto';

export class VariableAnalysisResultPageDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
  unfilteredTotal: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
