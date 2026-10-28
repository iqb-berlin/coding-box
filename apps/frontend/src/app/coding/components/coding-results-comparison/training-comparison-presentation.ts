import type {
  ComparisonStatus, ComparisonCoderResult,
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

export interface ModalValueSummary {
  modalValue: string | null;
  deviationCount: number | null;
  validCount: number;
  isTie: boolean;
}

function sortCodeValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const aNumber = Number(a);
    const bNumber = Number(b);
    const bothNumeric = Number.isFinite(aNumber) && Number.isFinite(bNumber);
    return bothNumeric ? aNumber - bNumber : a.localeCompare(b);
  });
}

export function modalValueSummary(coders: readonly ComparisonCoderResult[]): ModalValueSummary {
  const values = coders
    .map(coder => coder.code)
    .filter((code): code is string => code !== null);

  if (values.length === 0) {
    return {
      modalValue: null,
      deviationCount: null,
      validCount: 0,
      isTie: false
    };
  }

  const counts = new Map<string, number>();
  values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));

  const maxCount = Math.max(...counts.values());
  const modalCandidates = sortCodeValues(
    Array.from(counts.entries())
      .filter(([, count]) => count === maxCount)
      .map(([value]) => value)
  );
  const modalValue = modalCandidates[0] ?? null;

  return {
    modalValue,
    deviationCount: modalValue === null ? null : values.length - maxCount,
    validCount: values.length,
    isTie: modalCandidates.length > 1
  };
}
