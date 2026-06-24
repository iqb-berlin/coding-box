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
