import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingCoder } from '../../entities/coder-training-coder.entity';
import { JobDefinitionVariable, JobDefinitionVariableBundle } from '../../entities/job-definition.entity';

export function toTrainingVariable(trainingId: number, variable: JobDefinitionVariable): CoderTrainingVariable {
  return Object.assign(new CoderTrainingVariable(), {
    coder_training_id: trainingId,
    variable_id: variable.variableId,
    unit_name: variable.unitName,
    sample_count: variable.sampleCount || 10,
    include_derive_error: variable.includeDeriveError === true
  });
}

export function toTrainingBundle(trainingId: number, bundle: JobDefinitionVariableBundle): CoderTrainingBundle {
  return Object.assign(new CoderTrainingBundle(), {
    coder_training_id: trainingId,
    variable_bundle_id: bundle.id,
    sample_count: bundle.sampleCount || 10,
    case_ordering_mode: bundle.caseOrderingMode || null
  });
}

export function toTrainingCoder(trainingId: number, coder: { id: number }): CoderTrainingCoder {
  return Object.assign(new CoderTrainingCoder(), { coder_training_id: trainingId, user_id: coder.id });
}
