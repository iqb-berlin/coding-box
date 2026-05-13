import { CoderTraining } from '../models/coder-training.model';

export function normalizeTrainingLabel(label: string | null | undefined): string {
  return (label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getDuplicateTrainingLabelMatches(
  trainings: CoderTraining[],
  label: string | null | undefined,
  currentTrainingId?: number
): CoderTraining[] {
  const normalizedLabel = normalizeTrainingLabel(label);
  if (!normalizedLabel) {
    return [];
  }

  return trainings.filter(training => (
    normalizeTrainingLabel(training.label) === normalizedLabel &&
    training.id !== currentTrainingId
  ));
}

export function getTrainingCreatedAtLabel(training: Pick<CoderTraining, 'created_at'>): string {
  const date = training.created_at ? new Date(training.created_at) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return 'Datum unbekannt';
  }

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function getTrainingJobsLabel(
  training: Pick<CoderTraining, 'jobsCount'>,
  singular = 'Job',
  plural = 'Jobs'
): string {
  return `${training.jobsCount} ${training.jobsCount === 1 ? singular : plural}`;
}

export function getTrainingOptionTitle(training: Pick<CoderTraining, 'id' | 'label'>): string {
  return `${training.label} · ID ${training.id}`;
}

export function getTrainingOptionMeta(
  training: Pick<CoderTraining, 'created_at' | 'jobsCount'>,
  singular = 'Job',
  plural = 'Jobs'
): string {
  return `${getTrainingCreatedAtLabel(training)} · ${getTrainingJobsLabel(training, singular, plural)}`;
}
