export function sanitizeJobData(data: unknown): Record<string, unknown> | undefined {
  if (!data || typeof data !== 'object') return undefined;

  const source = data as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  const scalarKeys = [
    'workspaceId',
    'operation',
    'acpId',
    'taskId',
    'resultType',
    'overwriteExisting',
    'personMatchMode',
    'overwriteMode',
    'scope',
    'exportType',
    'version',
    'format',
    'source',
    'autoCoderRun',
    'freshnessVersion',
    'processingDurationThresholdMs',
    'missingsProfile',
    'unitId',
    'variableId',
    'fileName',
    'sourceFormat',
    'sourceVersion',
    'scoreMode',
    'existingCodingMode',
    'validationType',
    'progressMessage',
    'isPaused',
    'isCancelled'
  ];

  scalarKeys.forEach(key => {
    const value = source[key];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = value;
    }
  });

  const file = source.file as { originalname?: unknown } | undefined;
  if (file && typeof file.originalname === 'string') {
    sanitized.fileName = file.originalname;
  }

  [
    ['fileIds', 'fileCount'],
    ['personIds', 'personCount'],
    ['unitIds', 'unitCount'],
    ['groupNames', 'groupCount'],
    ['jobDefinitionIds', 'jobDefinitionCount'],
    ['coderTrainingIds', 'coderTrainingCount'],
    ['coderIds', 'coderCount'],
    ['matchingFlags', 'matchingFlagCount']
  ].forEach(([sourceKey, targetKey]) => {
    const value = source[sourceKey];
    if (Array.isArray(value)) {
      sanitized[targetKey] = value.length;
    }
  });

  return Object.keys(sanitized).length ? sanitized : undefined;
}

export function overviewProgress(queueName: string, raw: unknown): { progress: unknown; message?: string } {
  if (queueName !== 'content-pool' || !raw || typeof raw !== 'object') return { progress: raw };
  const data = raw as { progress?: unknown; message?: unknown };
  return { progress: data.progress, message: typeof data.message === 'string' ? data.message : undefined };
}
