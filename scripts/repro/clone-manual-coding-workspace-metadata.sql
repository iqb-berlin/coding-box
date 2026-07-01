\set ON_ERROR_STOP on

\if :{?source_workspace_id}
\else
  \set source_workspace_id 47
\endif

\if :{?target_workspace_id}
\else
  \set target_workspace_id 54
\endif

BEGIN;

INSERT INTO file_upload (
  data,
  workspace_id,
  filename,
  file_size,
  file_type,
  file_id,
  created_at,
  structured_data,
  file_id_normalized,
  coding_scheme_ref_normalized
)
SELECT
  data,
  :target_workspace_id,
  filename,
  file_size,
  file_type,
  file_id,
  now(),
  structured_data,
  file_id_normalized,
  coding_scheme_ref_normalized
FROM file_upload
WHERE workspace_id = :source_workspace_id
ON CONFLICT (workspace_id, file_id) DO UPDATE
SET
  data = EXCLUDED.data,
  filename = EXCLUDED.filename,
  file_size = EXCLUDED.file_size,
  file_type = EXCLUDED.file_type,
  structured_data = EXCLUDED.structured_data,
  file_id_normalized = EXCLUDED.file_id_normalized,
  coding_scheme_ref_normalized = EXCLUDED.coding_scheme_ref_normalized;

INSERT INTO resource_package (
  elements,
  name,
  created_at,
  "workspaceId",
  package_size,
  package_type,
  scope,
  detected_version,
  content_hash,
  original_filename
)
SELECT
  elements,
  name,
  now(),
  :target_workspace_id,
  package_size,
  package_type,
  scope,
  detected_version,
  content_hash,
  original_filename
FROM resource_package
WHERE "workspaceId" = :source_workspace_id
  AND NOT EXISTS (
    SELECT 1
    FROM resource_package existing
    WHERE existing."workspaceId" = :target_workspace_id
      AND existing.name = resource_package.name
      AND existing.package_type = resource_package.package_type
      AND existing.scope = resource_package.scope
  );

CREATE TEMP TABLE scale_missings_profile_map AS
WITH inserted AS (
  INSERT INTO missings_profile (label, missings, workspace_id)
  SELECT label, missings, :target_workspace_id
  FROM missings_profile
  WHERE workspace_id = :source_workspace_id
  ON CONFLICT (workspace_id, label) DO UPDATE
  SET missings = EXCLUDED.missings
  RETURNING id, label
)
SELECT source.id AS source_id, inserted.id AS target_id
FROM missings_profile source
JOIN inserted
  ON inserted.label = source.label
WHERE source.workspace_id = :source_workspace_id;

INSERT INTO variable_bundle (
  workspace_id,
  name,
  description,
  variables,
  created_at,
  updated_at
)
SELECT
  :target_workspace_id,
  name,
  description,
  variables,
  now(),
  now()
FROM variable_bundle
WHERE workspace_id = :source_workspace_id
  AND NOT EXISTS (
    SELECT 1
    FROM variable_bundle existing
    WHERE existing.workspace_id = :target_workspace_id
      AND existing.name = variable_bundle.name
  );

INSERT INTO job_definitions (
  duration_seconds,
  created_at,
  updated_at,
  max_coding_cases,
  double_coding_absolute,
  double_coding_percentage,
  status,
  assigned_variables,
  assigned_variable_bundles,
  assigned_coders,
  workspace_id,
  case_ordering_mode,
  suppress_general_instructions,
  show_score,
  allow_comments,
  assigned_coder_configs,
  distribution_seed,
  missings_profile_id,
  distribution_snapshots
)
SELECT
  duration_seconds,
  now(),
  now(),
  max_coding_cases,
  double_coding_absolute,
  double_coding_percentage,
  status,
  assigned_variables,
  assigned_variable_bundles,
  assigned_coders,
  :target_workspace_id,
  case_ordering_mode,
  suppress_general_instructions,
  show_score,
  allow_comments,
  assigned_coder_configs,
  distribution_seed || '-scale-' || :target_workspace_id,
  profile_map.target_id,
  distribution_snapshots
FROM job_definitions source
LEFT JOIN scale_missings_profile_map profile_map
  ON profile_map.source_id = source.missings_profile_id
WHERE source.workspace_id = :source_workspace_id
  AND NOT EXISTS (
    SELECT 1
    FROM job_definitions existing
    WHERE existing.workspace_id = :target_workspace_id
      AND existing.distribution_seed = source.distribution_seed || '-scale-' || :target_workspace_id
  );

COMMIT;

SELECT 'file_upload' AS table_name, count(*) AS rows
FROM file_upload
WHERE workspace_id = :target_workspace_id
UNION ALL
SELECT 'resource_package', count(*)
FROM resource_package
WHERE "workspaceId" = :target_workspace_id
UNION ALL
SELECT 'missings_profile', count(*)
FROM missings_profile
WHERE workspace_id = :target_workspace_id
UNION ALL
SELECT 'variable_bundle', count(*)
FROM variable_bundle
WHERE workspace_id = :target_workspace_id
UNION ALL
SELECT 'job_definitions', count(*)
FROM job_definitions
WHERE workspace_id = :target_workspace_id;
