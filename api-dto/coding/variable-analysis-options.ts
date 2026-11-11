export type VariableAnalysisMode = 'values' | 'codes';
export type VariableAnalysisCodingVersion = 'v1' | 'v2' | 'v3';

export interface VariableAnalysisOptions {
  analysisMode?: VariableAnalysisMode;
  codingVersion?: VariableAnalysisCodingVersion;
}
