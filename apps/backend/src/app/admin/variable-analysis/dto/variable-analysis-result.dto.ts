import { VariableAnalysisOptions } from '../../../../../../../api-dto/coding/variable-analysis-options';
import { VariableFrequencyDto } from './variable-frequency.dto';

export interface VariableCombo extends VariableAnalysisOptions {
  unitId: number;
  unitName: string;
  variableId: string;
  sourceVariableId?: string;
  variableAlias?: string;
  selectionSource?: string;
  sourceType?: string;
  isDerived?: boolean;
  hasCodingScheme?: boolean;
  totalCount?: number;
  validCount?: number;
  invalidCount?: number;
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
