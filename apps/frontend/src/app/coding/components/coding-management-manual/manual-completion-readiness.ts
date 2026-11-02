import { UiTranslator } from '../../../shared/utils/ui-translator';

export interface CompletionReadiness { complete: boolean; readyJobs: number; reviewJobs: number; executionOpen: boolean; }

export function completionReadinessTitle(state: CompletionReadiness, translate: UiTranslator): string {
  if (state.complete) {
    return translate('ui-text.coding-management-manual.alle-ergebnisse-sind-uebernommen');
  }

  if (state.readyJobs > 0) {
    if (state.reviewJobs > 0) {
      return translate('ui-text.coding-management-manual.abgeschlossene-kodierjob-s-bereit-zum-anwenden-mit-offenen-hinweisen', { value1: state.readyJobs, value2: state.reviewJobs });
    }
    return translate('ui-text.coding-management-manual.abgeschlossene-kodierjob-s-bereit-zum-anwenden', { value1: state.readyJobs });
  }

  if (state.reviewJobs > 0) {
    return translate('ui-text.coding-management-manual.abgeschlossene-kodierjob-s-benoetigen-review', { value1: state.reviewJobs });
  }

  if (state.executionOpen) {
    return translate('ui-text.coding-management-manual.noch-nicht-alle-kodierfaelle-sind-abgeschlossen');
  }

  return translate('ui-text.coding-management-manual.keine-uebernahmebereiten-kodierjobs-gefunden');
}
