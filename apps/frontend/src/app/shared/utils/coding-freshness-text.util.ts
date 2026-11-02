import { UiTranslator } from './ui-translator';
import {
  CodingFreshnessState,
  CodingFreshnessSummaryItemDto,
  CodingFreshnessVersion
} from '../../../../../../api-dto/coding/coding-freshness.dto';

export const CODING_FRESHNESS_TASK_RESULT_HELP_KEY =
  'ui-text.coding-freshness.eine-aufgabenbearbeitung-meint-eine-aufgabe-die-eine-bestimmte-testperson-in-ein';

export const SECOND_AUTOCODING_WAITING_TRANSLATION_KEYS = {
  title: 'coding-management.readiness.title-manual-coding-open',
  loadFailed: 'coding-management.readiness.manual-results-overview-load-failed',
  summary: 'coding-management.readiness.second-autocoding-waits-summary',
  remaining: 'coding-management.readiness.second-autocoding-waits-remaining',
  help: 'coding-management.readiness.second-autocoding-waits-help',
  chip: 'coding-management.readiness.second-autocoding-waits-chip'
} as const;

export interface ManualCodingCompletionOverview {
  totalIncompleteResponses?: number;
  appliedResponses?: number;
  remainingResponses?: number;
  completionPercentage?: number;
}

export function getCodingFreshnessVersionLabel(translate: UiTranslator, version: CodingFreshnessVersion): string {
  const labels: Record<CodingFreshnessVersion, string> = {
    v1: translate('ui-text.coding-freshness-text.util.auto-coding-1'),
    v2: translate('ws-admin.manual-coding'),
    v3: translate('ui-text.coding-freshness-text.util.auto-coding-2')
  };
  return labels[version];
}

export function getCodingFreshnessStateLabel(translate: UiTranslator, state: CodingFreshnessState): string {
  const labels: Record<CodingFreshnessState, string> = {
    CURRENT: translate('ui-text.coding-freshness-text.util.aktuell'),
    PENDING: translate('ui-text.coding-freshness-text.util.zu-kodieren'),
    STALE: translate('ui-text.coding-freshness-text.util.zu-aktualisieren'),
    MANUAL_REVIEW_REQUIRED: translate('ui-text.coding-freshness-text.util.zu-aktualisieren')
  };
  return labels[state];
}

export function formatCodingFreshnessTaskResultCount(translate: UiTranslator, count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? translate('ui-text.coding-management.aufgabenbearbeitung') : translate('ui-text.coding-management.aufgabenbearbeitungen')}`;
}

export function formatCodingFreshnessResponseCount(translate: UiTranslator, count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? translate('test-results-table.response-value') : translate('variable-analysis.analysis-results')}`;
}

export function isCodingFreshnessOpenWarning(item: CodingFreshnessSummaryItemDto): boolean {
  return item.state !== 'CURRENT' && normalizeCount(item.unitCount) > 0;
}

export function getCodingFreshnessAffectedTaskResultCount(items: CodingFreshnessSummaryItemDto[]): number {
  return items.reduce((sum, item) => sum + normalizeCount(item.unitCount), 0);
}

export function getCodingFreshnessAffectedResponseCount(items: CodingFreshnessSummaryItemDto[]): number {
  return items.reduce((sum, item) => sum + normalizeCount(item.affectedResponseCount), 0);
}

export function getCodingFreshnessAutoCodingWarnings(
  items: CodingFreshnessSummaryItemDto[]
): CodingFreshnessSummaryItemDto[] {
  return items.filter(item => (
    isCodingFreshnessOpenWarning(item) &&
    (item.version === 'v1' || item.version === 'v3') &&
    (item.state === 'PENDING' || item.state === 'STALE')
  ));
}

export function getCodingFreshnessManualReviewWarnings(
  items: CodingFreshnessSummaryItemDto[]
): CodingFreshnessSummaryItemDto[] {
  return items.filter(item => (
    isCodingFreshnessOpenWarning(item) &&
    (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED')
  ));
}

export function getSecondAutocodingFreshnessWarnings(
  items: CodingFreshnessSummaryItemDto[]
): CodingFreshnessSummaryItemDto[] {
  return items.filter(item => (
    isCodingFreshnessOpenWarning(item) &&
    item.version === 'v3'
  ));
}

export function isSecondAutocodingWaitingForManualCoding(
  items: CodingFreshnessSummaryItemDto[],
  manualCodingOverview: ManualCodingCompletionOverview | null,
  manualCodingOverviewLoadFailed: boolean
): boolean {
  const secondAutocodingWarnings = getSecondAutocodingFreshnessWarnings(items);
  if (secondAutocodingWarnings.length === 0) {
    return false;
  }

  if (manualCodingOverviewLoadFailed || !manualCodingOverview) {
    return true;
  }

  return normalizeCount(manualCodingOverview.totalIncompleteResponses || 0) > 0 &&
    normalizeCount(manualCodingOverview.remainingResponses || 0) > 0;
}

export function hasOnlyManualCodingFreshnessWarnings(
  items: CodingFreshnessSummaryItemDto[]
): boolean {
  return getCodingFreshnessManualReviewWarnings(items).length > 0 &&
    getCodingFreshnessAutoCodingWarnings(items).length === 0;
}

export function getCodingFreshnessAttentionTitle(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[]
): string {
  const warnings = items.filter(isCodingFreshnessOpenWarning);
  if (warnings.length === 0) {
    return translate('ui-text.coding-freshness-text.util.kodierstand-aktuell');
  }

  const autoCodingWarnings = getCodingFreshnessAutoCodingWarnings(warnings);
  const manualReviewWarnings = getCodingFreshnessManualReviewWarnings(warnings);

  if (autoCodingWarnings.length > 0 && manualReviewWarnings.length === 0) {
    const autoCodingStates = new Set(autoCodingWarnings.map(item => item.state));
    if (autoCodingStates.size === 1 && autoCodingStates.has('PENDING')) {
      return translate('ui-text.coding-freshness-text.util.auto-coding-starten');
    }

    if (autoCodingStates.size === 1 && autoCodingStates.has('STALE')) {
      return translate('ui-text.coding-freshness-text.util.auto-coding-aktualisieren');
    }

    return translate('ui-text.coding-freshness-text.util.auto-coding-starten-oder-aktualisieren');
  }

  if (autoCodingWarnings.length === 0 && manualReviewWarnings.length > 0) {
    return translate('coding-management-manual.buttons.refresh-manual-coding-aria');
  }

  return translate('coding.schemer.check-coding-status');
}

export function getCodingFreshnessManualReviewGuidanceText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[]
): string {
  if (getCodingFreshnessManualReviewWarnings(items).length === 0) {
    return '';
  }

  if (getCodingFreshnessAutoCodingWarnings(items).length > 0) {
    return translate('ui-text.coding-freshness-text.util.aktualisieren-sie-zuerst-die-offenen-auto-coding-schritte-danach-wird-die-manuelle-ko');
  }

  return translate('ui-text.coding-freshness-text.util.oeffnen-sie-die-manuelle-kodierung-bearbeiten-sie-offene-faelle-im-abschnitt-durchfue');
}

export function getCodingFreshnessSummaryText(translate: UiTranslator, items: CodingFreshnessSummaryItemDto[]): string {
  const warnings = items.filter(isCodingFreshnessOpenWarning);
  if (warnings.length === 0) {
    return translate('coding-management.readiness.current');
  }

  const autoCodingWarnings = getCodingFreshnessAutoCodingWarnings(warnings);
  const manualReviewWarnings = getCodingFreshnessManualReviewWarnings(warnings);

  if (autoCodingWarnings.length > 0 && manualReviewWarnings.length === 0) {
    return getAutoCodingSummaryText(translate, autoCodingWarnings);
  }

  if (autoCodingWarnings.length === 0 && manualReviewWarnings.length > 0) {
    return getManualReviewSummaryText(translate, manualReviewWarnings);
  }

  if (warnings.length === 1) {
    const taskResults = formatCodingFreshnessTaskResultCount(translate,
      getCodingFreshnessAffectedTaskResultCount(warnings)
    );
    return getSingleCodingFreshnessActionText(translate, warnings[0], taskResults);
  }

  return translate('ui-text.coding-freshness-text.util.es-sind-mehrere-kodierschritte-offen') +
    translate('ui-text.coding-freshness-text.util.die-chips-zeigen-je-kodierschritt-wie-viele-aufgabenbearbeitungen-betroffen-sind');
}

export function getCodingFreshnessChipLabel(translate: UiTranslator, item: CodingFreshnessSummaryItemDto): string {
  return `${getCodingFreshnessVersionLabel(translate, item.version)}: ` +
    `${formatCodingFreshnessTaskResultCount(translate, item.unitCount)} ${getChipActionText(translate, item)}`;
}

export function getCodingFreshnessAutoCodingButtonLabel(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const count = items
    .filter(item => item.version === version)
    .reduce((sum, item) => sum + normalizeCount(item.unitCount), 0);
  const action = getAutoCodingButtonActionText(translate, items, version);

  return translate('ui-text.coding-freshness-text.util.fuer', { value1: getCodingFreshnessVersionLabel(translate, version), value2: formatCodingFreshnessTaskResultCount(translate, count), value3: action });
}

function getAutoCodingSummaryText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[]
): string {
  const versions = Array.from(
    new Set(items.map(item => item.version))
  ) as Array<Extract<CodingFreshnessVersion, 'v1' | 'v3'>>;

  if (versions.length === 1) {
    const [version] = versions;
    const taskResultCount = getCodingFreshnessAffectedTaskResultCount(items);
    const taskResults = formatCodingFreshnessTaskResultCount(translate, taskResultCount);
    const taskResultVerb = taskResultCount === 1 ? translate('ui-text.coding-freshness-text.util.benoetigt') : translate('ui-text.coding-freshness-text.util.benoetigen');
    const responses = formatCodingFreshnessResponseCount(translate,
      getCodingFreshnessAffectedResponseCount(items)
    );
    return `${taskResults} ${taskResultVerb} ${getAutoCodingRequirementText(translate, items, version)}. ${
      translate('ui-text.coding-freshness-text.util.dabei-werden-beruecksichtigt', { value1: responses })}`;
  }

  const hasSameTaskResultCount = items.every(item => (
    normalizeCount(item.unitCount) === normalizeCount(items[0].unitCount)
  ));
  const hasSameResponseCount = items.every(item => (
    normalizeCount(item.affectedResponseCount) === normalizeCount(items[0].affectedResponseCount)
  ));

  if (hasSameTaskResultCount && hasSameResponseCount) {
    const taskResults = formatCodingFreshnessTaskResultCount(translate, items[0].unitCount);
    const responses = formatCodingFreshnessResponseCount(translate, items[0].affectedResponseCount);
    return `${translate('ui-text.coding-freshness-text.util.je-betroffenem-auto-coding-lauf-sind-in-zu-bearbeiten', { value1: responses, value2: taskResults }) +
      translate('ui-text.coding-freshness-text.util.muessen', { value1: formatVersionList(translate, versions) })
    }${getCombinedAutoCodingActionText(translate, items)}.`;
  }

  return translate('ui-text.coding-freshness-text.util.es-sind-auto-coding-aktualisierungen-offen', { value1: items.length }) +
    translate('ui-text.coding-freshness-text.util.die-chips-zeigen-je-auto-coding-lauf-wie-viele-aufgabenbearbeitungen-betroffen-sind');
}

function getManualReviewSummaryText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[]
): string {
  const taskResults = formatCodingFreshnessTaskResultCount(translate,
    getCodingFreshnessAffectedTaskResultCount(items)
  );
  const responses = formatCodingFreshnessResponseCount(translate,
    getCodingFreshnessAffectedResponseCount(items)
  );

  return translate('ui-text.coding-freshness-text.util.fuer-ist-die-manuelle-kodierung-nicht-aktuell', { value1: taskResults }) +
    translate('ui-text.coding-freshness-text.util.betroffen-sind', { value1: responses });
}

function getSingleCodingFreshnessActionText(translate: UiTranslator,
  item: CodingFreshnessSummaryItemDto,
  taskResults: string
): string {
  if ((item.version === 'v1' || item.version === 'v3') &&
    (item.state === 'PENDING' || item.state === 'STALE')) {
    return `${translate('ui-text.coding-freshness-text.util.muss-fuer', { value1: getCodingFreshnessVersionLabel(translate, item.version), value2: taskResults })
    }${getAutoCodingActionText(translate, [item], item.version)}`;
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return translate('ui-text.coding-freshness-text.util.fuer-ist-die-manuelle-kodierung-nicht-aktuell-0f3007', { value1: taskResults });
  }

  return translate('ui-text.coding-freshness-text.util.die-kodierung-muss-fuer-aktualisiert-werden', { value1: taskResults });
}

function getAutoCodingActionText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return translate('ui-text.coding-freshness-text.util.ausgefuehrt-werden');
  }

  if (states.size === 1 && states.has('STALE')) {
    return translate('ui-text.coding-freshness-text.util.aktualisiert-werden');
  }

  return translate('ui-text.coding-freshness-text.util.ausgefuehrt-oder-aktualisiert-werden');
}

function getAutoCodingRequirementText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const label = getCodingFreshnessVersionLabel(translate, version);
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return label;
  }

  if (states.size === 1 && states.has('STALE')) {
    return translate('ui-text.coding-freshness-text.util.eine-aktualisierung-von', { value1: label });
  }

  return translate('ui-text.coding-freshness-text.util.oder-eine-aktualisierung-davon', { value1: label });
}

function getAutoCodingButtonActionText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return translate('ui-text.coding-freshness-text.util.starten');
  }

  return translate('ui-text.coding-freshness-text.util.aktualisieren');
}

function getCombinedAutoCodingActionText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[]
): string {
  const states = new Set(items.map(item => item.state));
  if (states.size === 1 && states.has('PENDING')) {
    return translate('ui-text.coding-freshness-text.util.ausgefuehrt-werden');
  }

  if (states.size === 1 && states.has('STALE')) {
    return translate('ui-text.coding-freshness-text.util.aktualisiert-werden');
  }

  return translate('ui-text.coding-freshness-text.util.ausgefuehrt-oder-aktualisiert-werden');
}

function getChipActionText(translate: UiTranslator, item: CodingFreshnessSummaryItemDto): string {
  if (item.version === 'v1' || item.version === 'v3') {
    return item.state === 'PENDING' ? translate('ui-text.coding-freshness-text.util.starten') : translate('ui-text.coding-freshness-text.util.aktualisieren');
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return translate('ui-text.coding-freshness-text.util.aktualisieren');
  }

  return getCodingFreshnessStateLabel(translate, item.state);
}

function formatVersionList(translate: UiTranslator,
  versions: Array<Extract<CodingFreshnessVersion, 'v1' | 'v3'>>
): string {
  const labels = versions.map(version => getCodingFreshnessVersionLabel(translate, version));
  if (labels.length <= 1) {
    return labels[0] || 'Auto-Coding';
  }

  return translate('ui-text.coding-freshness-text.util.und', { value1: labels.slice(0, -1).join(', '), value2: labels[labels.length - 1] });
}

function normalizeCount(count: number): number {
  const parsed = Number(count || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
