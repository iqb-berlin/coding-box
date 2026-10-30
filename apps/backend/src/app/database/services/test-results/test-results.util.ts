import {
  ObjectLiteral,
  SelectQueryBuilder
} from 'typeorm';
import {
  assertValidRegexSearchPattern
} from '../../../utils/regex-search.util';
import { ResponseEntity } from '../../entities/response.entity';
import {
  applyResolvedExclusionsToQuery,
  normalizeExclusionBookletId
} from '../workspace/workspace-exclusion.service';
import {
  TextSearchFilter
} from './workspace-test-results.types';

export function createGeoGebraValueCondition(responseAlias: string): string {
  // Keep these fixed literals aligned with idx_response_geogebra_unit.
  // Bound pattern parameters cannot imply the partial index predicate in a generic plan.
  return `(${responseAlias}.value LIKE 'UEsD%' OR ${responseAlias}.value ILIKE 'data:%;base64,UEsD%')`;
}

export function createGeoGebraUnitExistsCondition(unitAlias: string): string {
  return `EXISTS (SELECT 1 FROM response r2 WHERE r2.unitid = ${unitAlias}.id AND ${createGeoGebraValueCondition('r2')})`;
}

export function parseQuotedExactSearchFilter(filter: string): TextSearchFilter {
  const trimmed = filter.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return {
      value: trimmed.slice(1, -1),
      exact: true
    };
  }

  return {
    value: filter,
    exact: false
  };
}

export function applyFlatResponseTextFilters(
  query: SelectQueryBuilder<ResponseEntity>,
  filters: {
    code: string;
    group: string;
    login: string;
    booklet: string;
    unit: string;
    response: string;
    regexSearch: boolean;
  }
): void {
  const {
    code,
    group,
    login,
    booklet,
    unit,
    response,
    regexSearch
  } = filters;

  if (regexSearch) {
    const codeRegex = assertValidRegexSearchPattern(code, 'code');
    if (codeRegex) {
      query.andWhere('person.code ~ :codeRegex', { codeRegex });
    }

    const groupRegex = assertValidRegexSearchPattern(group, 'group');
    if (groupRegex) {
      query.andWhere('person.group ~ :groupRegex', { groupRegex });
    }

    const loginRegex = assertValidRegexSearchPattern(login, 'login');
    if (loginRegex) {
      query.andWhere('person.login ~ :loginRegex', { loginRegex });
    }

    const bookletRegex = assertValidRegexSearchPattern(booklet, 'booklet');
    if (bookletRegex) {
      query.andWhere('bookletinfo.name ~ :bookletRegex', { bookletRegex });
    }

    const unitRegex = assertValidRegexSearchPattern(unit, 'unit');
    if (unitRegex) {
      query.andWhere(
        '(unit.alias ~ :unitRegex OR unit.name ~ :unitRegex)',
        { unitRegex }
      );
    }

    const responseRegex = assertValidRegexSearchPattern(response, 'response');
    if (responseRegex) {
      query.andWhere('response.variableid ~ :responseRegex', {
        responseRegex
      });
    }
    return;
  }

  if (code) {
    query.andWhere('person.code ILIKE :code', { code: `%${code}%` });
  }
  if (group) {
    query.andWhere('person.group ILIKE :group', { group: `%${group}%` });
  }
  if (login) {
    query.andWhere('person.login ILIKE :login', { login: `%${login}%` });
  }
  if (booklet) {
    query.andWhere('bookletinfo.name ILIKE :booklet', {
      booklet: `%${booklet}%`
    });
  }
  if (unit) {
    query.andWhere('(unit.alias ILIKE :unit OR unit.name ILIKE :unit)', {
      unit: `%${unit}%`
    });
  }
  if (response) {
    const responseFilter =
      parseQuotedExactSearchFilter(response);
    if (responseFilter.exact) {
      query.andWhere(
        'LOWER(response.variableid) = LOWER(:responseExact)',
        { responseExact: responseFilter.value }
      );
    } else {
      query.andWhere('response.variableid ILIKE :response', {
        response: `%${responseFilter.value}%`
      });
    }
  }
}

export function parseStoredResponseValue(value: string | null, variableId?: string): unknown {
  const normalizedVariableId = String(variableId || '').trim();
  const isMarkingPanel = normalizedVariableId.startsWith('marking-panel_');
  if (value === null || value === undefined) {
    if (isMarkingPanel) {
      return [];
    }
    return null;
  }

  const raw = String(value);
  const trimmed = raw.trim();
  if (trimmed === '') {
    return isMarkingPanel ? [] : '';
  }

  if (!isMarkingPanel) {
    // Most interactive controls persist values as JSON arrays.
    // Deserialize array payloads so replay players receive list-like values.
    if (!trimmed.startsWith('[')) {
      // Keep object/primitive payloads as stored text for non-marking variables.
      // Some players expect strings and perform their own parsing.
      return raw;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return raw;
      }

      const isPrimitiveArray = parsed.every(item => item === null ||
          ['string', 'number', 'boolean'].includes(typeof item)
      );

      return isPrimitiveArray ? parsed : raw;
    } catch {
      return raw;
    }
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      if (
        parsed.length > 0 &&
          parsed.every(token => typeof token === 'string' && /^\d+-\d+-#[0-9a-fA-F]{3,8}$/.test(token))
      ) {
        return [parsed];
      }
      return parsed;
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { marks?: unknown[] }).marks)) {
      return (parsed as { marks: unknown[] }).marks;
    }
    return [];
  } catch {
    return [];
  }
}

export function nonAutocoderGeneratedResponseCondition(responseAlias = 'response'): string {
  return `${responseAlias}.is_autocoder_generated IS NOT TRUE`;
}

export function excludeAutocoderGeneratedResponses(
  qb: SelectQueryBuilder<ObjectLiteral>,
  responseAlias = 'response'
): void {
  qb.andWhere(
    nonAutocoderGeneratedResponseCondition(
      responseAlias
    )
  );
}

export function applyExclusionsToQuery(qb: SelectQueryBuilder<ObjectLiteral>, exclusions: { globalIgnoredUnits: string[], ignoredBooklets: string[], testletIgnoredUnits: Array<{ bookletId: string, unitId: string }> }, options: { unitAlias?: string; bookletInfoAlias?: string } = {}) {
  applyResolvedExclusionsToQuery(qb, exclusions, options);
}

export function applyIgnoredBookletsToQuery(qb: SelectQueryBuilder<ObjectLiteral>, ignoredBooklets: string[], bookletInfoAlias = 'bookletinfo'): void {
  if (ignoredBooklets.length > 0) {
    qb.andWhere(`UPPER(${bookletInfoAlias}.name) NOT IN (:...ignoredBookletsOnly)`, {
      ignoredBookletsOnly: ignoredBooklets.map(normalizeExclusionBookletId)
    });
  }
}
