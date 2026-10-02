import type { CodingSchemeProblem } from '@iqb/responses/coding-interfaces';
import type { VariableCodingData } from '@iqbspecs/coding-scheme';
import type { VariableInfo } from '@iqbspecs/variable-info/variable-info.interface';
import { AutocoderSchemaValidationMode } from '../../../config/runtime-config.service';

export type AutocoderSchemaValidationResult = {
  blockingProblems: CodingSchemeProblem[];
  toleratedProblems: CodingSchemeProblem[];
};

function isCompatibleLegacyBaseProblem(
  problem: CodingSchemeProblem,
  baseVariables: VariableInfo[],
  variableCodings: VariableCodingData[]
): boolean {
  if (!['INVALID_SOURCE', 'SOURCE_MISSING'].includes(problem.type)) {
    return false;
  }

  const matchingCodings = variableCodings.filter(
    coding => coding.id === problem.variableId
  );
  if (matchingCodings.length !== 1) {
    return false;
  }

  const coding = matchingCodings[0];
  if (!['BASE', 'BASE_NO_VALUE'].includes(coding.sourceType)) {
    return false;
  }

  const matchingBaseVariables = baseVariables.filter(
    variable => variable.id === coding.id
  );
  if (problem.type === 'SOURCE_MISSING') {
    return coding.sourceType === 'BASE_NO_VALUE' &&
      matchingBaseVariables.length === 0;
  }

  if (matchingBaseVariables.length !== 1) {
    return false;
  }

  return coding.sourceType === 'BASE' ?
    matchingBaseVariables[0].type === 'no-value' :
    matchingBaseVariables[0].type !== 'no-value';
}

export function applyAutocoderSchemaValidationMode(
  problems: CodingSchemeProblem[],
  mode: AutocoderSchemaValidationMode,
  baseVariables: VariableInfo[],
  variableCodings: VariableCodingData[]
): AutocoderSchemaValidationResult {
  const breakingProblems = problems.filter(problem => problem.breaking);

  if (mode === 'strict') {
    return {
      blockingProblems: breakingProblems,
      toleratedProblems: []
    };
  }

  const toleratedProblems = breakingProblems.filter(
    problem => isCompatibleLegacyBaseProblem(
      problem,
      baseVariables,
      variableCodings
    )
  );
  const toleratedProblemSet = new Set(toleratedProblems);

  return {
    blockingProblems: breakingProblems.filter(
      problem => !toleratedProblemSet.has(problem)
    ),
    toleratedProblems
  };
}
