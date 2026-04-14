-- Manual whitelist fix for unresolved coding_job.job_definition_id assignments.
-- Copy the VALUES rows in cte "manual_map" and fill your approved mappings:
--   (job_id, definition_id)
--
-- Safety checks:
-- 1) only jobs with current job_definition_id IS NULL are updated
-- 2) job and definition must be in the same workspace
-- 3) optional legacy guard: job must match legacy distributed name pattern and not be training job
--
-- Recommended flow:
-- 1) Run this file as-is and inspect the "PREVIEW" result set.
-- 2) Uncomment the UPDATE block.
-- 3) Run again and inspect "UPDATED_ROWS".

BEGIN;

WITH manual_map(job_id, definition_id) AS (
  VALUES
    -- (12345, 678),
    -- (12346, 678)
    (NULL::INTEGER, NULL::INTEGER)
),
validated_map AS (
  SELECT
    mm.job_id,
    mm.definition_id
  FROM manual_map mm
  WHERE mm.job_id IS NOT NULL
    AND mm.definition_id IS NOT NULL
),
preview AS (
  SELECT
    vm.job_id,
    cj.workspace_id AS job_workspace_id,
    cj.name AS job_name,
    cj.training_id,
    cj.job_definition_id AS current_job_definition_id,
    vm.definition_id AS target_definition_id,
    jd.workspace_id AS definition_workspace_id,
    jd.status AS definition_status,
    CASE
      WHEN cj.id IS NULL THEN 'job-not-found'
      WHEN jd.id IS NULL THEN 'definition-not-found'
      WHEN cj.job_definition_id IS NOT NULL THEN 'job-already-linked'
      WHEN cj.workspace_id <> jd.workspace_id THEN 'workspace-mismatch'
      WHEN cj.training_id IS NOT NULL THEN 'training-job-not-allowed'
      WHEN cj.name !~ '^Job .+ \\(.+\\)$' THEN 'name-pattern-mismatch'
      ELSE 'ok'
    END AS validation_status
  FROM validated_map vm
  LEFT JOIN "public"."coding_job" cj
    ON cj.id = vm.job_id
  LEFT JOIN "public"."job_definitions" jd
    ON jd.id = vm.definition_id
)
SELECT
  'PREVIEW' AS result_type,
  p.*
FROM preview p
ORDER BY p.job_workspace_id NULLS LAST, p.job_id;

-- Uncomment this block after reviewing PREVIEW:
/*
WITH manual_map(job_id, definition_id) AS (
  VALUES
    -- (12345, 678),
    -- (12346, 678)
    (NULL::INTEGER, NULL::INTEGER)
),
validated_map AS (
  SELECT
    mm.job_id,
    mm.definition_id
  FROM manual_map mm
  WHERE mm.job_id IS NOT NULL
    AND mm.definition_id IS NOT NULL
),
safe_updates AS (
  SELECT
    vm.job_id,
    vm.definition_id
  FROM validated_map vm
  JOIN "public"."coding_job" cj
    ON cj.id = vm.job_id
  JOIN "public"."job_definitions" jd
    ON jd.id = vm.definition_id
  WHERE cj.job_definition_id IS NULL
    AND cj.workspace_id = jd.workspace_id
    AND cj.training_id IS NULL
    AND cj.name ~ '^Job .+ \\(.+\\)$'
),
updated AS (
  UPDATE "public"."coding_job" cj
  SET job_definition_id = su.definition_id
  FROM safe_updates su
  WHERE cj.id = su.job_id
    AND cj.job_definition_id IS NULL
  RETURNING
    cj.id AS job_id,
    cj.workspace_id,
    su.definition_id AS updated_definition_id
)
SELECT
  'UPDATED_ROWS' AS result_type,
  u.*
FROM updated u
ORDER BY u.workspace_id, u.job_id;
*/

COMMIT;
