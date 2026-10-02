import { SelectQueryBuilder } from 'typeorm';

export type ResolvedWorkspaceExclusions = {
  globalIgnoredUnits: string[];
  ignoredBooklets: string[];
  testletIgnoredUnits: { bookletId: string; unitId: string }[];
};

export type ExclusionQueryOptions = {
  unitAlias?: string | null;
  bookletInfoAlias?: string | null;
  unitNameExpression?: string | null;
  bookletNameExpression?: string | null;
  parameterPrefix?: string;
};

export const normalizeExclusionUnitId = (
  value: string | null | undefined
): string => String(value || '').trim().toUpperCase().replace(/\.XML$/i, '');

export const normalizeExclusionBookletId = (
  value: string | null | undefined
): string => String(value || '').trim().toUpperCase();

const normalizedUnitSql = (expression: string): string => (
  `REGEXP_REPLACE(UPPER(${expression}), '\\.XML$', '', 'i')`
);

export function isExcludedByResolvedExclusions(
  exclusions: ResolvedWorkspaceExclusions,
  bookletName: string | null | undefined,
  unitName: string | null | undefined
): boolean {
  const normalizedUnit = normalizeExclusionUnitId(unitName);
  const normalizedBooklet = normalizeExclusionBookletId(bookletName);

  if (
    normalizedUnit &&
    exclusions.globalIgnoredUnits.map(normalizeExclusionUnitId)
      .includes(normalizedUnit)
  ) {
    return true;
  }

  if (
    normalizedBooklet &&
    exclusions.ignoredBooklets.map(normalizeExclusionBookletId)
      .includes(normalizedBooklet)
  ) {
    return true;
  }

  if (normalizedBooklet && normalizedUnit) {
    return exclusions.testletIgnoredUnits.some(t => (
      normalizeExclusionBookletId(t.bookletId) === normalizedBooklet &&
      normalizeExclusionUnitId(t.unitId) === normalizedUnit
    ));
  }

  return false;
}

export function applyResolvedExclusionsToQuery<T>(
  qb: SelectQueryBuilder<T>,
  exclusions: ResolvedWorkspaceExclusions,
  options: ExclusionQueryOptions = {}
): void {
  let unitExpression: string | null | undefined;
  if (options.unitNameExpression !== undefined) {
    unitExpression = options.unitNameExpression;
  } else {
    unitExpression = options.unitAlias === null ?
      null :
      `${options.unitAlias || 'unit'}.name`;
  }

  let bookletExpression: string | null | undefined;
  if (options.bookletNameExpression !== undefined) {
    bookletExpression = options.bookletNameExpression;
  } else {
    bookletExpression = options.bookletInfoAlias === null ?
      null :
      `${options.bookletInfoAlias || 'bookletinfo'}.name`;
  }
  const prefix = options.parameterPrefix || 'workspaceExclusion';

  if (unitExpression && exclusions.globalIgnoredUnits.length > 0) {
    qb.andWhere(
      `${normalizedUnitSql(unitExpression)} NOT IN (:...${prefix}IgnoredUnits)`,
      {
        [`${prefix}IgnoredUnits`]: exclusions.globalIgnoredUnits
          .map(normalizeExclusionUnitId)
      }
    );
  }

  if (bookletExpression && exclusions.ignoredBooklets.length > 0) {
    qb.andWhere(
      `UPPER(${bookletExpression}) NOT IN (:...${prefix}IgnoredBooklets)`,
      {
        [`${prefix}IgnoredBooklets`]: exclusions.ignoredBooklets
          .map(normalizeExclusionBookletId)
      }
    );
  }

  if (
    unitExpression &&
    bookletExpression &&
    exclusions.testletIgnoredUnits.length > 0
  ) {
    const condition = exclusions.testletIgnoredUnits
      .map((_, i: number) => (
        `(UPPER(${bookletExpression}) = :${prefix}Booklet${i} AND ${normalizedUnitSql(unitExpression)} = :${prefix}Unit${i})`
      ))
      .join(' OR ');
    const params: Record<string, string> = {};
    exclusions.testletIgnoredUnits.forEach((t, i: number) => {
      params[`${prefix}Booklet${i}`] = normalizeExclusionBookletId(t.bookletId);
      params[`${prefix}Unit${i}`] = normalizeExclusionUnitId(t.unitId);
    });
    qb.andWhere(`NOT (${condition})`, params);
  }
}
