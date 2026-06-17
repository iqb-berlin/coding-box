type ReplayDataParts = Record<string, string>;
type UnknownRecord = Record<string, unknown>;

const TEXT_AREA_MATH_TYPE = 'text-area-math';
const MATH_TEXT_MIX_FORMAT = 'math-text-mix';
const ID_KEYS = [
  'id',
  'alias',
  'variableId',
  'variable',
  'responseId',
  'responseIdentifier',
  'elementAlias',
  'dataElementAlias',
  'data-element-alias'
];
const ATTRIBUTE_KEYS = ['$', 'attributes', '_attributes'];
const TYPE_KEYS = ['type', 'elementType', 'dataElementType', 'data-element-type', 'aspectType', 'data-aspect-type'];

export function normalizeMathTextReplayDataParts(
  dataParts: ReplayDataParts,
  unitDefinition: unknown
): ReplayDataParts {
  const mathTextResponseIds = getMathTextResponseIds(unitDefinition);
  if (mathTextResponseIds.size === 0) {
    return dataParts;
  }

  let hasChanges = false;
  const normalizedDataParts = Object.entries(dataParts).reduce<ReplayDataParts>((acc, [chunkId, content]) => {
    const normalizedContent = normalizeReplayChunkContent(content, mathTextResponseIds);
    if (normalizedContent !== content) {
      hasChanges = true;
    }
    acc[chunkId] = normalizedContent;
    return acc;
  }, {});

  return hasChanges ? normalizedDataParts : dataParts;
}

export function getMathTextResponseIds(unitDefinition: unknown): Set<string> {
  const responseIds = new Set<string>();
  collectMathTextResponseIds(unitDefinition, responseIds, new Set<unknown>());
  return responseIds;
}

function collectMathTextResponseIds(
  value: unknown,
  responseIds: Set<string>,
  visited: Set<unknown>
): void {
  if (!value || typeof value !== 'object' || visited.has(value)) {
    return;
  }
  visited.add(value);

  if (Array.isArray(value)) {
    value.forEach(item => collectMathTextResponseIds(item, responseIds, visited));
    return;
  }

  const record = value as UnknownRecord;
  if (isMathTextDefinition(record)) {
    getCandidateResponseIds(record).forEach(id => responseIds.add(id));
  }

  Object.values(record).forEach(child => collectMathTextResponseIds(child, responseIds, visited));
}

function isMathTextDefinition(record: UnknownRecord): boolean {
  return getAttributeRecords(record).some(attributeRecord => {
    const format = getStringValue(attributeRecord, 'format');
    if (format?.trim().toLowerCase() === MATH_TEXT_MIX_FORMAT) {
      return true;
    }

    return TYPE_KEYS.some(key => getStringValue(attributeRecord, key)?.trim().toLowerCase() === TEXT_AREA_MATH_TYPE);
  });
}

function getCandidateResponseIds(record: UnknownRecord): string[] {
  const ids: string[] = [];
  getAttributeRecords(record).forEach(attributeRecord => {
    ID_KEYS.forEach(key => {
      const id = getStringValue(attributeRecord, key)?.trim();
      if (id) {
        ids.push(id);
      }
    });
  });
  return ids;
}

function getAttributeRecords(record: UnknownRecord): UnknownRecord[] {
  const records = [record];
  ATTRIBUTE_KEYS.forEach(key => {
    const value = record[key];
    if (isRecord(value)) {
      records.push(value);
    }
  });
  return records;
}

function normalizeReplayChunkContent(content: string, mathTextResponseIds: Set<string>): string {
  try {
    const parsedContent = JSON.parse(content);
    const normalized = normalizeChunkResponses(parsedContent, mathTextResponseIds);
    return normalized.hasChanges ? JSON.stringify(normalized.value) : content;
  } catch {
    return content;
  }
}

function normalizeChunkResponses(
  content: unknown,
  mathTextResponseIds: Set<string>
): { value: unknown; hasChanges: boolean } {
  if (Array.isArray(content)) {
    let hasChanges = false;
    const value = content.map(response => {
      const normalized = normalizeResponseValue(response, mathTextResponseIds);
      hasChanges = hasChanges || normalized.hasChanges;
      return normalized.value;
    });
    return { value, hasChanges };
  }

  const normalized = normalizeResponseValue(content, mathTextResponseIds);
  return normalized.hasChanges ? normalized : { value: content, hasChanges: false };
}

function normalizeResponseValue(
  response: unknown,
  mathTextResponseIds: Set<string>
): { value: unknown; hasChanges: boolean } {
  if (!isRecord(response)) {
    return { value: response, hasChanges: false };
  }

  const responseId = getStringValue(response, 'id');
  if (!responseId || !mathTextResponseIds.has(responseId) || !Array.isArray(response.value)) {
    return { value: response, hasChanges: false };
  }

  return {
    value: {
      ...response,
      value: JSON.stringify(response.value)
    },
    hasChanges: true
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getStringValue(record: UnknownRecord, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}
