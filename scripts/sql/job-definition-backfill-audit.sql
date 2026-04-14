-- Audit query for unresolved coding_job.job_definition_id backfill cases
-- Use this after running changelog 1.14.1 to inspect remaining ambiguous/unmatched jobs.
--
-- Output:
-- 1) Summary by classification
-- 2) Job-level details (ambiguous + unmatched)
-- 3) Candidate-level rows for ambiguous jobs

WITH job_features AS (
  SELECT
    cj.id AS job_id,
    cj.workspace_id,
    cj.name AS job_name,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjc.user_id ORDER BY cjc.user_id)
        FROM "public"."coding_job_coder" cjc
        WHERE cjc.coding_job_id = cj.id
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT (cjv.unit_name || '|' || cjv.variable_id) ORDER BY (cjv.unit_name || '|' || cjv.variable_id))
        FROM "public"."coding_job_variable" cjv
        WHERE cjv.coding_job_id = cj.id
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjvb.variable_bundle_id ORDER BY cjvb.variable_bundle_id)
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
    jd.status AS definition_status,
    COALESCE(
      (
        SELECT array_agg(DISTINCT value::INTEGER ORDER BY value::INTEGER)
        FROM jsonb_array_elements_text(COALESCE(jd.assigned_coders, '[]'::jsonb)) AS coder_values(value)
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'unitName') || '|' || (value ->> 'variableId')) ORDER BY ((value ->> 'unitName') || '|' || (value ->> 'variableId')))
        FROM jsonb_array_elements(COALESCE(jd.assigned_variables, '[]'::jsonb)) AS variable_values(value)
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'id')::INTEGER) ORDER BY ((value ->> 'id')::INTEGER))
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
    df.definition_id,
    df.definition_status
  FROM job_features jf
  JOIN definition_features df
    ON df.workspace_id = jf.workspace_id
  WHERE (cardinality(jf.coder_ids) = 0 OR jf.coder_ids <@ df.coder_ids)
    AND (cardinality(jf.variable_keys) = 0 OR jf.variable_keys <@ df.variable_keys)
    AND (cardinality(jf.bundle_ids) = 0 OR jf.bundle_ids <@ df.bundle_ids)
    AND (cardinality(jf.variable_keys) > 0 OR cardinality(jf.bundle_ids) > 0)
),
candidate_agg AS (
  SELECT
    cm.job_id,
    COUNT(*)::INTEGER AS candidate_count,
    array_agg(cm.definition_id ORDER BY cm.definition_id) AS candidate_definition_ids
  FROM candidate_matches cm
  GROUP BY cm.job_id
),
classified AS (
  SELECT
    jf.job_id,
    jf.workspace_id,
    jf.job_name,
    jf.coder_ids,
    jf.variable_keys,
    jf.bundle_ids,
    COALESCE(ca.candidate_count, 0) AS candidate_count,
    COALESCE(ca.candidate_definition_ids, ARRAY[]::INTEGER[]) AS candidate_definition_ids,
    CASE
      WHEN COALESCE(ca.candidate_count, 0) = 0 THEN 'unmatched'
      WHEN COALESCE(ca.candidate_count, 0) = 1 THEN 'single-match'
      ELSE 'ambiguous'
    END AS classification
  FROM job_features jf
  LEFT JOIN candidate_agg ca
    ON ca.job_id = jf.job_id
)
SELECT classification, COUNT(*)::INTEGER AS jobs
FROM classified
GROUP BY classification
ORDER BY classification;

WITH job_features AS (
  SELECT
    cj.id AS job_id,
    cj.workspace_id,
    cj.name AS job_name,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjc.user_id ORDER BY cjc.user_id)
        FROM "public"."coding_job_coder" cjc
        WHERE cjc.coding_job_id = cj.id
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT (cjv.unit_name || '|' || cjv.variable_id) ORDER BY (cjv.unit_name || '|' || cjv.variable_id))
        FROM "public"."coding_job_variable" cjv
        WHERE cjv.coding_job_id = cj.id
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjvb.variable_bundle_id ORDER BY cjvb.variable_bundle_id)
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
        SELECT array_agg(DISTINCT value::INTEGER ORDER BY value::INTEGER)
        FROM jsonb_array_elements_text(COALESCE(jd.assigned_coders, '[]'::jsonb)) AS coder_values(value)
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'unitName') || '|' || (value ->> 'variableId')) ORDER BY ((value ->> 'unitName') || '|' || (value ->> 'variableId')))
        FROM jsonb_array_elements(COALESCE(jd.assigned_variables, '[]'::jsonb)) AS variable_values(value)
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'id')::INTEGER) ORDER BY ((value ->> 'id')::INTEGER))
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
candidate_agg AS (
  SELECT
    cm.job_id,
    COUNT(*)::INTEGER AS candidate_count,
    array_agg(cm.definition_id ORDER BY cm.definition_id) AS candidate_definition_ids
  FROM candidate_matches cm
  GROUP BY cm.job_id
)
SELECT
  jf.workspace_id,
  jf.job_id,
  jf.job_name,
  COALESCE(ca.candidate_count, 0) AS candidate_count,
  COALESCE(ca.candidate_definition_ids, ARRAY[]::INTEGER[]) AS candidate_definition_ids,
  jf.coder_ids,
  jf.variable_keys,
  jf.bundle_ids
FROM job_features jf
LEFT JOIN candidate_agg ca
  ON ca.job_id = jf.job_id
WHERE COALESCE(ca.candidate_count, 0) <> 1
ORDER BY jf.workspace_id, jf.job_id;

WITH job_features AS (
  SELECT
    cj.id AS job_id,
    cj.workspace_id,
    cj.name AS job_name,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjc.user_id ORDER BY cjc.user_id)
        FROM "public"."coding_job_coder" cjc
        WHERE cjc.coding_job_id = cj.id
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT (cjv.unit_name || '|' || cjv.variable_id) ORDER BY (cjv.unit_name || '|' || cjv.variable_id))
        FROM "public"."coding_job_variable" cjv
        WHERE cjv.coding_job_id = cj.id
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT cjvb.variable_bundle_id ORDER BY cjvb.variable_bundle_id)
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
    jd.status AS definition_status,
    COALESCE(
      (
        SELECT array_agg(DISTINCT value::INTEGER ORDER BY value::INTEGER)
        FROM jsonb_array_elements_text(COALESCE(jd.assigned_coders, '[]'::jsonb)) AS coder_values(value)
      ),
      ARRAY[]::INTEGER[]
    ) AS coder_ids,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'unitName') || '|' || (value ->> 'variableId')) ORDER BY ((value ->> 'unitName') || '|' || (value ->> 'variableId')))
        FROM jsonb_array_elements(COALESCE(jd.assigned_variables, '[]'::jsonb)) AS variable_values(value)
      ),
      ARRAY[]::TEXT[]
    ) AS variable_keys,
    COALESCE(
      (
        SELECT array_agg(DISTINCT ((value ->> 'id')::INTEGER) ORDER BY ((value ->> 'id')::INTEGER))
        FROM jsonb_array_elements(COALESCE(jd.assigned_variable_bundles, '[]'::jsonb)) AS bundle_values(value)
        WHERE value ? 'id'
      ),
      ARRAY[]::INTEGER[]
    ) AS bundle_ids
  FROM "public"."job_definitions" jd
),
candidate_matches AS (
  SELECT
    jf.workspace_id,
    jf.job_id,
    jf.job_name,
    df.definition_id,
    df.definition_status
  FROM job_features jf
  JOIN definition_features df
    ON df.workspace_id = jf.workspace_id
  WHERE (cardinality(jf.coder_ids) = 0 OR jf.coder_ids <@ df.coder_ids)
    AND (cardinality(jf.variable_keys) = 0 OR jf.variable_keys <@ df.variable_keys)
    AND (cardinality(jf.bundle_ids) = 0 OR jf.bundle_ids <@ df.bundle_ids)
    AND (cardinality(jf.variable_keys) > 0 OR cardinality(jf.bundle_ids) > 0)
),
ambiguous_jobs AS (
  SELECT job_id
  FROM candidate_matches
  GROUP BY job_id
  HAVING COUNT(*) > 1
)
SELECT
  cm.workspace_id,
  cm.job_id,
  cm.job_name,
  cm.definition_id AS candidate_definition_id,
  cm.definition_status
FROM candidate_matches cm
JOIN ambiguous_jobs aj
  ON aj.job_id = cm.job_id
ORDER BY cm.workspace_id, cm.job_id, cm.definition_id;
