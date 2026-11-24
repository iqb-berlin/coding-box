interface PlayerReadyMessage {
  type: string;
  metadata?: unknown;
  apiVersion?: unknown;
  specVersion?: unknown;
}

export interface ReplayStateNotification {
  playerState?: { validPages?: unknown; currentPage?: string | number | null };
  unitState?: { presentationProgress?: string; responseProgress?: string; dataParts?: Record<string, string> };
}

function metadataVersion(metadata: unknown): unknown {
  let parsed: unknown = metadata;
  if (typeof metadata === 'string') {
    try {
      parsed = JSON.parse(metadata);
    } catch {
      return undefined;
    }
  }
  return parsed && typeof parsed === 'object' && 'specVersion' in parsed ? parsed.specVersion : undefined;
}

export function getPlayerApiVersion(message: PlayerReadyMessage): number {
  if (message.type === 'vo.FromPlayer.ReadyNotification') return 1;
  for (const version of [metadataVersion(message.metadata), message.apiVersion, message.specVersion]) {
    const major = typeof version === 'string' && version.match(/\d+/);
    if (major) return Number(major[0]);
  }
  return 2;
}

export function getReplayDisplayConfig(apiVersion: number, print: boolean) {
  if (apiVersion >= 7) {
    return print ? { pagingMode: 'CONCAT_SCROLL', printMode: 'ON' } : { pagingMode: 'BUTTONS' };
  }
  return {
    stateReportPolicy: 'eager',
    ...(print ? { pagingMode: 'concat-scroll', printMode: 'on' } : { pagingMode: 'buttons' })
  };
}
