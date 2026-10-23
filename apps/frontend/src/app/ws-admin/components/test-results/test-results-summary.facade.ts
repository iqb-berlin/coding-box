import { computed, inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { CodingFreshnessState, CodingFreshnessSummaryItemDto, CodingFreshnessVersion } from '../../../../../../../api-dto/coding/coding-freshness.dto';
import {
  CODING_FRESHNESS_TASK_RESULT_HELP,
  formatCodingFreshnessTaskResultCount,
  getCodingFreshnessAffectedResponseCount,
  getCodingFreshnessAffectedTaskResultCount,
  getCodingFreshnessAttentionTitle,
  getCodingFreshnessAutoCodingWarnings,
  getCodingFreshnessChipLabel,
  getCodingFreshnessManualReviewGuidanceText,
  getCodingFreshnessManualReviewWarnings,
  getCodingFreshnessStateLabel,
  getCodingFreshnessSummaryText,
  getCodingFreshnessVersionLabel,
  getSecondAutocodingFreshnessWarnings,
  hasOnlyManualCodingFreshnessWarnings,
  isCodingFreshnessOpenWarning,
  isSecondAutocodingWaitingForManualCoding,
  SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS
} from '../../../shared/utils/coding-freshness-text.util';
import { getResponseStatusTooltipKey } from '../../../shared/utils/response-status-metadata.util';
import { RESPONSE_STATUS_INFO } from './test-results-response-status';
import { TestResultsStatisticsFacade } from './test-results-statistics.facade';

/** Read-only, memoized summaries shared by the overview and its navigation actions. */
@Injectable()
export class TestResultsSummaryFacade {
  private readonly statistics = inject(TestResultsStatisticsFacade);
  private readonly translateService = inject(TranslateService);
  private readonly overview = this.statistics.overview;
  private readonly logAnomalySummary = this.statistics.logAnomalySummary;
  private readonly codingFreshnessSummary = this.statistics.codingFreshnessSummary;
  private readonly manualAppliedResultsOverview = this.statistics.manualAppliedResultsOverview;
  private readonly manualAppliedResultsOverviewLoadFailed = this.statistics.manualAppliedResultsOverviewLoadFailed;
  private readonly isLoadingManualAppliedResultsOverview = this.statistics.isLoadingManualAppliedResultsOverview;

  readonly hasLogAnomalySummary = computed<boolean>(() => !!this.logAnomalySummary());

  readonly logAnomalyAffectedPercent = computed<number>(() => {
    const total = Number(this.logAnomalySummary()?.totalBooklets || 0);
    if (total <= 0) {
      return 0;
    }
    return Math.round(
      (Number(this.logAnomalySummary()?.affectedBooklets || 0) / total) * 1000
    ) / 10;
  });

  readonly logAnomalyTopCodes = computed<Array<{ code: string; label: string; count: number }>>(() => {
    const byCode = this.logAnomalySummary()?.byCode || {};
    return Object.entries(byCode)
      .map(([code, count]) => ({
        code,
        label: this.getLogAnomalyCodeLabel(code),
        count: Number(count) || 0
      }))
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 6);
  });

  getLogAnomalyCodeLabel(code: string): string {
    const labels: Record<string, string> = {
      controller_error: 'Controller-Fehler',
      missing_termination: 'Kein Abschluss',
      connection_lost: 'Verbindung verloren',
      timestamp_zero: 'Timestamp 0',
      player_stuck_loading: 'Player hängt',
      repeated_start: 'Mehrfach gestartet',
      long_loading: 'Lange Ladezeit',
      timer_left_on_exit: 'Restzeit am Ende',
      timer_never_finished: 'Timer nicht beendet',
      focus_lost_long: 'Langer Fokusverlust',
      unit_progress_incomplete: 'Units fehlen',
      progress_incomplete: 'Progress unvollständig',
      debug_command: 'Debug-Befehl',
      session_span_long: 'Lange Zeitspanne',
      orphan_logs: 'Logs ohne Start'
    };
    return labels[code] || code;
  }

  readonly overviewResponseStatusTotal = computed<number>(() => Object.values(this.overview()?.responseStatusCounts || {})
    .reduce((sum, count) => sum + (Number(count) || 0), 0));

  readonly overviewStatusCounts = computed<Array<{ status: string; count: number; percent: number }>>(() => {
    const map = (this.overview()?.responseStatusCounts || {}) as Record<
      string,
      number
    >;
    const total = this.overviewResponseStatusTotal();
    return Object.entries(map)
      .map(([status, count]) => {
        const normalizedCount = Number(count) || 0;
        return {
          status,
          count: normalizedCount,
          percent: this.getPercent(normalizedCount, total)
        };
      })
      .sort((a, b) => b.count - a.count);
  });

  readonly allCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => (this.codingFreshnessSummary()?.items || [])
    .filter(isCodingFreshnessOpenWarning)
    .sort((a, b) => a.version.localeCompare(b.version) || a.state.localeCompare(b.state)));

  readonly codingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => this.allCodingFreshnessWarnings()
    .filter(item => !(item.version === 'v3' && (
      this.isSecondAutocodingManualStatusPending() ||
        this.isSecondAutocodingWaitingForManualCoding()
    ))));

  readonly hasCodingFreshnessWarning = computed<boolean>(() => this.codingFreshnessWarnings().length > 0 ||
      this.shouldShowSecondAutocodingWaitingState());

  readonly codingFreshnessDisplayWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => {
    if (this.codingFreshnessWarnings().length > 0) {
      return this.codingFreshnessWarnings();
    }

    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.secondAutocodingFreshnessWarnings();
    }

    return [];
  });

  readonly autoCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getCodingFreshnessAutoCodingWarnings(this.codingFreshnessWarnings()));

  readonly manualCodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getCodingFreshnessManualReviewWarnings(this.codingFreshnessWarnings()));

  readonly hasOnlyManualCodingFreshnessWarnings = computed<boolean>(() => hasOnlyManualCodingFreshnessWarnings(this.codingFreshnessWarnings()));

  readonly codingFreshnessAffectedUnitVersions = computed<number>(() => getCodingFreshnessAffectedTaskResultCount(this.codingFreshnessWarnings()));

  readonly codingFreshnessAffectedResponses = computed<number>(() => getCodingFreshnessAffectedResponseCount(this.codingFreshnessWarnings()));

  get codingFreshnessSummaryText(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.getSecondAutocodingWaitingSummaryText();
    }

    return getCodingFreshnessSummaryText(this.codingFreshnessWarnings());
  }

  get codingFreshnessExplanationText(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.help,
        { taskResultHelp: CODING_FRESHNESS_TASK_RESULT_HELP }
      );
    }

    const guidanceText = getCodingFreshnessManualReviewGuidanceText(
      this.codingFreshnessWarnings()
    );
    if (guidanceText) {
      return `${guidanceText} ${CODING_FRESHNESS_TASK_RESULT_HELP}`;
    }

    return CODING_FRESHNESS_TASK_RESULT_HELP;
  }

  get codingFreshnessBannerTitle(): string {
    if (this.shouldShowSecondAutocodingWaitingState()) {
      return this.translateService.instant(SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.title);
    }

    return getCodingFreshnessAttentionTitle(this.codingFreshnessWarnings());
  }

  readonly codingFreshnessActionLabel = computed<string>(() => {
    if (this.shouldShowSecondAutocodingWaitingState() || this.hasOnlyManualCodingFreshnessWarnings()) {
      return 'Manuelle Kodierung öffnen';
    }

    return this.autoCodingFreshnessWarnings().length > 0 ?
      'Auto-Coding öffnen' :
      'Kodierung öffnen';
  });

  readonly codingFreshnessActionIcon = computed<string>(() => ((this.shouldShowSecondAutocodingWaitingState() || this.hasOnlyManualCodingFreshnessWarnings()) ?
    'keyboard' :
    'rule'));

  getCodingFreshnessVersionLabel(version: CodingFreshnessVersion): string {
    return getCodingFreshnessVersionLabel(version);
  }

  getCodingFreshnessStateLabel(state: CodingFreshnessState): string {
    return getCodingFreshnessStateLabel(state);
  }

  getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
    if (item.version === 'v3' && this.isSecondAutocodingWaitingForManualCoding()) {
      return this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.chip,
        {
          version: getCodingFreshnessVersionLabel(item.version),
          count: formatCodingFreshnessTaskResultCount(item.unitCount)
        }
      );
    }

    return getCodingFreshnessChipLabel(item);
  }

  readonly secondAutocodingFreshnessWarnings = computed<CodingFreshnessSummaryItemDto[]>(() => getSecondAutocodingFreshnessWarnings(this.allCodingFreshnessWarnings()));

  readonly isSecondAutocodingWaitingForManualCoding = computed<boolean>(() => isSecondAutocodingWaitingForManualCoding(
    this.allCodingFreshnessWarnings(),
    this.manualAppliedResultsOverview(),
    this.manualAppliedResultsOverviewLoadFailed()
  ));

  readonly isSecondAutocodingManualStatusPending = computed<boolean>(() => this.secondAutocodingFreshnessWarnings().length > 0 &&
      this.isLoadingManualAppliedResultsOverview() &&
      !this.manualAppliedResultsOverviewLoadFailed());

  readonly shouldShowSecondAutocodingWaitingState = computed<boolean>(() => {
    if (this.isSecondAutocodingManualStatusPending()) {
      return false;
    }

    return this.isSecondAutocodingWaitingForManualCoding() &&
      this.codingFreshnessWarnings().length === 0;
  });

  getSecondAutocodingWaitingSummaryText(): string {
    if (this.manualAppliedResultsOverviewLoadFailed()) {
      return this.translateService.instant(SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.loadFailed);
    }

    const remaining = this.manualAppliedResultsOverview()?.remainingResponses || 0;
    const remainingText = remaining > 0 ?
      this.translateService.instant(
        SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.remaining,
        { count: remaining }
      ) :
      '';

    return this.translateService.instant(
      SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS.summary,
      { remaining: remainingText }
    );
  }

  toSortedCountList(
    map?: Record<string, number>
  ): Array<{ key: string; count: number }> {
    const m = (map || {}) as Record<string, number>;
    return Object.entries(m)
      .map(([key, count]) => ({ key, count: Number(count) }))
      .filter(e => e.count > 0)
      .sort((a, b) => b.count - a.count);
  }

  totalCount(list: Array<{ count: number }>): number {
    return list.reduce((sum, x) => sum + (Number(x.count) || 0), 0);
  }

  readonly overviewBrowserCounts = computed<Array<{ key: string; count: number }>>(() => this.toSortedCountList(this.overview()?.sessionBrowserCounts));

  readonly overviewOsCounts = computed<Array<{ key: string; count: number }>>(() => this.toSortedCountList(this.overview()?.sessionOsCounts));

  readonly overviewScreenCounts = computed<Array<{ key: string; count: number }>>(() => this.toSortedCountList(this.overview()?.sessionScreenCounts));

  getBrowserTotal(): number {
    return this.totalCount(this.overviewBrowserCounts());
  }

  getOsTotal(): number {
    return this.totalCount(this.overviewOsCounts());
  }

  getScreenTotal(): number {
    return this.totalCount(this.overviewScreenCounts());
  }

  getPercent(count: number, total: number): number {
    const t = Number(total) || 0;
    if (t <= 0) {
      return 0;
    }
    return Math.round((Number(count) / t) * 1000) / 10;
  }

  getResponseStatusTooltip(status: string): string {
    const sharedTooltipKey = getResponseStatusTooltipKey(status);
    if (sharedTooltipKey) {
      return this.translateService.instant(sharedTooltipKey);
    }

    const info = RESPONSE_STATUS_INFO[status];
    if (!info) {
      return status;
    }

    const descriptionPart = info.description ? `: ${info.description}` : '';
    return `${status}${descriptionPart}`;
  }
}
