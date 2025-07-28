import { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';

export interface UnitScheme {
  scheme: string;
  schemeType: string;
  variables?: VariableInfo[];
}
