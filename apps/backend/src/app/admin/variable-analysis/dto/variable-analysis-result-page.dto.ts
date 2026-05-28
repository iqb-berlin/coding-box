import { VariableFrequencyDto } from './variable-frequency.dto';
import { VariableCombo } from './variable-analysis-result.dto';
import { VariableAnalysisTableRowDto } from './variable-analysis-table-row.dto';

export class VariableAnalysisResultPageDto {
  variableCombos: VariableCombo[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
  unfilteredTotal: number;
  rows?: VariableAnalysisTableRowDto[];
  rowTotal?: number;
  pageableRowTotal?: number;
  unfilteredRowTotal?: number;
  maxPage?: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
