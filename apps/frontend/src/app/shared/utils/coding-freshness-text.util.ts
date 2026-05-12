import {
  CodingFreshnessState,
  CodingFreshnessSummaryItemDto,
  CodingFreshnessVersion
} from '../../../../../../api-dto/coding/coding-freshness.dto';

export const CODING_FRESHNESS_TASK_RESULT_HELP =
  'Ein Aufgaben-Ergebnis ist eine konkrete Aufgabe einer Testperson in einem Testheft; die Antwortzahl zählt die einzelnen Antwortwerte darin.';

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
    PENDING: 'neu zu kodieren',
    STALE: 'veraltet',
    MANUAL_REVIEW_REQUIRED: 'manuell zu prüfen'
  };
  return labels[state];
}

export function formatCodingFreshnessTaskResultCount(count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? 'Aufgaben-Ergebnis' : 'Aufgaben-Ergebnisse'}`;
}

export function formatCodingFreshnessResponseCount(count: number): string {
  const safeCount = normalizeCount(count);
  return `${safeCount} ${safeCount === 1 ? 'einzelne Antwort' : 'einzelne Antworten'}`;
}

export function getCodingFreshnessAffectedTaskResultCount(items: CodingFreshnessSummaryItemDto[]): number {
  return items.reduce((sum, item) => sum + normalizeCount(item.unitCount), 0);
}

export function getCodingFreshnessAffectedResponseCount(items: CodingFreshnessSummaryItemDto[]): number {
  return items.reduce((sum, item) => sum + normalizeCount(item.affectedResponseCount), 0);
}

export function getCodingFreshnessSummaryText(items: CodingFreshnessSummaryItemDto[]): string {
  const warnings = items.filter(item => item.state !== 'CURRENT' && normalizeCount(item.unitCount) > 0);
  if (warnings.length === 0) {
    return 'Für die aktuell berücksichtigten Testergebnisse gibt es keine offenen Aktualisierungshinweise.';
  }

  const taskResults = formatCodingFreshnessTaskResultCount(
    getCodingFreshnessAffectedTaskResultCount(warnings)
  );
  const responses = formatCodingFreshnessResponseCount(
    getCodingFreshnessAffectedResponseCount(warnings)
  );
  const singleAutoCodingVersion = getSingleAutoCodingVersion(warnings);
  if (singleAutoCodingVersion) {
    return `Für ${taskResults} muss ${getCodingFreshnessVersionLabel(singleAutoCodingVersion)} ` +
      `erneut ausgeführt werden. Das betrifft ${responses}.`;
  }

  if (warnings.length === 1) {
    return `${getSingleCodingFreshnessActionText(warnings[0], taskResults)}. Das betrifft ${responses}.`;
  }

  return `Für ${taskResults} muss die Kodierung geprüft oder aktualisiert werden. Das betrifft ${responses}.`;
}

export function getCodingFreshnessChipLabel(item: CodingFreshnessSummaryItemDto): string {
  return `${getCodingFreshnessVersionLabel(item.version)}: ` +
    `${getCodingFreshnessStateLabel(item.state)} (${formatCodingFreshnessTaskResultCount(item.unitCount)})`;
}

export function getCodingFreshnessAutoCodingButtonLabel(
  items: CodingFreshnessSummaryItemDto[],
  version: Extract<CodingFreshnessVersion, 'v1' | 'v3'>
): string {
  const count = items
    .filter(item => item.version === version)
    .reduce((sum, item) => sum + normalizeCount(item.unitCount), 0);

  return `${formatCodingFreshnessTaskResultCount(count)} mit ${getCodingFreshnessVersionLabel(version)} neu kodieren`;
}

function getSingleCodingFreshnessActionText(
  item: CodingFreshnessSummaryItemDto,
  taskResults: string
): string {
  if ((item.version === 'v1' || item.version === 'v3') &&
    (item.state === 'PENDING' || item.state === 'STALE')) {
    return `Für ${taskResults} muss ${getCodingFreshnessVersionLabel(item.version)} erneut ausgeführt werden`;
  }

  if (item.version === 'v2' || item.state === 'MANUAL_REVIEW_REQUIRED') {
    return `Für ${taskResults} muss die manuelle Kodierung geprüft werden`;
  }

  return `Für ${taskResults} muss die Kodierung aktualisiert werden`;
}

function getSingleAutoCodingVersion(
  items: CodingFreshnessSummaryItemDto[]
): Extract<CodingFreshnessVersion, 'v1' | 'v3'> | null {
  const versions = new Set<CodingFreshnessVersion>();
  for (const item of items) {
    const isAutoCodingRefresh = (item.version === 'v1' || item.version === 'v3') &&
      (item.state === 'PENDING' || item.state === 'STALE');
    if (!isAutoCodingRefresh) {
      return null;
    }
    versions.add(item.version);
  }

  if (versions.size !== 1) {
    return null;
  }

  const [version] = Array.from(versions);
  return version === 'v1' || version === 'v3' ? version : null;
}

function normalizeCount(count: number): number {
  const parsed = Number(count || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
