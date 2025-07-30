export interface VariableAnalysisItemDto {
  // Link to the replay of unit with its responses
  replayUrl: string;

  // Unit ID
  unitId: string;

  // Variable ID
  variableId: string;

  // Derivation
  derivation: string;

  // Code
  code: string;

  // Description
  description: string;

  // Score
  score: number;

  // How often this unitId in combination with variableId with that code is in responses
  occurrenceCount: number;

  // Total amount of that combination variableId and unit Id
  totalCount: number;

  // Relative occurrence (for bar chart)
  relativeOccurrence: number;
}
