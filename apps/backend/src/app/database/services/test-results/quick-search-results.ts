import type { SelectQueryBuilder } from 'typeorm';
import type { ResponseEntity } from '../../entities/response.entity';
import { statusNumberToString } from '../../utils/response-status-converter';
import type { QuickSearchResult, QuickSearchResultKind } from './workspace-test-results.types';

type SearchRow = Record<string, string | number | null | undefined>;

export function formatQuickSearchResults(
  query: string,
  limit: number,
  rows: Record<QuickSearchResultKind, SearchRow[]>,
  totals: QuickSearchResult['totals']
): QuickSearchResult {
  const {
    person: personRows, booklet: bookletRows, unit: unitRows, response: responseRows
  } = rows;
  return {
    query,
    limit,
    persons: (personRows || []).map(row => ({
      kind: 'person',
      id: Number(row.personId),
      label: String(row.personCode || row.personLogin || row.personId),
      secondaryLabel: [row.personGroup, row.personLogin]
        .filter(Boolean)
        .join(' · '),
      personId: Number(row.personId),
      personCode: String(row.personCode || ''),
      personGroup: String(row.personGroup || ''),
      personLogin: String(row.personLogin || '')
    })),
    booklets: (bookletRows || []).map(row => ({
      kind: 'booklet',
      id: Number(row.bookletId),
      label: String(row.bookletName || row.bookletId),
      secondaryLabel: [row.personCode, row.personGroup, row.personLogin]
        .filter(Boolean)
        .join(' · '),
      personId: Number(row.personId),
      personCode: String(row.personCode || ''),
      personGroup: String(row.personGroup || ''),
      personLogin: String(row.personLogin || ''),
      bookletId: Number(row.bookletId),
      bookletName: String(row.bookletName || '')
    })),
    units: (unitRows || []).map(row => ({
      kind: 'unit',
      id: Number(row.unitId),
      label: String(row.unitAlias || row.unitName || row.unitId),
      secondaryLabel: [
        row.bookletName,
        row.unitAlias && row.unitAlias !== row.unitName ?
          row.unitName :
          '',
        row.personCode
      ]
        .filter(Boolean)
        .join(' · '),
      personId: Number(row.personId),
      personCode: String(row.personCode || ''),
      personGroup: String(row.personGroup || ''),
      personLogin: String(row.personLogin || ''),
      bookletId: Number(row.bookletId),
      bookletName: String(row.bookletName || ''),
      unitId: Number(row.unitId),
      unitName: String(row.unitName || ''),
      unitAlias: row.unitAlias == null ? null : String(row.unitAlias),
      responseId: row.responseId == null ? undefined : Number(row.responseId)
    })),
    responses: (responseRows || []).map(row => {
      const responseStatus = statusNumberToString(
        Number(row.responseStatus)
      ) || String(row.responseStatus ?? '');
      return {
        kind: 'response',
        id: Number(row.responseId),
        label: String(row.variableId || row.responseId),
        secondaryLabel: [
          row.bookletName,
          row.unitAlias || row.unitName,
          row.personCode,
          responseStatus
        ]
          .filter(Boolean)
          .join(' · '),
        personId: Number(row.personId),
        personCode: String(row.personCode || ''),
        personGroup: String(row.personGroup || ''),
        personLogin: String(row.personLogin || ''),
        bookletId: Number(row.bookletId),
        bookletName: String(row.bookletName || ''),
        unitId: Number(row.unitId),
        unitName: String(row.unitName || ''),
        unitAlias: row.unitAlias == null ? null : String(row.unitAlias),
        responseId: Number(row.responseId),
        variableId: String(row.variableId || ''),
        responseValue: String(row.responseValue || ''),
        responseStatus
      };
    }),
    totals
  };
}

export function selectQuickResponseRows(
  responseQb: SelectQueryBuilder<ResponseEntity>,
  validLimit: number,
  responsePreview: boolean
): Promise<SearchRow[]> {
  const rows = responseQb
    .clone()
    .select([
      'response.id AS "responseId"',
      'response.variableid AS "variableId"',
      'SUBSTRING(response.value, 1, 200) AS "responseValue"',
      'response.status AS "responseStatus"',
      'unit.id AS "unitId"',
      'unit.name AS "unitName"',
      'unit.alias AS "unitAlias"',
      'booklet.id AS "bookletId"',
      'bookletinfo.name AS "bookletName"',
      'person.id AS "personId"',
      'person.code AS "personCode"',
      'person.group AS "personGroup"',
      'person.login AS "personLogin"'
    ]);
  if (responsePreview) {
    return rows.limit(validLimit + 1).getRawMany();
  }
  return rows
    .orderBy('person.code', 'ASC')
    .addOrderBy('bookletinfo.name', 'ASC')
    .addOrderBy('COALESCE(unit.alias, unit.name)', 'ASC')
    .addOrderBy('response.variableid', 'ASC')
    .limit(validLimit)
    .getRawMany();
}
