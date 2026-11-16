import { DataSource, QueryRunner } from 'typeorm';
import { RESPONSE_VALUE_SEARCH_PREFIX_LENGTH } from './flat-response-filters';
import {
  applyResolvedExclusionsToQuery, ResolvedWorkspaceExclusions
} from '../workspace/workspace-exclusion-query.util';

type ProjectedPage = { number: number; size: number };
export type ResponsePageProjection = 'units' | 'totals' | 'compact' | 'value';

export async function findProjectedFlatResponsePage(
  connection: DataSource, workspaceId: number, exclusions: ResolvedWorkspaceExclusions,
  page: ProjectedPage, projection: ResponsePageProjection, responseValue: string, queryRunner?: QueryRunner
) {
  // The unit and totals scopes bind the same exclusions in the same order.
  const createScope = (table: string) => {
    const scope = connection.createQueryBuilder(queryRunner)
      .select('visible_unit.*')
      .from(table, 'visible_unit')
      .where('visible_unit.workspace_id = :workspaceId', { workspaceId })
      .andWhere('EXISTS (SELECT 1 FROM ready_workspace)');
    applyResolvedExclusionsToQuery(scope, exclusions, {
      unitNameExpression: 'visible_unit.unit_name',
      bookletNameExpression: 'visible_unit.booklet_name'
    });
    return scope;
  };
  const [sql, parameters] = createScope('flat_response_first_page_unit')
    .andWhere('visible_unit.consider IS TRUE')
    .getQueryAndParameters();
  const limit = `$${parameters.length + 1}`;
  const valueSearch = projection === 'value';
  const compact = projection === 'compact';
  const responseTable = compact ? 'flat_response_first_page_response' : 'response';
  const valueColumn = compact ? 'value_prefix' : `left(value, ${RESPONSE_VALUE_SEARCH_PREFIX_LENGTH}) AS value_prefix`;
  const readySearch = valueSearch ?
    'AND EXISTS (SELECT 1 FROM flat_response_value_search_workspace WHERE workspace_id = $1)' : '';
  const idQueries = valueSearch ?
    projectedValuePageIds(sql, limit, `$${parameters.length + 2}`, `$${parameters.length + 3}`) :
    projectedFirstPageIds(sql, limit, responseTable, compact);
  let total = `SELECT COALESCE(SUM(n.total), 0)
    FROM (${sql}) u JOIN flat_response_unit_count n ON n.unitid = u.unit_id`;
  if (valueSearch) {
    total = 'SELECT COUNT(*) FROM projected_value_matches';
  } else if (projection === 'totals' || compact) {
    [total] = createScope('flat_response_first_page_total')
      .select('COALESCE(SUM(visible_unit.total), 0)')
      .getQueryAndParameters();
  }
  const bindings = valueSearch ?
    [...parameters, page.size, (page.number - 1) * page.size, `%${responseValue}%`] :
    [...parameters, page.size];

  const rows = await connection.query<{ cnt: string; responseId: number | null }[]>(`
    WITH ready_workspace AS MATERIALIZED (
      SELECT 1 FROM flat_response_first_page_workspace WHERE workspace_id = $1 AND ready ${readySearch}
    ), ${idQueries}
    SELECT (${total}) AS cnt, u.booklet_id AS "bookletId", answer.id AS "responseId",
      u.unit_id AS "unitId", u.person_id AS "personId",
      u.person_code AS code, u.person_group AS "group", u.person_login AS login,
      u.booklet_name AS booklet, COALESCE(u.unit_alias, u.unit_name) AS unit,
      answer.variableid AS response, answer.status AS "responseStatus", answer.value_prefix AS "responseValue",
      COALESCE((SELECT string_agg(DISTINCT tag.tag, ',')
        FROM unit_tag tag WHERE tag."unitId" = u.unit_id), '') AS tags
    FROM ready_workspace
    LEFT JOIN first_page_rows page_id ON TRUE
    LEFT JOIN LATERAL (
      SELECT * FROM flat_response_first_page_unit WHERE unit_id = page_id.unit_id LIMIT 1
    ) u ON TRUE
    LEFT JOIN LATERAL (
      SELECT id, variableid, status, ${valueColumn}
      FROM ${responseTable} WHERE id = page_id.id LIMIT 1
    ) answer ON TRUE
    ORDER BY page_id.person_code, page_id.booklet_name, page_id.unit_alias, page_id.variableid, page_id.id
  `, bindings, queryRunner);
  if (rows.length === 0) return undefined;
  return { total: Number(rows[0].cnt), raw: rows.filter(row => row.responseId !== null) };
}

function projectedFirstPageIds(scope: string, limit: string, responseTable: string, compact: boolean): string {
  // Use the covering order index to rank tied unit prefixes before reading the response payload.
  return `
    first_page_units AS MATERIALIZED (
      SELECT u.unit_id, u.person_code, u.booklet_name, u.unit_alias
      FROM (${scope}) u
      JOIN flat_response_unit_count n ON n.unitid = u.unit_id AND n.total > 0
      ORDER BY u.person_code, u.booklet_name, u.unit_alias
      FETCH FIRST ${limit} ROWS WITH TIES
    ), first_page_rows AS MATERIALIZED (
      SELECT u.*, r.id, r.variableid
      FROM first_page_units u
      CROSS JOIN LATERAL (
        SELECT id, variableid
        FROM ${responseTable}
        WHERE unitid = u.unit_id ${compact ? '' : 'AND is_autocoder_generated IS NOT TRUE'}
        ORDER BY variableid, id
        LIMIT ${limit}
      ) r
      ORDER BY u.person_code, u.booklet_name, u.unit_alias, r.variableid, r.id
      LIMIT ${limit}
    )`;
}

function projectedValuePageIds(scope: string, limit: string, offset: string, pattern: string): string {
  return `
    projected_value_matches AS MATERIALIZED (
      SELECT u.unit_id, u.person_code, u.booklet_name, u.unit_alias, r.id, r.variableid
      FROM flat_response_value_search_link r
      JOIN (${scope}) u ON u.unit_id = r.unitid
      WHERE r.workspace_id = $1 AND r.value_id = ANY(ARRAY(
        SELECT id FROM flat_response_value_search_value
        WHERE workspace_id = $1 AND value_prefix ILIKE ${pattern}
      ))
    ), first_page_rows AS MATERIALIZED (
      SELECT * FROM projected_value_matches
      ORDER BY person_code, booklet_name, unit_alias, variableid, id
      LIMIT ${limit} OFFSET ${offset}
    )`;
}
