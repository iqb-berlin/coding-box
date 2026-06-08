import {
  CodingFreshnessState,
  CodingFreshnessSummaryItemDto,
  CodingFreshnessVersion
} from '../../../../../../api-dto/coding/coding-freshness.dto';

export const CODING_FRESHNESS_TASK_RESULT_HELP =
  'Eine Aufgabenbearbeitung meint eine Aufgabe, die eine bestimmte Testperson in einem Testheft bearbeitet hat. Eine Aufgabenbearbeitung kann mehrere Antwortwerte enthalten.';

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

export function getCodingFreshnessVersionLabel(version: CodingFreshnessVersion): string {
  const labels: Record<CodingFreshnessVersion, string> = {
    v1: 'Auto-Coding 1',
    v2: 'Manuelle Kodierung',
    v3: 'Auto-Coding 2'
  };
  return labels[version];
}

export function getCodingFreshnessStateLabel(state: CodingFreshnessState): string {
  const labels: Record<CodingFreshnessState, string> = {
    CURRENT: 'aktuell',
    PENDING: 'zu kodieren',
    STALE: 'zu aktualisieren',
    MANUAL_REVIEW_REQUIRED: 'zu prüfen'
  };
  return labels[state];
}

export function formatCodingFreshnessTaskResultCount(count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? 'Aufgabenbearbeitung' : 'Aufgabenbearbeitungen'}`;
}

export function formatCodingFreshnessResponseCount(count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? 'Antwortwert' : 'Antwortwerte'}`;
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

export function getCodingFreshnessAttentionTitle(
  items: CodingFreshnessSummaryItemDto[]
): string {
  const warnings = items.filter(isCodingFreshnessOpenWarning);
  if (warnings.length === 0) {
    return 'Kodierstand aktuell';
  }

  const autoCodingWarnings = getCodingFreshnessAutoCodingWarnings(warnings);
  const manualReviewWarnings = getCodingFreshnessManualReviewWarnings(warnings);

  if (autoCodingWarnings.length > 0 && manualReviewWarnings.length === 0) {
    const autoCodingStates = new Set(autoCodingWarnings.map(item => item.state));
    if (autoCodingStates.size === 1 && autoCodingStates.has('PENDING')) {
      return 'Auto-Coding starten';
    }

    if (autoCodingStates.size === 1 && autoCodingStates.has('STALE')) {
      return 'Auto-Coding aktualisieren';
    }

    return 'Auto-Coding starten oder aktualisieren';
  }

  if (autoCodingWarnings.length === 0 && manualReviewWarnings.length > 0) {
    return 'Manuelle Kodierung prüfen';
  }

  return 'Kodierstand prüfen';
}

export function getCodingFreshnessManualReviewGuidanceText(
  items: CodingFreshnessSummaryItemDto[]
): string {
  if (getCodingFreshnessManualReviewWarnings(items).length === 0) {
    return '';
  }

  if (getCodingFreshnessAutoCodingWarnings(items).length > 0) {
    return 'Aktualisieren Sie zuerst die offenen Auto-Coding-Schritte. Prüfen Sie danach die manuelle Kodierung.';
  }

  return 'Öffnen Sie die manuelle Prüfung und wenden Sie abgeschlossene Job-Ergebnisse erneut an oder kodieren Sie offene Fälle neu.';
}

export function getCodingFreshnessSummaryText(items: CodingFreshnessSummaryItemDto[]): string {
  const warnings = items.filter(isCodingFreshnessOpenWarning);
  if (warnings.length === 0) {
    return 'Für die aktuell berücksichtigten Testergebnisse gibt es keine offenen Aktualisierungshinweise.';
  }

  const autoCodingWarnings = getCodingFreshnessAutoCodingWarnings(warnings);
  const manualReviewWarnings = getCodingFreshnessManualReviewWarnings(warnings);

  if (autoCodingWarnings.length > 0 && manualReviewWarnings.length === 0) {
    return getAutoCodingSummaryText(autoCodingWarnings);
  }

  if (autoCodingWarnings.length === 0 && manualReviewWarnings.length > 0) {
    return getManualReviewSummaryText(manualReviewWarnings);
  }

  if (warnings.length === 1) {
    const taskResults = formatCodingFreshnessTaskResultCount(
      getCodingFreshnessAffectedTaskResultCount(warnings)
    );
    return getSingleCodingFreshnessActionText(warnings[0], taskResults);
  }

  return 'Es sind mehrere Kodierschritte offen. ' +
    'Die Chips zeigen je Kodierschritt, wie viele Aufgabenbearbeitungen betroffen sind.';
}

export function getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
  return `${getCodingFreshnessVersionLabel(item.version)}: ` +
    `${formatCodingFreshnessTaskResultCount(item.unitCount)} ${getChipActionText(item)}`;
}

export function getCodingFreshnessAutoCodingButtonLabel(
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const count = items
    .filter(item => item.version === version)
    .reduce((sum, item) => sum + normalizeCount(item.unitCount), 0);
  const action = getAutoCodingButtonActionText(items, version);

  return `${getCodingFreshnessVersionLabel(version)} für ${formatCodingFreshnessTaskResultCount(count)} ${action}`;
}

function getAutoCodingSummaryText(
  items: CodingFreshnessSummaryItemDto[]
): string {
  const versions = Array.from(
    new Set(items.map(item => item.version))
  ) as Array<Extract<CodingFreshnessVersion, 'v1' | 'v3'>>;

  if (versions.length === 1) {
    const [version] = versions;
    const taskResultCount = getCodingFreshnessAffectedTaskResultCount(items);
    const taskResults = formatCodingFreshnessTaskResultCount(taskResultCount);
    const taskResultVerb = taskResultCount === 1 ? 'benötigt' : 'benötigen';
    const responses = formatCodingFreshnessResponseCount(
      getCodingFreshnessAffectedResponseCount(items)
    );
    return `${taskResults} ${taskResultVerb} ${getAutoCodingRequirementText(items, version)}. ` +
      `Dabei werden ${responses} berücksichtigt.`;
  }

  const hasSameTaskResultCount = items.every(item => (
    normalizeCount(item.unitCount) === normalizeCount(items[0].unitCount)
  ));
  const hasSameResponseCount = items.every(item => (
    normalizeCount(item.affectedResponseCount) === normalizeCount(items[0].affectedResponseCount)
  ));

  if (hasSameTaskResultCount && hasSameResponseCount) {
    const taskResults = formatCodingFreshnessTaskResultCount(items[0].unitCount);
    const responses = formatCodingFreshnessResponseCount(items[0].affectedResponseCount);
    return `Je betroffenem Auto-Coding-Lauf sind ${responses} in ${taskResults} zu bearbeiten. ` +
      `${formatVersionList(versions)} müssen ` +
      `${getCombinedAutoCodingActionText(items)}.`;
  }

  return `Es sind ${items.length} Auto-Coding-Aktualisierungen offen. ` +
    'Die Chips zeigen je Auto-Coding-Lauf, wie viele Aufgabenbearbeitungen betroffen sind.';
}

function getManualReviewSummaryText(
  items: CodingFreshnessSummaryItemDto[]
): string {
  const taskResults = formatCodingFreshnessTaskResultCount(
    getCodingFreshnessAffectedTaskResultCount(items)
  );
  const responses = formatCodingFreshnessResponseCount(
    getCodingFreshnessAffectedResponseCount(items)
  );

  return `Die manuelle Kodierung muss für ${taskResults} geprüft werden. ` +
    `Das betrifft ${responses}.`;
}

function getSingleCodingFreshnessActionText(
  item: CodingFreshnessSummaryItemDto,
  taskResults: string
): string {
  if ((item.version === 'v1' || item.version === 'v3') &&
    (item.state === 'PENDING' || item.state === 'STALE')) {
    return `${getCodingFreshnessVersionLabel(item.version)} muss für ${taskResults} ` +
      `${getAutoCodingActionText([item], item.version)}`;
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return `Die manuelle Kodierung muss für ${taskResults} geprüft werden`;
  }

  return `Die Kodierung muss für ${taskResults} aktualisiert werden`;
}

function getAutoCodingActionText(
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return 'ausgeführt werden';
  }

  if (states.size === 1 && states.has('STALE')) {
    return 'aktualisiert werden';
  }

  return 'ausgeführt oder aktualisiert werden';
}

function getAutoCodingRequirementText(
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const label = getCodingFreshnessVersionLabel(version);
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return label;
  }

  if (states.size === 1 && states.has('STALE')) {
    return `eine Aktualisierung von ${label}`;
  }

  return `${label} oder eine Aktualisierung davon`;
}

function getAutoCodingButtonActionText(
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const states = new Set(items
    .filter(item => item.version === version)
    .map(item => item.state));

  if (states.size === 1 && states.has('PENDING')) {
    return 'starten';
  }

  return 'aktualisieren';
}

function getCombinedAutoCodingActionText(
  items: CodingFreshnessSummaryItemDto[]
): string {
  const states = new Set(items.map(item => item.state));
  if (states.size === 1 && states.has('PENDING')) {
    return 'ausgeführt werden';
  }

  if (states.size === 1 && states.has('STALE')) {
    return 'aktualisiert werden';
  }

  return 'ausgeführt oder aktualisiert werden';
}

function getChipActionText(item: CodingFreshnessSummaryItemDto): string {
  if (item.version === 'v1' || item.version === 'v3') {
    return item.state === 'PENDING' ? 'starten' : 'aktualisieren';
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return 'prüfen';
  }

  return getCodingFreshnessStateLabel(item.state);
}

function formatVersionList(
  versions: Array<Extract<CodingFreshnessVersion, 'v1' | 'v3'>>
): string {
  const labels = versions.map(version => getCodingFreshnessVersionLabel(version));
  if (labels.length <= 1) {
    return labels[0] || 'Auto-Coding';
  }

  return `${labels.slice(0, -1).join(', ')} und ${labels[labels.length - 1]}`;
}

function normalizeCount(count: number): number {
  const parsed = Number(count || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
