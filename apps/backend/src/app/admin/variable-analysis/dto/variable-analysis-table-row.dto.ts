import { VariableStatusCountDto } from './variable-analysis-result.dto';

export class VariableAnalysisTableRowDto {
  unitId: number;
  unitName: string;
  variableId: string;
  sourceVariableId?: string;
  variableAlias?: string;
  selectionSource?: string;
  sourceType?: string;
  isDerived?: boolean;
  hasCodingScheme?: boolean;
  value: string;
  label?: string;
  score?: number;
  schemaOrder?: number;
  isSchemaOnly?: boolean;
  isSchemaSupplemental?: boolean;
  count: number;
  percentage: number;
  totalCount: number;
  emptyCount: number;
  emptyPercentage: number;
  distinctValueCount: number;
  hiddenValueCount: number;
  statusCounts?: VariableStatusCountDto[];
  statusSummary: string;
  pointBiserial?: number | null;
  codePbc?: number | null;
  categoryPbc?: number | null;
}
