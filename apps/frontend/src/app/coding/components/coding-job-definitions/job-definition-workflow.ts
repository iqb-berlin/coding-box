import { JobDefinitionDistributionSnapshot } from '../../services/coding-job-backend.service';
import { Variable, VariableBundle } from '../../models/coding-job.model';

import { getJobDefinitionDisplayLabel } from '../../utils/job-definition-display.util';
import { UiTranslator } from '../../../shared/utils/ui-translator';

export interface JobDefinition {
  creatorUserId?: number | null;
  id?: number;
  name?: string;
  description?: string | null;
  status?: 'draft' | 'pending_review' | 'approved';
  assignedVariables?: Variable[];
  assignedVariableBundles?: VariableBundle[];
  assignedCoders?: number[];
  assignedCoderConfigs?: { coderId: number; capacityPercent: number }[];
  distributionSnapshots?: JobDefinitionDistributionSnapshot[];
  missingsProfileId?: number | null;
  distributionSeed?: string;
  plannedVariableUsage?: Record<string, number>;
  durationSeconds?: number;
  maxCodingCases?: number | null;
  doubleCodingAbsolute?: number;
  doubleCodingPercentage?: number;
  caseOrderingMode?: 'continuous' | 'alternating';
  showScore?: boolean;
  allowComments?: boolean;
  suppressGeneralInstructions?: boolean;
  createdJobsCount?: number;
  blockingCreatedJobsCount?: number;
  created_at?: Date;
  updated_at?: Date;
}

export function createdDefinitionJobCount(definition: JobDefinition): number | undefined {
  const count = definition.createdJobsCount;

  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return undefined;
  }

  return Math.max(0, count);
}

export function blockingDefinitionJobCount(definition: JobDefinition): number | undefined {
  const count = definition.blockingCreatedJobsCount;

  if (typeof count !== 'number' || !Number.isFinite(count)) {
    return undefined;
  }

  return Math.max(0, count);
}

export function definitionWorkflowLabel(definition: JobDefinition, translate: UiTranslator): string {
  const createdJobsCount = createdDefinitionJobCount(definition);
  const label = getJobDefinitionDisplayLabel(definition);

  if (!definition.id) {
    return translate(
      'coding-job-definitions.workflow.definition'
    );
  }

  if (createdJobsCount === undefined) {
    return translate(
      'coding-job-definitions.workflow.jobs-count-unavailable',
      { label }
    );
  }

  if (createdJobsCount === 0) {
    return translate(
      'coding-job-definitions.workflow.no-jobs',
      { label }
    );
  }

  if (createdJobsCount === 1) {
    return translate(
      'coding-job-definitions.workflow.one-job',
      { label }
    );
  }

  return translate(
    'coding-job-definitions.workflow.many-jobs',
    { label, count: createdJobsCount }
  );
}
