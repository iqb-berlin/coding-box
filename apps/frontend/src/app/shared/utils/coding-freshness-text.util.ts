import { UiTranslator } from './ui-translator';
import {
  CodingFreshnessState,
  CodingFreshnessSummaryItemDto,
  CodingFreshnessVersion
} from '../../../../../../api-dto/coding/coding-freshness.dto';

export const CODING_FRESHNESS_TASK_RESULT_HELP_KEY =
  'ui-text.coding-freshness.task-result-help';

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
    v1: translate('ui-text.coding-freshness-text.first-autocoding'),
    v2: translate('ws-admin.manual-coding'),
    v3: translate('ui-text.coding-freshness-text.second-autocoding')
  };
  return labels[version];
}

export function getCodingFreshnessStateLabel(translate: UiTranslator, state: CodingFreshnessState): string {
  const labels: Record<CodingFreshnessState, string> = {
    CURRENT: translate('ui-text.coding-freshness-text.current'),
    PENDING: translate('ui-text.coding-freshness-text.pending'),
    STALE: translate('ui-text.coding-freshness-text.stale'),
    MANUAL_REVIEW_REQUIRED: translate('ui-text.coding-freshness-text.stale')
  };
  return labels[state];
}

export function formatCodingFreshnessTaskResultCount(translate: UiTranslator, count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? translate('ui-text.coding-management.task-result-singular') : translate('ui-text.coding-management.task-result-plural')}`;
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
    return translate('ui-text.coding-freshness-text.current-title');
  }

  const autoCodingWarnings = getCodingFreshnessAutoCodingWarnings(warnings);
  const manualReviewWarnings = getCodingFreshnessManualReviewWarnings(warnings);

  if (autoCodingWarnings.length > 0 && manualReviewWarnings.length === 0) {
    const autoCodingStates = new Set(autoCodingWarnings.map(item => item.state));
    if (autoCodingStates.size === 1 && autoCodingStates.has('PENDING')) {
      return translate('ui-text.coding-freshness-text.start-autocoding');
    }

    if (autoCodingStates.size === 1 && autoCodingStates.has('STALE')) {
      return translate('ui-text.coding-freshness-text.refresh-autocoding');
    }

    return translate('ui-text.coding-freshness-text.start-or-refresh-autocoding');
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
    return translate('ui-text.coding-freshness-text.autocoding-first-hint');
  }

  return translate('ui-text.coding-freshness-text.manual-review-hint');
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

  return translate('ui-text.coding-freshness-text.multiple-steps') +
    translate('ui-text.coding-freshness-text.step-chips-hint');
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

  return translate('ui-text.coding-freshness-text.autocoding-button', { value1: getCodingFreshnessVersionLabel(translate, version), value2: formatCodingFreshnessTaskResultCount(translate, count), value3: action });
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
    const taskResultVerb = taskResultCount === 1 ? translate('ui-text.coding-freshness-text.requires-singular') : translate('ui-text.coding-freshness-text.requires-plural');
    const responses = formatCodingFreshnessResponseCount(translate,
      getCodingFreshnessAffectedResponseCount(items)
    );
    return `${taskResults} ${taskResultVerb} ${getAutoCodingRequirementText(translate, items, version)}. ${
      translate('ui-text.coding-freshness-text.affected-responses', { value1: responses })}`;
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
    return `${translate('ui-text.coding-freshness-text.autocoding-per-run', { value1: responses, value2: taskResults }) +
      translate('ui-text.coding-freshness-text.version-requirement', { value1: formatVersionList(translate, versions) })
    }${getCombinedAutoCodingActionText(translate, items)}.`;
  }

  return translate('ui-text.coding-freshness-text.multiple-autocoding-runs', { value1: items.length }) +
    translate('ui-text.coding-freshness-text.autocoding-chips-hint');
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

  return translate('ui-text.coding-freshness-text.manual-stale', { value1: taskResults }) +
    translate('ui-text.coding-freshness-text.affected-response-detail', { value1: responses });
}

function getSingleCodingFreshnessActionText(translate: UiTranslator,
  item: CodingFreshnessSummaryItemDto,
  taskResults: string
): string {
  if ((item.version === 'v1' || item.version === 'v3') &&
    (item.state === 'PENDING' || item.state === 'STALE')) {
    return `${translate('ui-text.coding-freshness-text.version-action', { value1: getCodingFreshnessVersionLabel(translate, item.version), value2: taskResults })
    }${getAutoCodingActionText(translate, [item], item.version)}`;
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return translate('ui-text.coding-freshness-text.manual-stale-action', { value1: taskResults });
  }

  return translate('ui-text.coding-freshness-text.refresh-action', { value1: taskResults });
}

function getAutoCodingActionText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return translate('ui-text.coding-freshness-text.execute-action');
  }

  if (states.size === 1 && states.has('STALE')) {
    return translate('ui-text.coding-freshness-text.update-action');
  }

  return translate('ui-text.coding-freshness-text.execute-or-update-action');
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
    return translate('ui-text.coding-freshness-text.version-update', { value1: label });
  }

  return translate('ui-text.coding-freshness-text.version-or-update', { value1: label });
}

function getAutoCodingButtonActionText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return translate('ui-text.coding-freshness-text.start');
  }

  return translate('ui-text.coding-freshness-text.update');
}

function getCombinedAutoCodingActionText(translate: UiTranslator,
  items: CodingFreshnessSummaryItemDto[]
): string {
  const states = new Set(items.map(item => item.state));
  if (states.size === 1 && states.has('PENDING')) {
    return translate('ui-text.coding-freshness-text.execute-action');
  }

  if (states.size === 1 && states.has('STALE')) {
    return translate('ui-text.coding-freshness-text.update-action');
  }

  return translate('ui-text.coding-freshness-text.execute-or-update-action');
}

function getChipActionText(translate: UiTranslator, item: CodingFreshnessSummaryItemDto): string {
  if (item.version === 'v1' || item.version === 'v3') {
    return item.state === 'PENDING' ? translate('ui-text.coding-freshness-text.start') : translate('ui-text.coding-freshness-text.update');
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return translate('ui-text.coding-freshness-text.update');
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

  return translate('ui-text.coding-freshness-text.version-list', { value1: labels.slice(0, -1).join(', '), value2: labels[labels.length - 1] });
}

function normalizeCount(count: number): number {
  const parsed = Number(count || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
