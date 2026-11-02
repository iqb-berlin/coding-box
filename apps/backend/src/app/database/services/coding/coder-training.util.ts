import { CoderTrainingBundle } from '../../entities/coder-training-bundle.entity';
import { CoderTrainingVariable } from '../../entities/coder-training-variable.entity';
import { CodingJob } from '../../entities/coding-job.entity';

export function getWithinTrainingComparisonSelectedJobIds(
  selectedJobIds: number[] | undefined,
  jobs: Array<Pick<CodingJob, 'id'>>
): number[] {
  const availableJobIds = new Set(jobs.map(job => job.id));
  const requestedJobIds = selectedJobIds ?? jobs.map(job => job.id);
  return [...new Set(requestedJobIds.filter(jobId => availableJobIds.has(jobId)))];
}

export function getTrainingJobCoderName(job: Pick<CodingJob, 'id' | 'name'> & {
  codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
}): string {
  return job.codingJobCoders?.[0]?.user?.username || `Job ${job.id}`;
}

export function getWithinTrainingJobCoderName(job: Pick<CodingJob, 'id' | 'name'> & {
  codingJobCoders?: Array<{ user?: { username?: string | null } | null }> | null;
}): string {
  return job.codingJobCoders?.[0]?.user?.username || `Coder ${job.name}`;
}

export function toFreshnessNumber(value: number | string | null | undefined): number {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

export function makeTrainingVariableKey(unitName: string, variableId: string): string {
  return `${unitName}::${variableId}`;
}

export function getBundleVariableKeys(bundles: CoderTrainingBundle[] = []): Set<string> {
  return new Set(
    bundles.flatMap(bundle => bundle.bundle?.variables || [])
      .map(variable => makeTrainingVariableKey(variable.unitName, variable.variableId))
  );
}

export function getTrainingVariablesByKey(
  variables: CoderTrainingVariable[] = []
): Map<string, CoderTrainingVariable> {
  return new Map(variables.map(variable => [
    makeTrainingVariableKey(variable.unit_name, variable.variable_id),
    variable
  ]));
}
