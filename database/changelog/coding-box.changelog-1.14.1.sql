-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Backfill coding_job.job_definition_id for legacy distributed jobs with currently NULL job_definition_id
--
-- Strategy (safe-by-default):
-- 1) Consider only non-training jobs with legacy distributed naming pattern ('Job ... (...)') and NULL job_definition_id.
-- 2) Match each job against definitions in the same workspace by subset checks:
--    - assigned coder(s) contain all job coder(s)
--    - assigned variables contain all job variables
--    - assigned bundles contain all job bundles
-- 3) Only update jobs with exactly one matching definition.
--    Ambiguous or unmatched jobs are intentionally left untouched.

CREATE TEMP TABLE tmp_job_definition_backfill_candidates ON COMMIT DROP AS
WITH job_features AS (
  SELECT
    cj.id AS job_id,
    cj.workspace_id,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjc.user_id)
        FROM "public"."coding_job_coder" cjc
        WHERE cjc.coding_job_id = cj.id
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT (cjv.unit_name || '|' || cjv.variable_id))
        FROM "public"."coding_job_variable" cjv
        WHERE cjv.coding_job_id = cj.id
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjvb.variable_bundle_id)
        FROM "public"."coding_job_variable_bundle" cjvb
        WHERE cjvb.coding_job_id = cj.id
      ),
      ARRAY[]::INTEGER[]
    ) AS bundle_ids
  FROM "public"."coding_job" cj
  WHERE cj.job_definition_id IS NULL
    AND cj.training_id IS NULL
    AND cj.name ~ '^Job .+ \\(.+\\)$'
),
definition_features AS (
  SELECT
    jd.id AS definition_id,
    jd.workspace_id,
    COALESCE(
      (
        SELECT array_agg(DISTINCT value::INTEGER)
        FROM jsonb_array_elements_text(COALESCE(jd.assigned_coders, '[]'::jsonb)) AS coder_values(value)
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'unitName') || '|' || (value ->> 'variableId')))
        FROM jsonb_array_elements(COALESCE(jd.assigned_variables, '[]'::jsonb)) AS variable_values(value)
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'id')::INTEGER))
        FROM jsonb_array_elements(COALESCE(jd.assigned_variable_bundles, '[]'::jsonb)) AS bundle_values(value)
        WHERE value ? 'id'
      ),
      ARRAY[]::INTEGER[]
    ) AS bundle_ids
  FROM "public"."job_definitions" jd
),
candidate_matches AS (
  SELECT
    jf.job_id,
    df.definition_id
  FROM job_features jf
  JOIN definition_features df
    ON df.workspace_id = jf.workspace_id
  WHERE (cardinality(jf.coder_ids) = 0 OR jf.coder_ids <@ df.coder_ids)
    AND (cardinality(jf.variable_keys) = 0 OR jf.variable_keys <@ df.variable_keys)
    AND (cardinality(jf.bundle_ids) = 0 OR jf.bundle_ids <@ df.bundle_ids)
    AND (cardinality(jf.variable_keys) > 0 OR cardinality(jf.bundle_ids) > 0)
),
candidate_counts AS (
  SELECT
    job_id,
    COUNT(*)::INTEGER AS candidate_count,
    MIN(definition_id)::INTEGER AS only_definition_id
  FROM candidate_matches
  GROUP BY job_id
)
SELECT
  jf.job_id,
  COALESCE(cc.candidate_count, 0) AS candidate_count,
  CASE
    WHEN COALESCE(cc.candidate_count, 0) = 1 THEN cc.only_definition_id
    ELSE NULL
  END AS matched_definition_id
FROM job_features jf
LEFT JOIN candidate_counts cc
  ON cc.job_id = jf.job_id;

UPDATE "public"."coding_job" cj
SET job_definition_id = c.matched_definition_id
FROM tmp_job_definition_backfill_candidates c
WHERE cj.id = c.job_id
  AND cj.job_definition_id IS NULL
  AND c.candidate_count = 1
  AND c.matched_definition_id IS NOT NULL;

DO $$
DECLARE
  v_total INTEGER;
  v_updated INTEGER;
  v_ambiguous INTEGER;
  v_unmatched INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total
  FROM tmp_job_definition_backfill_candidates;

  SELECT COUNT(*) INTO v_updated
  FROM tmp_job_definition_backfill_candidates
  WHERE candidate_count = 1
    AND matched_definition_id IS NOT NULL;

  SELECT COUNT(*) INTO v_ambiguous
  FROM tmp_job_definition_backfill_candidates
  WHERE candidate_count > 1;

  SELECT COUNT(*) INTO v_unmatched
  FROM tmp_job_definition_backfill_candidates
  WHERE candidate_count = 0;

  RAISE NOTICE 'Backfill job_definition_id: total=% updated=% ambiguous=% unmatched=%',
    v_total, v_updated, v_ambiguous, v_unmatched;
END $$;

-- rollback SELECT 1;
