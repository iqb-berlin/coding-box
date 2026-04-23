import {
  ReplayHealthCheckResult,
  ReplayPayloadCandidate,
  ReplayUrlCandidate,
  ReplayUrlParts
} from './replay-health.types';

export function normalizePlayerId(name: string): string {
  const reg = /^(\D+?)[@V-]?((\d+)(\.\d+)?(\.\d+)?(-\S+?)?)?(.\D{3,4})?$/;
  const matches = name.match(reg);
  if (!matches) {
    throw new Error(`Invalid player id format: ${name}`);
  }

  const module = matches[1] || '';
  const major = parseInt(matches[3], 10) || 0;
  const minor =
    typeof matches[4] === 'string' ? parseInt(matches[4].substring(1), 10) : 0;
  const patch =
    typeof matches[5] === 'string' ? parseInt(matches[5].substring(1), 10) : 0;

  return `${module}-${major}.${minor}.${patch}`.toUpperCase();
}

export function parseReplayUrl(replayUrl: string): ReplayUrlParts | null {
  if (!replayUrl) {
    return null;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(replayUrl);
  } catch {
    return null;
  }

  const rawHash = parsedUrl.hash.startsWith('#') ?
    parsedUrl.hash.substring(1) :
    parsedUrl.hash;
  const hashPath = rawHash.split('?', 1)[0].replace(/^\/+/, '');
  const segments = hashPath.split('/');

  if (segments.length < 5 || segments[0] !== 'replay') {
    return null;
  }

  return {
    testPerson: decodeURIComponent(segments[1]),
    unitId: decodeURIComponent(segments[2]),
    page: decodeURIComponent(segments[3]),
    anchor: decodeURIComponent(segments[4])
  };
}

export function buildPayloadCandidates(
  workspaceId: number,
  replayUrls: ReplayUrlCandidate[]
): {
    payloadCandidates: ReplayPayloadCandidate[];
    parseFailures: ReplayHealthCheckResult[];
  } {
  const groupedCandidates = new Map<string, ReplayPayloadCandidate>();
  const parseFailures: ReplayHealthCheckResult[] = [];

  replayUrls.forEach(candidate => {
    const parsed = parseReplayUrl(candidate.replayUrl);

    if (!parsed) {
      parseFailures.push({
        ok: false,
        phase: 'payload',
        stage: 'parseReplayUrl',
        workspaceId,
        testPerson: '',
        unitId: '',
        replayUrl: candidate.replayUrl,
        responseIds: [candidate.responseId],
        occurrenceCount: 1,
        anchors: [candidate.variableId],
        message: 'Replay URL could not be parsed.'
      });
      return;
    }

    const key = `${parsed.testPerson}::${parsed.unitId}`;
    const existingCandidate = groupedCandidates.get(key);

    if (!existingCandidate) {
      groupedCandidates.set(key, {
        workspaceId,
        key,
        testPerson: parsed.testPerson,
        unitId: parsed.unitId,
        replayUrl: candidate.replayUrl,
        pages: [parsed.page],
        anchors: [parsed.anchor],
        responseIds: [candidate.responseId],
        occurrenceCount: 1
      });
      return;
    }

    if (!existingCandidate.pages.includes(parsed.page)) {
      existingCandidate.pages.push(parsed.page);
    }
    if (!existingCandidate.anchors.includes(parsed.anchor)) {
      existingCandidate.anchors.push(parsed.anchor);
    }
    existingCandidate.responseIds.push(candidate.responseId);
    existingCandidate.occurrenceCount += 1;
  });

  return {
    payloadCandidates: Array.from(groupedCandidates.values()),
    parseFailures
  };
}

export function summarizeFailuresByMessage(
  results: ReplayHealthCheckResult[]
): Array<{ message: string; count: number }> {
  const messageCounts = new Map<string, number>();

  results
    .filter(result => !result.ok && result.message)
    .forEach(result => {
      const message = result.message || 'Unknown error';
      messageCounts.set(message, (messageCounts.get(message) || 0) + 1);
    });

  return Array.from(messageCounts.entries())
    .map(([message, count]) => ({ message, count }))
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message));
}

export function summarizeFailuresByStage(
  results: ReplayHealthCheckResult[]
): Record<string, number> {
  const failures = results.filter(result => !result.ok);

  return failures.reduce<Record<string, number>>((accumulator, result) => {
    accumulator[result.stage] = (accumulator[result.stage] || 0) + 1;
    return accumulator;
  }, {});
}
