import type {
  VariableAnalysisResultDto, VariableAnalysisResultPageDto
} from '../../../shared/services/response/variable-analysis.service';
import type { VariableAnalysisJobDto } from '../../../models/variable-analysis-job.dto';

export interface VariableAnalysisData {
  unitId: number;
  title: string;
  workspaceId: number;
  responses?: {
    id: number;
    unitid: number;
    variableid: string;
    status: string;
    value: string;
    subform: string;
    code?: number;
    score?: number;
    codedstatus?: string;
    expanded?: boolean;
  }[];
  analysisResults?: VariableAnalysisResultDto & Partial<VariableAnalysisResultPageDto>;
  jobs?: VariableAnalysisJobDto[];
}
