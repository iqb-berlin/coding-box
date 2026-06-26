-- liquibase formatted sql

-- changeset julian:1
-- comment: Backfill normalized coding scheme refs for existing Unit files

WITH extracted_refs AS (
  SELECT
    f."id",
    NULLIF(
      UPPER(BTRIM((match."ref_match")[1])),
      ''
    ) AS "coding_scheme_ref"
  FROM "public"."file_upload" f
  CROSS JOIN LATERAL regexp_matches(
    f."data",
    '<[[:space:]]*codingschemeref[^>]*>[[:space:]]*([^<]+)',
    'i'
  ) AS match("ref_match")
  WHERE f."file_type" = 'Unit'
    AND COALESCE(
      f."structured_data" #>> '{extractedInfo,codingSchemeRefNormalized}',
      ''
    ) = ''
),
normalized_refs AS (
  SELECT
    "id",
    "coding_scheme_ref",
    NULLIF(
      regexp_replace(
        regexp_replace("coding_scheme_ref", '\.VOCS$', '', 'i'),
        '\.XML$',
        '',
        'i'
      ),
      ''
    ) AS "coding_scheme_ref_normalized"
  FROM extracted_refs
  WHERE "coding_scheme_ref" IS NOT NULL
)
UPDATE "public"."file_upload" f
SET "structured_data" = jsonb_set(
  COALESCE(f."structured_data", '{}'::jsonb),
  '{extractedInfo}',
  COALESCE(f."structured_data" #> '{extractedInfo}', '{}'::jsonb) ||
    jsonb_build_object(
      'codingSchemeRef',
      refs."coding_scheme_ref",
      'codingSchemeRefNormalized',
      refs."coding_scheme_ref_normalized",
      'codingSchemeRefs',
      jsonb_build_array(refs."coding_scheme_ref_normalized")
    ),
  true
)
FROM normalized_refs refs
WHERE f."id" = refs."id"
  AND refs."coding_scheme_ref_normalized" IS NOT NULL;

-- rollback -- Cannot safely restore previous structured_data automatically; this backfill only adds missing extracted Unit coding scheme refs.

-- changeset julian:2
-- comment: Add indexed normalized file lookup columns for coding freshness

ALTER TABLE "public"."file_upload"
  ADD COLUMN IF NOT EXISTS "file_id_normalized" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "coding_scheme_ref_normalized" VARCHAR(100);

UPDATE "public"."file_upload"
SET "file_id_normalized" = NULLIF(
  regexp_replace(
    UPPER(BTRIM(COALESCE("file_id", ''))),
    '\.XML$',
    '',
    'i'
  ),
  ''
)
WHERE "file_id_normalized" IS NULL;

WITH extracted_refs AS (
  SELECT
    f."id",
    NULLIF(
      COALESCE(
        UPPER(BTRIM(f."structured_data" #>> '{extractedInfo,codingSchemeRefNormalized}')),
        UPPER(BTRIM((match."ref_match")[1]))
      ),
      ''
    ) AS "coding_scheme_ref"
  FROM "public"."file_upload" f
  LEFT JOIN LATERAL regexp_matches(
    f."data",
    '<[[:space:]]*codingschemeref[^>]*>[[:space:]]*([^<]+)',
    'i'
  ) AS match("ref_match") ON TRUE
  WHERE f."file_type" = 'Unit'
    AND f."coding_scheme_ref_normalized" IS NULL
),
normalized_refs AS (
  SELECT
    "id",
    NULLIF(
      regexp_replace(
        regexp_replace(
          regexp_replace("coding_scheme_ref", '\.VOCS$', '', 'i'),
          '\.XML$',
          '',
          'i'
        ),
        '^.*[/\\]',
        '',
        'i'
      ),
      ''
    ) AS "coding_scheme_ref_normalized"
  FROM extracted_refs
  WHERE "coding_scheme_ref" IS NOT NULL
)
UPDATE "public"."file_upload" f
SET "coding_scheme_ref_normalized" = refs."coding_scheme_ref_normalized"
FROM normalized_refs refs
WHERE f."id" = refs."id"
  AND refs."coding_scheme_ref_normalized" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_file_upload_workspace_type_file_id_norm"
  ON "public"."file_upload" ("workspace_id", "file_type", "file_id_normalized");

CREATE INDEX IF NOT EXISTS "idx_file_upload_workspace_type_scheme_ref_norm"
  ON "public"."file_upload" ("workspace_id", "file_type", "coding_scheme_ref_normalized");

CREATE INDEX IF NOT EXISTS "idx_unit_name_normalized"
  ON "public"."unit" ((regexp_replace(UPPER("name"), '\.XML$', '', 'i')));

CREATE INDEX IF NOT EXISTS "idx_unit_alias_normalized"
  ON "public"."unit" ((regexp_replace(UPPER(COALESCE("alias", '')), '\.XML$', '', 'i')));

-- rollback DROP INDEX IF EXISTS "public"."idx_unit_alias_normalized";
-- rollback DROP INDEX IF EXISTS "public"."idx_unit_name_normalized";
-- rollback DROP INDEX IF EXISTS "public"."idx_file_upload_workspace_type_scheme_ref_norm";
-- rollback DROP INDEX IF EXISTS "public"."idx_file_upload_workspace_type_file_id_norm";
-- rollback ALTER TABLE "public"."file_upload" DROP COLUMN IF EXISTS "coding_scheme_ref_normalized";
-- rollback ALTER TABLE "public"."file_upload" DROP COLUMN IF EXISTS "file_id_normalized";
