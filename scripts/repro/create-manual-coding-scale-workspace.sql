\set ON_ERROR_STOP on

\if :{?source_workspace_id}
\else
  \set source_workspace_id 47
\endif

\if :{?target_person_count}
\else
  \set target_person_count 5000
\endif

\if :{?target_workspace_name}
\else
  \set target_workspace_name 'Manual Coding Scale Workspace'
\endif

BEGIN;

CREATE TEMP TABLE scale_source_persons AS
SELECT
  p.*,
  row_number() OVER (ORDER BY p.id) AS source_index,
  count(*) OVER () AS source_count
FROM persons p
WHERE p.workspace_id = :source_workspace_id
  AND p.consider = true
ORDER BY p.id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM scale_source_persons) THEN
    RAISE EXCEPTION 'No source persons found for source workspace.';
  END IF;
END $$;

INSERT INTO workspace (name, settings)
SELECT :'target_workspace_name', settings
FROM workspace
WHERE id = :source_workspace_id
RETURNING id AS target_workspace_id \gset

INSERT INTO workspace_user (workspace_id, user_id, access_level, can_code)
SELECT :target_workspace_id, user_id, access_level, can_code
FROM workspace_user
WHERE workspace_id = :source_workspace_id
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE scale_person_plan AS
SELECT
  target_index,
  source.id AS source_person_id,
  left(source.login, 56) || '_s' || target_index::text AS target_login,
  left(source.code, 56) || '_s' || target_index::text AS target_code,
  left(source."group", 56) || '_scale' AS target_group,
  source.booklets,
  source.source AS original_source
FROM generate_series(1, :target_person_count) AS target_index
JOIN scale_source_persons source
  ON source.source_index =
    (((target_index - 1) % source.source_count) + 1);

INSERT INTO persons (
  "group",
  login,
  code,
  booklets,
  workspace_id,
  uploaded_at,
  source,
  consider
)
SELECT
  target_group,
  target_login,
  target_code,
  booklets,
  :target_workspace_id,
  now(),
  'scale:' || :target_workspace_id || ':' || target_index || ':' || source_person_id,
  true
FROM scale_person_plan;

CREATE TEMP TABLE scale_person_map AS
SELECT
  plan.target_index,
  plan.source_person_id,
  person.id AS target_person_id
FROM scale_person_plan plan
JOIN persons person
  ON person.workspace_id = :target_workspace_id
  AND person.login = plan.target_login
  AND person.code = plan.target_code
  AND person."group" = plan.target_group;

INSERT INTO booklet (infoid, personid, lastts, firstts)
SELECT
  source_booklet.infoid,
  person_map.target_person_id,
  source_booklet.lastts,
  source_booklet.firstts
FROM booklet source_booklet
JOIN scale_person_map person_map
  ON person_map.source_person_id = source_booklet.personid;

CREATE TEMP TABLE scale_booklet_map AS
SELECT
  source_booklet.id AS source_booklet_id,
  target_booklet.id AS target_booklet_id
FROM booklet source_booklet
JOIN scale_person_map person_map
  ON person_map.source_person_id = source_booklet.personid
JOIN booklet target_booklet
  ON target_booklet.personid = person_map.target_person_id
  AND target_booklet.infoid = source_booklet.infoid;

INSERT INTO unit (bookletid, name, alias)
SELECT
  booklet_map.target_booklet_id,
  source_unit.name,
  source_unit.alias
FROM unit source_unit
JOIN scale_booklet_map booklet_map
  ON booklet_map.source_booklet_id = source_unit.bookletid;

CREATE TEMP TABLE scale_unit_map AS
SELECT
  source_unit.id AS source_unit_id,
  target_unit.id AS target_unit_id
FROM unit source_unit
JOIN scale_booklet_map booklet_map
  ON booklet_map.source_booklet_id = source_unit.bookletid
JOIN unit target_unit
  ON target_unit.bookletid = booklet_map.target_booklet_id
  AND target_unit.name = source_unit.name
  AND COALESCE(target_unit.alias, '') = COALESCE(source_unit.alias, '');

INSERT INTO response (
  unitid,
  variableid,
  status,
  value,
  subform,
  code_v1,
  score_v1,
  status_v1,
  status_v2,
  code_v2,
  score_v2,
  status_v3,
  code_v3,
  score_v3,
  is_autocoder_generated
)
SELECT
  unit_map.target_unit_id,
  source_response.variableid,
  source_response.status,
  source_response.value,
  source_response.subform,
  source_response.code_v1,
  source_response.score_v1,
  source_response.status_v1,
  source_response.status_v2,
  source_response.code_v2,
  source_response.score_v2,
  source_response.status_v3,
  source_response.code_v3,
  source_response.score_v3,
  source_response.is_autocoder_generated
FROM response source_response
JOIN scale_unit_map unit_map
  ON unit_map.source_unit_id = source_response.unitid;

COMMIT;

SELECT
  :target_workspace_id AS workspace_id,
  :'target_workspace_name' AS workspace_name,
  count(DISTINCT person.id) AS persons,
  count(DISTINCT booklet.id) AS booklets,
  count(DISTINCT unit.id) AS units,
  count(response.id) AS responses
FROM workspace workspace
LEFT JOIN persons person
  ON person.workspace_id = workspace.id
LEFT JOIN booklet booklet
  ON booklet.personid = person.id
LEFT JOIN unit unit
  ON unit.bookletid = booklet.id
LEFT JOIN response response
  ON response.unitid = unit.id
WHERE workspace.id = :target_workspace_id
GROUP BY workspace.id;
