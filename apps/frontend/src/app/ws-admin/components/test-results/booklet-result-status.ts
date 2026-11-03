import {
  Booklet, BookletLog, Unit, UnitResult
} from './test-results.models';

export function calculateBookletProcessingTime(booklet: Booklet): number | null {
  if (
    !booklet.logs ||
      !Array.isArray(booklet.logs) ||
      booklet.logs.length === 0
  ) {
    return null;
  }

  const pollingLog = booklet.logs.find(
    (log: BookletLog) => log.key === 'CONTROLLER' && log.parameter === 'RUNNING'
  );
  const terminatedLog = booklet.logs.find(
    (log: BookletLog) => log.key === 'CONTROLLER' && log.parameter === 'TERMINATED'
  );
  if (pollingLog && terminatedLog) {
    const pollingTime = Number(pollingLog.ts);
    const terminatedTime = Number(terminatedLog.ts);

    if (!Number.isNaN(pollingTime) && !Number.isNaN(terminatedTime)) {
      return terminatedTime - pollingTime;
    }
  }

  return null;
}

export function isBookletComplete(booklet: Booklet): boolean {
  if (
    !booklet.logs ||
      !Array.isArray(booklet.logs) ||
      booklet.logs.length === 0
  ) {
    return true;
  }

  if (
    !booklet.units ||
      !Array.isArray(booklet.units) ||
      booklet.units.length === 0
  ) {
    return false;
  }
  const unitIdLogs = booklet.logs.filter(
    (log: BookletLog) => log.key === 'CURRENT_UNIT_ID'
  );
  const unitAliases = booklet.units
    .map((unit: Unit) => unit.alias)
    .filter((alias: string | null) => alias !== null) as string[];

  const allUnitsVisited = unitAliases.every((alias: string) => unitIdLogs.some((log: BookletLog) => log.parameter === alias)
  );

  return allUnitsVisited && unitAliases.length > 0;
}

export function hasGeogebraResponse(unit: Unit): boolean {
  if (!unit || !unit.results || !Array.isArray(unit.results)) {
    return false;
  }

  return unit.results.some(
    (response: UnitResult) => response.value && response.value.startsWith('UEsD')
  );
}

export function responseStatusColor(status: string): string {
  switch (status) {
    case 'VALUE_CHANGED':
      return 'green';
    case 'NOT_REACHED':
      return 'blue';
    case 'CODING_INCOMPLETE':
      return 'red';
    case 'CODING_COMPLETE':
      return 'violet';
    default:
      return 'lightgrey';
  }
}

export function hasShortBookletProcessingTime(booklet: Booklet, thresholdMs: number): boolean {
  if (
    !booklet.logs ||
      !Array.isArray(booklet.logs) ||
      booklet.logs.length === 0
  ) {
    return false;
  }

  const processingTime = calculateBookletProcessingTime(booklet);
  return (
    processingTime === null ||
      processingTime < thresholdMs
  );
}
