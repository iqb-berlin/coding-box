import { VariableFrequencyDto } from './variable-frequency.dto';

export class VariableAnalysisResultDto {
  variables: string[];
  frequencies: { [key: string]: VariableFrequencyDto[] };
  total: number;
}
