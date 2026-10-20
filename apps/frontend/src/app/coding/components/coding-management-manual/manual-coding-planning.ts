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
  constructor(private readonly state: ManualCodingPlanningState) {}

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
        return 'Kodierstand nicht geprüft';
      case 'loading':
        return 'Status wird aktualisiert';
      case 'planning-data-required':
        return 'Planungsdaten aktualisieren';
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          'Konflikte prüfen' :
          'Reguläre Codes für manuelle Kodierung prüfen';
      case 'preparation-required':
        return 'Vorbereitung aktualisieren';
      case 'planning-incomplete':
        return 'Planung noch unvollständig';
      case 'training-ready':
        return 'Schulungskodierjobs aktiv';
      case 'execution-ready':
        return 'Bereit für die Durchführung';
      case 'double-coding-review-ready':
        return 'Doppelkodierungsreview offen';
      case 'stale-source-review':
        return 'Veraltete Kodierjobs prüfen';
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          'Bereit für den Abschluss' :
          'Kodierfälle abgeschlossen';
      case 'progress-unavailable':
        return 'Kodierfortschritt nicht verfügbar';
      case 'complete':
        return 'Manuelle Kodierung abgeschlossen';
      default:
        return 'Bereit für die Planung';
    }
  }

  getPlanningStatusDescription(): string {
    const planningStatusState = this.getPlanningStatusState();

    if (planningStatusState === 'not-checked') {
      return 'Öffnen oder aktualisieren Sie die Planung, um den aktuellen Kodierstand zu prüfen.';
    }

    if (planningStatusState === 'loading') {
      return 'Die Planungs- und Kodierfortschritte werden geladen.';
    }

    if (planningStatusState === 'planning-data-required') {
      return 'Abdeckung, Kodierfortschritt und Freshness-Hinweise werden erst auf Anforderung geladen.';
    }

    if (planningStatusState === 'progress-unavailable') {
      return 'Die Planung ist vollständig, der aktuelle Kodierfortschritt konnte aber nicht ermittelt werden. Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs.';
    }

    if (planningStatusState === 'preparation-required') {
      if (this.state.isResponseAnalysisOutdated) {
        return 'Die Antwortanalyse oder Aggregationsgrundlage ist nicht mehr aktuell. Aktualisieren Sie zuerst die Vorbereitung.';
      }
      return 'In der Vorbereitung gibt es offene Punkte, die vor der weiteren manuellen Kodierung geklärt werden sollten.';
    }

    if (this.state.hasVariableCoverageConflicts) {
      return `${this.state.variableCoverageOverview?.conflictedVariables || 0} Variablenkonflikte müssen vor der verlässlichen Jobplanung geklärt werden.`;
    }

    if (this.state.hasManualCodeAvailabilityWarnings) {
      return `${this.state.manualCodeAvailabilityWarningCount} Variablen haben keine regulären Codes mit manueller Instruktion. Kodierer können dort nur Sonderoptionen wie "Code-Vergabe unsicher" oder "Neuer Code nötig" auswählen.`;
    }

    if ((this.state.variableCoverageOverview?.missingVariables || 0) > 0) {
      return `${this.state.variableCoverageOverview?.missingVariables || 0} Variablen sind noch keiner Jobdefinition zugeordnet.`;
    }

    if ((this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
      return `${this.state.caseCoverageOverview?.effectiveUnassignedCases || 0} Fälle sind noch nicht in Kodierjobs verteilt.`;
    }

    if (this.state.isCompletionComplete) {
      return 'Alle manuellen Kodierungen sind abgeschlossen und final übernommen.';
    }

    if (this.state.isPlanningReady &&
        this.state.hasActiveTrainingCodingJobs) {
      return `${this.state.manualFreshnessJobSummary?.activeTrainingJobs || 0} aktive Schulungskodierjob(s) sollten vor der produktiven Durchführung geprüft werden.`;
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        this.state.hasExecutionOpenWorkForFreshness) {
      return 'Die Planung ist vollständig. Bearbeiten Sie nun die offenen Kodierfälle im Abschnitt Durchführung.';
    }

    if (this.state.isPlanningReady && this.state.hasOpenDoubleCodingReviewConflicts) {
      return `${this.state.openDoubleCodingConflictCount} offene Doppelkodierungs-Konflikt(e) müssen im Review aufgelöst werden.`;
    }

    if (this.state.isPlanningReady && this.state.hasStaleSourceManualJobs) {
      return `${this.state.manualFreshnessJobSummary?.staleSourceJobs || 0} Kodierjob(s) enthalten veraltete Quellfälle. Prüfen Sie diese Jobs in der Durchführung, bevor Ergebnisse angewendet oder weitergeführt werden.`;
    }

    if (this.state.isPlanningReady &&
        !!this.state.codingProgressOverview &&
        !!this.state.appliedResultsOverview &&
        this.state.hasCompletionReadyWorkForFreshness) {
      return this.state.canShowManualCompletionTab ?
        'Alle Kodierfälle sind abgeschlossen. Übernehmen Sie nun die Kodierergebnisse in den Datenbestand.' :
        'Alle Kodierfälle sind abgeschlossen. Die Übernahme der Ergebnisse in den Datenbestand bleibt Studienmanager:innen vorbehalten.';
    }

    return 'Prüfen Sie die Antwortanalyse und erstellen Sie danach passende Kodierjob-Definitionen.';
  }

  getPlanningNextStepTitle(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'Kodierstand prüfen';
      case 'loading':
        return 'Planungsstand wird geladen';
      case 'planning-data-required':
        return 'Planungsstand laden';
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          'Konflikte zuerst klären' :
          'Reguläre Codes ergänzen';
      case 'preparation-required':
        return 'Vorbereitung aktualisieren';
      case 'planning-incomplete':
        return 'Kodierfälle in Jobs verteilen';
      case 'training-ready':
        return 'Schulung prüfen';
      case 'execution-ready':
        return 'Kodierjobs bearbeiten lassen';
      case 'double-coding-review-ready':
        return 'Doppelkodierungen auflösen';
      case 'stale-source-review':
        return 'Veraltete Jobs prüfen';
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          'Ergebnisse übernehmen' :
          'Kodierjobs prüfen';
      case 'complete':
        return 'Workflow abgeschlossen';
      case 'progress-unavailable':
        return 'Kodierfortschritt prüfen';
      default:
        return 'Jobdefinition erstellen';
    }
  }

  getPlanningNextStepDescription(): string {
    const availableCases = this.state.getAvailableCasesForNewJobs;
    const unavailableCases = this.state.getUnavailableCasesForNewJobs;

    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'Öffnen Sie die Planung, um den Kodierstand zu laden.';
      case 'loading':
        return 'Warten Sie kurz, bis die Planungsdaten aktualisiert sind.';
      case 'planning-data-required':
        return 'Laden Sie die Planungsdaten, um Variablen- und Fallabdeckung, Kodierfortschritt, offene Variablen und Freshness-Hinweise zu prüfen.';
      case 'warning':
        if (this.state.hasVariableCoverageConflicts) {
          return 'Prüfen Sie Variablen, die von mehreren Definitionen mit überlappenden Fällen verwendet werden.';
        }
        return 'Ergänzen Sie bei mindestens einem regulären Code eine manuelle Instruktion oder nehmen Sie die betroffenen Variablen aus der manuellen Auswahl.';
      case 'preparation-required':
        return this.state.isResponseAnalysisOutdated ?
          'Aktualisieren Sie Antwortanalyse und Aggregationsgrundlage, bevor die manuelle Zielnavigation fortgesetzt wird.' :
          'Klären Sie offene Vorbereitungsbefunde wie leere Antworten oder Duplikate ohne aktive Aggregation.';
      case 'planning-incomplete':
        if ((this.state.caseCoverageOverview?.effectiveUnassignedCases || 0) > 0) {
          const unavailableHint = unavailableCases > 0 ?
            ` ${unavailableCases} Fälle sind bereits in Jobs verteilt oder durch andere Definitionen reserviert.` :
            '';
          return `${this.state.caseCoverageOverview?.effectiveUnassignedCases || 0} Fälle sind noch nicht in Kodierjobs. Für neue Jobdefinitionen sind aktuell ${availableCases} Fälle verfügbar.${unavailableHint} Danach Definition freigeben und Jobs erstellen.`;
        }
        return 'Ordnen Sie die fehlenden Variablen einer Jobdefinition zu. Danach Definition freigeben und Jobs erstellen.';
      case 'training-ready':
        return 'Es gibt aktive Schulungskodierjobs. Prüfen Sie den Schulungsstand, bevor produktive Kodierjobs im Fokus stehen.';
      case 'execution-ready':
        return 'Die Fälle sind verteilt. Kodierer können nun ihre zugewiesenen Kodierjobs bearbeiten.';
      case 'double-coding-review-ready':
        return 'Es gibt abgeschlossene produktive Kodierjobs mit offenen Doppelkodierungs-Konflikten. Öffnen Sie den Review und lösen Sie die Abweichungen auf.';
      case 'stale-source-review':
        return 'Veraltete Quellfälle werden nicht angewendet. Prüfen Sie die betroffenen Jobs in der Durchführung und aktualisieren Sie sie fachlich passend.';
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ?
          'Alle Kodierfälle sind bearbeitet. Übernehmen Sie jetzt die abgeschlossenen Ergebnisse in den Datenbestand.' :
          'Alle Kodierfälle sind bearbeitet. Sie können die abgeschlossenen Kodierjobs in der Durchführung einsehen.';
      case 'complete':
        return 'Alle manuellen Kodierungen wurden abgeschlossen und übernommen.';
      case 'progress-unavailable':
        return 'Aktualisieren Sie die Ansicht oder prüfen Sie die Kodierjobs, bevor Sie fortfahren.';
      default:
        return 'Wählen Sie Variablen oder Bündel sowie Kodierer aus. Eine Definition verteilt noch keine Fälle; erst "Jobs erstellen" legt die Kodierjobs an.';
    }
  }

  getPlanningNextStepActionLabel(): string {
    switch (this.getPlanningStatusState()) {
      case 'not-checked':
        return 'Zur Planung';
      case 'warning':
        return this.state.hasVariableCoverageConflicts ?
          'Zu den Jobdefinitionen' :
          'Betroffene Variablen ansehen';
      case 'preparation-required':
        return 'Zur Vorbereitung';
      case 'training-ready':
        return 'Zur Schulung';
      case 'execution-ready':
        return 'Zu den Kodierjobs';
      case 'double-coding-review-ready':
        return 'Doppelkodierungsreview öffnen';
      case 'stale-source-review':
        return 'Veraltete Jobs prüfen';
      case 'completion-ready':
        return this.state.canShowManualCompletionTab ? 'Zum Abschluss' : 'Zu den Kodierjobs';
      case 'complete':
        return this.state.canShowManualCompletionTab ? 'Abschluss ansehen' : 'Zu den Kodierjobs';
      case 'loading':
      case 'planning-data-required':
      case 'progress-unavailable':
        return 'Aktualisieren';
      default:
        return 'Zu den Jobdefinitionen';
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
