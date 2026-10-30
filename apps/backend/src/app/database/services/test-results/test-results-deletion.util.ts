import {
  ObjectLiteral,
  SelectQueryBuilder
} from 'typeorm';
import {
  TestResultsDeleteRequestDto,
  TestResultsDeleteScope,
  TestResultsResponseCleanupRequestDto,
  TestResultsResponseCleanupSampleDto
} from '../../../../../../../api-dto/test-results/test-results-deletion.dto';
import {
  DeleteDependencySnapshot, NormalizedResponseCleanupRequest, ResponseCleanupTargetRow, TestResultsDeleteTargetKind
} from './workspace-test-results.types';

export function responseMatchesChunkCondition(
  chunkAlias: string,
  responseAlias: string
): string {
  return `(
      ${responseAlias}.variableid = ANY(string_to_array(COALESCE(${chunkAlias}.variables, ''), ','))
      OR (
        COALESCE(${chunkAlias}.variables, '') = ''
        AND COALESCE(${chunkAlias}.key, '') = COALESCE(${responseAlias}.subform, '')
      )
    )`;
}

export function mergeDeleteDependencySnapshot(
  target: DeleteDependencySnapshot,
  source: DeleteDependencySnapshot
): void {
  target.bookletIds.push(...source.bookletIds);
  target.unitIds.push(...source.unitIds);
  target.responseIds.push(...source.responseIds);
  target.bookletInfoIds.push(...source.bookletInfoIds);
}

export function dedupeDeleteDependencySnapshot(
  snapshot: DeleteDependencySnapshot
): DeleteDependencySnapshot {
  return {
    bookletIds: uniqueIds(snapshot.bookletIds),
    unitIds: uniqueIds(snapshot.unitIds),
    responseIds: uniqueIds(snapshot.responseIds),
    bookletInfoIds: uniqueIds(
      snapshot.bookletInfoIds
    )
  };
}

export function rawRowsToIds(
  rows: Array<{ id: number | string | null | undefined }>
): number[] {
  return uniqueIds(
    rows
      .map(row => Number(row.id))
      .filter(id => Number.isInteger(id) && id > 0)
  );
}

export function uniqueIds(ids: number[]): number[] {
  return Array.from(new Set(ids));
}

export function applyDeleteTargetFilter(
  query: SelectQueryBuilder<ObjectLiteral>,
  kind: TestResultsDeleteTargetKind,
  ids: number[]
): void {
  switch (kind) {
    case 'persons':
      query.where('person.id IN (:...ids)', { ids });
      break;
    case 'booklets':
      query.where('booklet.id IN (:...ids)', { ids });
      break;
    case 'units':
      query.where('unit.id IN (:...ids)', { ids });
      break;
    default:
      query.where('1 = 0');
  }
}

export function normalizeDeleteRequest(
  request: TestResultsDeleteRequestDto
): Required<TestResultsDeleteRequestDto> {
  return {
    scope: request.scope,
    personIds: normalizeNumberList(request.personIds),
    searchText: String(request.searchText || '').trim(),
    groups: normalizeStringList(request.groups),
    bookletNames: normalizeStringList(request.bookletNames),
    unitNames: normalizeStringList(request.unitNames)
  };
}

export function normalizeResponseCleanupRequest(
  request: TestResultsResponseCleanupRequestDto
): NormalizedResponseCleanupRequest {
  return {
    unitNames: normalizeStringList(request.unitNames)
      .map(normalizeUnitKey),
    answeredBefore:
        normalizeCleanupTimestamp(
          request.answeredBefore
        ),
    answeredFrom:
        normalizeCleanupTimestamp(
          request.answeredFrom
        ),
    variableIds:
        normalizeStringList(request.variableIds),
    subforms: normalizeStringList(
      request.subforms
    )
  };
}

export function normalizeCleanupTimestamp(
  value?: string | number
): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }

  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    return Math.round(numericValue);
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function normalizeNumberList(value?: number[] | string): number[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return values
    .map(v => Number(v))
    .filter(v => Number.isInteger(v) && v > 0);
}

export function normalizeStringList(value?: string[] | string): string[] {
  if (!value) return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return Array.from(
    new Set(
      values
        .map(v => String(v || '').trim())
        .filter(v => v.length > 0)
    )
  );
}

export function normalizeUnitKey(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\.XML$/i, '');
}

export function toPreviewList(value?: string[] | string | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(v => String(v)).filter(v => v.length > 0);
  }
  return String(value)
    .replace(/^{|}$/g, '')
    .split(',')
    .map(v => v.replace(/^"|"$/g, '').trim())
    .filter(v => v.length > 0);
}

export function limitPreviewStrings(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map(value => String(value || '').trim())
        .filter(Boolean)
    )
  ).slice(0, 30);
}

export function toResponseCleanupSample(
  row: ResponseCleanupTargetRow
): TestResultsResponseCleanupSampleDto {
  return {
    responseId: row.responseId,
    personId: row.personId,
    personCode: row.personCode,
    personLogin: row.personLogin,
    personGroup: row.personGroup,
    bookletId: row.bookletId,
    bookletName: row.bookletName,
    unitId: row.unitId,
    unitName: row.unitName,
    variableId: row.variableId,
    subform: row.subform,
    value: row.value,
    answeredAt: row.answeredAt,
    timestampSource: row.timestampSource
  };
}

export function getDeleteLabel(
  request: Required<TestResultsDeleteRequestDto>
): string {
  switch (request.scope as TestResultsDeleteScope) {
    case 'persons':
      return `${request.personIds.length} ausgewählte Testperson(en)`;
    case 'filteredPersons':
      return request.searchText ?
        `alle Testpersonen mit Filter "${request.searchText}"` :
        'alle Testpersonen des Arbeitsbereichs (alle Seiten)';
    case 'filteredGroups':
      return request.searchText ?
        `alle Testgruppen mit Treffern für Filter "${request.searchText}" (einschließlich aller Gruppenmitglieder)` :
        'alle Testgruppen des Arbeitsbereichs (alle Seiten)';
    case 'groups':
      return `Testgruppe(n): ${request.groups.join(', ')}`;
    case 'booklets':
      return `Testheft(e): ${request.bookletNames.join(', ')}`;
    case 'units':
      return `Aufgabe(n): ${request.unitNames.join(', ')}`;
    default:
      return 'Testergebnisdaten';
  }
}

export function getResponseCleanupLabel(
  request: NormalizedResponseCleanupRequest
): string {
  const unitLabel = request.unitNames.length > 0 ?
    `Aufgabe(n): ${request.unitNames.join(', ')}` :
    'Antworten';
  const beforeLabel = request.answeredBefore ?
    `vor ${new Date(request.answeredBefore).toLocaleString('de-DE')}` :
    'ohne gültigen Stichtag';
  const fromLabel = request.answeredFrom ?
    `ab ${new Date(request.answeredFrom).toLocaleString('de-DE')}` :
    '';
  const variableLabel = request.variableIds.length > 0 ?
    `, Variable(n): ${request.variableIds.join(', ')}` :
    ', alle Variablen';
  const subformLabel = request.subforms.length > 0 ?
    `, Subform(s): ${request.subforms.join(', ')}` :
    '';

  return `${unitLabel} ${fromLabel} ${beforeLabel}${variableLabel}${subformLabel}`.replace(/\s+/g, ' ').trim();
}

export function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
