import { UiTranslator } from '../../../shared/utils/ui-translator';
import type { ManualCodingPlanningSnapshot } from '../../services/manual-coding-planning-snapshot.model';

export type PlanningStatusState =
  'not-checked' |
  'loading' |
  'planning-data-required' |
  'preparation-required' |
  'warning' |
  'planning-incomplete' |
  'planning-ready' |
  'training-ready' |
  'execution-ready' |
  'double-coding-review-ready' |
  'stale-source-review' |
  'completion-ready' |
  'progress-unavailable' |
  'complete';

export type ManualCodingTab = 'preparation' | 'planning' | 'training' | 'execution' | 'completion';

export interface ManualFreshnessTarget {
  tab: ManualCodingTab;
  sectionId: string;
  action: 'navigate' | 'double-coding-review';
}

export interface ManualCodingPlanningState {
  hasVariableCoverageConflicts: boolean;
  hasManualCodeAvailabilityWarnings: boolean;
  activeManualTab: ManualCodingTab;
  hasLoadedPlanningDataBundle: boolean;
  isPlanningStatusLoading: boolean;
  shouldRequirePlanningDataRefresh: boolean;
  hasPreparationRefreshTarget: boolean;
  variableCoverageOverview: ManualCodingPlanningSnapshot['variableCoverageOverview'];
  caseCoverageOverview: ManualCodingPlanningSnapshot['caseCoverageOverview'];
  isPlanningReady: boolean;
  hasActiveTrainingCodingJobs: boolean;
  codingProgressOverview: ManualCodingPlanningSnapshot['codingProgressOverview'];
  hasExecutionOpenWorkForFreshness: boolean;
  hasOpenDoubleCodingReviewConflicts: boolean;
  hasStaleSourceManualJobs: boolean;
  isCompletionComplete: boolean;
  appliedResultsOverview: ManualCodingPlanningSnapshot['appliedResultsOverview'];
  hasCompletionReadyWorkForFreshness: boolean;
  canShowManualCompletionTab: boolean;
  isResponseAnalysisOutdated: boolean;
  manualCodeAvailabilityWarningCount: number;
  manualFreshnessJobSummary: ManualCodingPlanningSnapshot['manualFreshnessJobSummary'];
  openDoubleCodingConflictCount: number;
  getAvailableCasesForNewJobs: number;
  getUnavailableCasesForNewJobs: number;
}

/** Pure planning decisions and their presentation, independent of requests and Angular. */
export class ManualCodingPlanning {
  constructor(private readonly state: ManualCodingPlanningState, private readonly translate: UiTranslator) {}

  getPlanningStatusClass(): string {
    switch (this.getPlanningStatusState()) {
      case 'warning':
        if (this.state.hasVariableCoverageConflicts) {
          return 'status-warning';
        }
        if (this.state.hasManualCodeAvailabilityWarnings) {
          return 'status-attention';
        }
        return 'status-warning';
      case 'planning-incomplete':
      case 'preparation-required':
      case 'double-coding-review-ready':
      case 'stale-source-review':
      case 'completion-ready':
      case 'progress-unavailable':
        return 'status-attention';
      case 'complete':
        return 'status-complete';
      case 'not-checked':
      case 'loading':
      case 'planning-data-required':
      case 'planning-ready':
      case 'training-ready':
      case 'execution-ready':
      default:
        return 'status-ready';
    }
  }

  getPlanningStatusState(): PlanningStatusState {
    if (this.state.activeManualTab !== 'planning' &&
      !this.state.hasLoadedPlanningDataBundle) {
      return 'not-checked';
    }

    if (this.state.isPlanningStatusLoading) {
      return 'loading';
    }

    if (this.state.shouldRequirePlanningDataRefresh) {
      return 'planning-data-required';
    }

    if (this.state.hasPreparationRefreshTarget) {
      return 'preparation-required';
    }

    if (this.state.hasManualCodeAvailabilityWarnings) {
      return 'warning';
    }

    if (this.state.hasVariableCoverageConflicts) {
      return 'warning';
    }

    if ((this.state.variableCoverageOverview?.missingVariables || 0) > 0 ||
        (this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return 'planning-incomplete';
    }

    if (this.state.isPlanningReady && this.state.hasActiveTrainingCodingJobs) {
      return 'training-ready';
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        this.state.hasExecutionOpenWorkForFreshness) {
      return 'execution-ready';
    }

    if (this.state.isPlanningReady && this.state.hasOpenDoubleCodingReviewConflicts) {
      return 'double-coding-review-ready';
    }

    if (this.state.isPlanningReady && this.state.hasStaleSourceManualJobs) {
      return 'stale-source-review';
    }

    if (this.state.isCompletionComplete) {
      return 'complete';
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        !!this.state.appliedResultsOverview &&
        this.state.hasCompletionReadyWorkForFreshness) {
      return 'completion-ready';
    }

    if (this.state.isPlanningReady && !this.state.codingProgressOverview) {
      return 'progress-unavailable';
    }

    return 'planning-ready';
  }

  getPlanningStatusIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'help_outline';
      case 'loading':
        return 'sync';
      case 'planning-data-required':
        return 'refresh';
      case 'warning':
        return 'warning';
      case 'preparation-required':
        return 'tune';
      case 'planning-incomplete':
        return 'assignment_late';
      case 'training-ready':
        return 'school';
      case 'execution-ready':
        return 'play_circle';
      case 'double-coding-review-ready':
        return 'compare';
      case 'stale-source-review':
        return 'sync_problem';
      case 'completion-ready':
        return 'published_with_changes';
      case 'progress-unavailable':
        return 'sync_problem';
      case 'complete':
        return 'check_circle';
      default:
        return 'route';
    }
  }

  getPlanningStatusTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('ui-text.manual-coding-planning.kodierstand-nicht-geprueft');
      case 'loading':
        return this.translate('ui-text.manual-coding-planning.status-wird-aktualisiert');
      case 'planning-data-required':
        return this.translate('coding-management-manual.buttons.refresh-planning-aria');
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          this.translate('ui-text.manual-coding-planning.konflikte-pruefen') :
          this.translate('ui-text.manual-coding-planning.regulaere-codes-fuer-manuelle-kodierung-pruefen');
      case 'preparation-required':
        return this.translate('ui-text.manual-coding-planning.vorbereitung-aktualisieren');
      case 'planning-incomplete':
        return this.translate('ui-text.manual-coding-planning.planung-noch-unvollstaendig');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.schulungskodierjobs-aktiv');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-planning.bereit-fuer-die-durchfuehrung');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.doppelkodierungsreview-offen');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.veraltete-kodierjobs-pruefen');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          this.translate('ui-text.manual-coding-planning.bereit-fuer-den-abschluss') :
          this.translate('ui-text.manual-coding-planning.kodierfaelle-abgeschlossen');
      case 'progress-unavailable':
        return this.translate('ui-text.manual-coding-planning.kodierfortschritt-nicht-verfuegbar');
      case 'complete':
        return this.translate('ui-text.manual-coding-planning.manuelle-kodierung-abgeschlossen');
      default:
        return this.translate('ui-text.manual-coding-planning.bereit-fuer-die-planung');
    }
  }

  getPlanningStatusDescription(): string {
    const planningStatusState = this.getPlanningStatusState();

    if (planningStatusState === 'not-checked') {
      return this.translate('ui-text.manual-coding-planning.oeffnen-oder-aktualisieren-sie-die-planung-um-den-aktuellen-kodierstand-zu-pruef');
    }

    if (planningStatusState === 'loading') {
      return this.translate('ui-text.manual-coding-planning.die-planungs-und-kodierfortschritte-werden-geladen');
    }

    if (planningStatusState === 'planning-data-required') {
      return this.translate('ui-text.manual-coding-planning.abdeckung-kodierfortschritt-und-freshness-hinweise-werden-erst-auf-anforderung-g');
    }

    if (planningStatusState === 'progress-unavailable') {
      return this.translate('ui-text.manual-coding-planning.die-planung-ist-vollstaendig-der-aktuelle-kodierfortschritt-konnte-aber-nicht-er');
    }

    if (planningStatusState === 'preparation-required') {
      if (this.state.isResponseAnalysisOutdated) {
        return this.translate('ui-text.manual-coding-planning.die-antwortanalyse-oder-aggregationsgrundlage-ist-nicht-mehr-aktuell-aktualisier');
      }
      return this.translate('ui-text.manual-coding-planning.in-der-vorbereitung-gibt-es-offene-punkte-die-vor-der-weiteren-manuellen-kodieru');
    }

    if (this.state.hasVariableCoverageConflicts) {
      return this.translate('ui-text.manual-coding-planning.value1-variablenkonflikte-muessen-vor-der-verlaesslichen-jobplanung-geklaert-wer', { value1: this.state.variableCoverageOverview?.conflictedVariables || 0 });
    }

    if (this.state.hasManualCodeAvailabilityWarnings) {
      return this.translate('ui-text.manual-coding-planning.value1-variablen-haben-keine-regulaeren-codes-mit-manueller-instruktion-kodierer', { value1: this.state.manualCodeAvailabilityWarningCount });
    }

    if ((this.state.variableCoverageOverview?.missingVariables || 0) > 0) {
      return this.translate('ui-text.manual-coding-planning.value1-variablen-sind-noch-keiner-jobdefinition-zugeordnet', { value1: this.state.variableCoverageOverview?.missingVariables || 0 });
    }

    if ((this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return this.translate('ui-text.manual-coding-planning.value1-faelle-sind-noch-nicht-in-kodierjobs-verteilt', { value1: this.state.caseCoverageOverview?.effectiveUnassignedCases || 0 });
    }

    if (this.state.isCompletionComplete) {
      return this.translate('ui-text.manual-coding-planning.alle-manuellen-kodierungen-sind-abgeschlossen-und-final-uebernommen');
    }

    if (this.state.isPlanningReady &&
        this.state.hasActiveTrainingCodingJobs) {
      return this.translate('ui-text.manual-coding-planning.value1-aktive-schulungskodierjob-s-sollten-vor-der-produktiven-durchfuehrung-gep', { value1: this.state.manualFreshnessJobSummary?.activeTrainingJobs || 0 });
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        this.state.hasExecutionOpenWorkForFreshness) {
      return this.translate('ui-text.manual-coding-planning.die-planung-ist-vollstaendig-bearbeiten-sie-nun-die-offenen-kodierfaelle-im-absc');
    }

    if (this.state.isPlanningReady && this.state.hasOpenDoubleCodingReviewConflicts) {
      return this.translate('ui-text.manual-coding-planning.value1-offene-doppelkodierungs-konflikt-e-muessen-im-review-aufgeloest-werden', { value1: this.state.openDoubleCodingConflictCount });
    }

    if (this.state.isPlanningReady && this.state.hasStaleSourceManualJobs) {
      return this.translate('ui-text.manual-coding-planning.value1-kodierjob-s-enthalten-veraltete-quellfaelle-pruefen-sie-diese-jobs-in-der', { value1: this.state.manualFreshnessJobSummary?.staleSourceJobs || 0 });
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        !!this.state.appliedResultsOverview &&
        this.state.hasCompletionReadyWorkForFreshness) {
      return this.state.canShowManualCompletionTab ?
        this.translate('ui-text.manual-coding-planning.alle-kodierfaelle-sind-abgeschlossen-uebernehmen-sie-nun-die-kodierergebnisse-in') :
        this.translate('ui-text.manual-coding-planning.alle-kodierfaelle-sind-abgeschlossen-die-uebernahme-der-ergebnisse-in-den-datenb');
    }

    return this.translate('ui-text.manual-coding-planning.pruefen-sie-die-antwortanalyse-und-erstellen-sie-danach-passende-kodierjob-defin');
  }

  getPlanningNextStepTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('coding.schemer.check-coding-status');
      case 'loading':
        return this.translate('ui-text.manual-coding-planning.planungsstand-wird-geladen');
      case 'planning-data-required':
        return this.translate('ui-text.manual-coding-planning.planungsstand-laden');
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          this.translate('ui-text.manual-coding-planning.konflikte-zuerst-klaeren') :
          this.translate('ui-text.manual-coding-planning.regulaere-codes-ergaenzen');
      case 'preparation-required':
        return this.translate('ui-text.manual-coding-planning.vorbereitung-aktualisieren');
      case 'planning-incomplete':
        return this.translate('ui-text.manual-coding-planning.kodierfaelle-in-jobs-verteilen');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.schulung-pruefen');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-planning.kodierjobs-bearbeiten-lassen');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.doppelkodierungen-aufloesen');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.veraltete-jobs-pruefen');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          this.translate('ui-text.manual-coding-planning.ergebnisse-uebernehmen') :
          this.translate('ui-text.manual-coding-planning.kodierjobs-pruefen');
      case 'complete':
        return this.translate('ui-text.manual-coding-planning.workflow-abgeschlossen');
      case 'progress-unavailable':
        return this.translate('ui-text.manual-coding-planning.kodierfortschritt-pruefen');
      default:
        return this.translate('ui-text.manual-coding-planning.jobdefinition-erstellen');
    }
  }

  getPlanningNextStepDescription(): string {
    const availableCases = this.state.getAvailableCasesForNewJobs;
    const unavailableCases = this.state.getUnavailableCasesForNewJobs;

    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('ui-text.manual-coding-planning.oeffnen-sie-die-planung-um-den-kodierstand-zu-laden');
      case 'loading':
        return this.translate('ui-text.manual-coding-planning.warten-sie-kurz-bis-die-planungsdaten-aktualisiert-sind');
      case 'planning-data-required':
        return this.translate('ui-text.manual-coding-planning.laden-sie-die-planungsdaten-um-variablen-und-fallabdeckung-kodierfortschritt-off');
      case 'warning':
        if (this.state.hasVariableCoverageConflicts) {
          return this.translate('ui-text.manual-coding-planning.pruefen-sie-variablen-die-von-mehreren-definitionen-mit-ueberlappenden-faellen-v');
        }
        return this.translate('ui-text.manual-coding-planning.ergaenzen-sie-bei-mindestens-einem-regulaeren-code-eine-manuelle-instruktion-ode');
      case 'preparation-required':
        return this.state.isResponseAnalysisOutdated ?
          this.translate('ui-text.manual-coding-planning.aktualisieren-sie-antwortanalyse-und-aggregationsgrundlage-bevor-die-manuelle-zi') :
          this.translate('ui-text.manual-coding-planning.klaeren-sie-offene-vorbereitungsbefunde-wie-leere-antworten-oder-duplikate-ohne-');
      case 'planning-incomplete':
        if ((this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
          const unavailableHint = unavailableCases > 0 ?
            this.translate('ui-text.manual-coding-planning.value1-faelle-sind-bereits-in-jobs-verteilt-oder-durch-andere-definitionen-reser', { value1: unavailableCases }) :
            '';
          return this.translate('ui-text.manual-coding-planning.value1-faelle-sind-noch-nicht-in-kodierjobs-fuer-neue-jobdefinitionen-sind-aktue', { value1: this.state.caseCoverageOverview?.effectiveUnassignedCases || 0, value2: availableCases, value3: unavailableHint });
        }
        return this.translate('ui-text.manual-coding-planning.ordnen-sie-die-fehlenden-variablen-einer-jobdefinition-zu-danach-definition-frei');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.es-gibt-aktive-schulungskodierjobs-pruefen-sie-den-schulungsstand-bevor-produkti');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-planning.die-faelle-sind-verteilt-kodierer-koennen-nun-ihre-zugewiesenen-kodierjobs-bearb');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.es-gibt-abgeschlossene-produktive-kodierjobs-mit-offenen-doppelkodierungs-konfli');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.veraltete-quellfaelle-werden-nicht-angewendet-pruefen-sie-die-betroffenen-jobs-i');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          this.translate('ui-text.manual-coding-planning.alle-kodierfaelle-sind-bearbeitet-uebernehmen-sie-jetzt-die-abgeschlossenen-erge') :
          this.translate('ui-text.manual-coding-planning.alle-kodierfaelle-sind-bearbeitet-sie-koennen-die-abgeschlossenen-kodierjobs-in-');
      case 'complete':
        return this.translate('ui-text.manual-coding-planning.alle-manuellen-kodierungen-wurden-abgeschlossen-und-uebernommen');
      case 'progress-unavailable':
        return this.translate('ui-text.manual-coding-planning.aktualisieren-sie-die-ansicht-oder-pruefen-sie-die-kodierjobs-bevor-sie-fortfahr');
      default:
        return this.translate('ui-text.manual-coding-planning.waehlen-sie-variablen-oder-buendel-sowie-kodierer-aus-eine-definition-verteilt-n');
    }
  }

  getPlanningNextStepActionLabel(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return this.translate('ui-text.manual-coding-planning.zur-planung');
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          this.translate('ui-text.manual-coding-planning.zu-den-jobdefinitionen') :
          this.translate('ui-text.manual-coding-planning.betroffene-variablen-ansehen');
      case 'preparation-required':
        return this.translate('ui-text.manual-coding-planning.zur-vorbereitung');
      case 'training-ready':
        return this.translate('ui-text.manual-coding-planning.zur-schulung');
      case 'execution-ready':
        return this.translate('ui-text.manual-coding-completion-view.zu-den-kodierjobs');
      case 'double-coding-review-ready':
        return this.translate('ui-text.manual-coding-planning.doppelkodierungsreview-oeffnen');
      case 'stale-source-review':
        return this.translate('ui-text.manual-coding-planning.veraltete-jobs-pruefen');
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ? this.translate('ui-text.manual-coding-planning.zum-abschluss') : this.translate('ui-text.manual-coding-completion-view.zu-den-kodierjobs');
      case 'complete':
        return this.state.canShowManualCompletionTab ? this.translate('ui-text.manual-coding-planning.abschluss-ansehen') : this.translate('ui-text.manual-coding-completion-view.zu-den-kodierjobs');
      case 'loading':
      case 'planning-data-required':
      case 'progress-unavailable':
        return this.translate('process-overview.refresh');
      default:
        return this.translate('ui-text.manual-coding-planning.zu-den-jobdefinitionen');
    }
  }

  getPlanningNextStepTargetSection(): string {
    return this.getPlanningNextStepTarget().sectionId;
  }

  getPlanningNextStepTargetTab(): ManualCodingTab {
    return this.getPlanningNextStepTarget().tab;
  }

  getPlanningNextStepTarget(): ManualFreshnessTarget {
    switch (this.getPlanningStatusState()) {
      case 'preparation-required':
        return {
          tab: 'preparation',
          sectionId: 'manual-preparation',
          action: 'navigate'
        };
      case 'warning':
        return {
          tab: 'planning',
          sectionId: this.state.hasVariableCoverageConflicts ?
            'manual-planning' :
            'manual-variable-coverage',
          action: 'navigate'
        };
      case 'training-ready':
        return {
          tab: 'training',
          sectionId: 'manual-support',
          action: 'navigate'
        };
      case 'execution-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'navigate'
        };
      case 'double-coding-review-ready':
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'double-coding-review'
        };
      case 'stale-source-review':
        // stale_source jobs are intentionally routed to Durchführung: users inspect
        // the outdated source jobs there before any refresh or apply action.
        return {
          tab: 'execution',
          sectionId: 'manual-execution',
          action: 'navigate'
        };
      case 'completion-ready':
      case 'complete':
        return {
          tab: this.state.canShowManualCompletionTab ? 'completion' : 'execution',
          sectionId: this.state.canShowManualCompletionTab ? 'manual-completion' : 'manual-execution',
          action: 'navigate'
        };
      default:
        return {
          tab: 'planning',
          sectionId: 'manual-planning',
          action: 'navigate'
        };
    }
  }

  getPlanningNextStepIcon(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'fact_check';
      case 'planning-data-required':
        return 'refresh';
      case 'warning':
        return 'warning';
      case 'preparation-required':
        return 'tune';
      case 'training-ready':
        return 'school';
      case 'execution-ready':
        return 'play_circle';
      case 'double-coding-review-ready':
        return 'compare';
      case 'stale-source-review':
        return 'sync_problem';
      case 'completion-ready':
      case 'complete':
        return 'published_with_changes';
      case 'loading':
      case 'progress-unavailable':
        return 'sync';
      default:
        return 'route';
    }
  }
}
