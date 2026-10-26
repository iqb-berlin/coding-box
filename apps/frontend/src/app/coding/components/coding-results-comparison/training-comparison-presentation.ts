import type {
  ComparisonStatus,
  TrainingComparison, WithinTrainingComparison
} from './comparison-view.models';

export interface SelectedCodeSlot { code: string | null; hasEntry: boolean; trainingId?: number; }

export interface ComparisonSelection {
  mode: 'between-trainings' | 'within-training';
  trainingIds: readonly number[];
  coderKeys: readonly string[];
  jobIds: readonly number[];
}

/** Match each selected source, including sources with no result for this row. */
export function selectedCodeSlots(
  row: TrainingComparison | WithinTrainingComparison,
  selection: ComparisonSelection
): SelectedCodeSlot[] {
  if (selection.mode === 'within-training') {
    const coders = new Map((row as WithinTrainingComparison).coders.map(coder => [coder.jobId, coder]));
    return selection.jobIds.map(id => ({ code: coders.get(id)?.code ?? null, hasEntry: coders.has(id) }));
  }
  const coders = new Map((row as TrainingComparison).coders.map(coder => [`${coder.trainingId}_${coder.coderId}`, coder]));
  const slots = selection.coderKeys.map(key => ({
    code: coders.get(key)?.code ?? null,
    hasEntry: coders.has(key),
    trainingId: Number(key.split('_')[0])
  }));
  const representedTrainings = new Set(slots.map(slot => slot.trainingId));
  selection.trainingIds.forEach(trainingId => {
    if (!representedTrainings.has(trainingId)) slots.push({ code: null, hasEntry: false, trainingId });
  });
  return slots;
}

export function comparisonStatus(slots: readonly SelectedCodeSlot[]): ComparisonStatus {
  if (slots.length < 2) return 'not_comparable';
  if (slots.some(slot => !slot.hasEntry || slot.code === null)) return 'incomplete';
  return slots.every(slot => slot.code === slots[0].code) ? 'match' : 'differ';
}

const statusIcons: Record<ComparisonStatus, string> = {
  match: 'check_circle', differ: 'cancel', incomplete: 'warning', not_comparable: 'remove_circle_outline'
};

export function comparisonPresentation(
  row: TrainingComparison | WithinTrainingComparison,
  selection: ComparisonSelection
) {
  const status = comparisonStatus(selectedCodeSlots(row, selection));
  return { status, icon: statusIcons[status], tooltipKey: `coding.trainings.compare.status-${status}` };
}
