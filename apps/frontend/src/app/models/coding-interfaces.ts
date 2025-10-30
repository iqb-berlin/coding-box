export interface CodingScheme {
  variableCodings: VariableCoding[];
  version: string;
}

export interface VariableCoding {
  id: string;
  alias: string;
  label: string;
  sourceType: string;
  processing: string[];
  codeModel: string;
  codes: Code[];
  manualInstruction: string;
}

export interface Code {
  id: number;
  type: 'FULL_CREDIT' | 'RESIDUAL';
  label: string;
  score: number;
  ruleSetOperatorAnd: boolean;
  ruleSets: RuleSet[];
  manualInstruction: string;
}

export interface RuleSet {
  ruleOperatorAnd: boolean;
  rules: Rule[];
}

export interface Rule {
  method: string;
  parameters: string[];
}

export interface UncertainDto {
  id: string;
  label: string;
  description: string;
  code: number;
}

export interface CodeSelectedEvent {
  variableId: string;
  code: Code | UncertainDto | null;
}

export interface SelectableItem {
  id: number;
  label: string;
  type: string;
  score?: number;
  manualInstruction?: string;
  description?: string;
  originalCode?: Code;
}
