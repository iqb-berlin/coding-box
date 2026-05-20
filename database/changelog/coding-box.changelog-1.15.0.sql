-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Mark autocoder-generated response rows so repeated runs do not use their own generated outputs as input

ALTER TABLE "public"."response"
  ADD COLUMN "is_autocoder_generated" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "idx_response_is_autocoder_generated"
  ON "public"."response" ("is_autocoder_generated");

CREATE UNIQUE INDEX "uq_response_autocoder_generated_key"
  ON "public"."response" ("unitid", "variableid", COALESCE("subform", ''))
  WHERE "is_autocoder_generated" IS TRUE;

-- rollback DROP INDEX IF EXISTS "public"."uq_response_autocoder_generated_key";
-- rollback DROP INDEX IF EXISTS "public"."idx_response_is_autocoder_generated";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "is_autocoder_generated";

-- changeset jurei733:2
-- comment: Add resource package metadata for global packages and version display

ALTER TABLE "public"."resource_package" ADD COLUMN IF NOT EXISTS "package_type" VARCHAR(30) NOT NULL DEFAULT 'resource';
ALTER TABLE "public"."resource_package" ADD COLUMN IF NOT EXISTS "scope" VARCHAR(20) NOT NULL DEFAULT 'workspace';
ALTER TABLE "public"."resource_package" ADD COLUMN IF NOT EXISTS "detected_version" VARCHAR(100);
ALTER TABLE "public"."resource_package" ADD COLUMN IF NOT EXISTS "content_hash" VARCHAR(64);
ALTER TABLE "public"."resource_package" ADD COLUMN IF NOT EXISTS "original_filename" VARCHAR(255);

ALTER TABLE "public"."resource_package" DROP CONSTRAINT IF EXISTS "check_resource_package_type";
ALTER TABLE "public"."resource_package" ADD CONSTRAINT "check_resource_package_type"
  CHECK ("package_type" IN ('resource', 'geogebra'));

ALTER TABLE "public"."resource_package" DROP CONSTRAINT IF EXISTS "check_resource_package_scope";
ALTER TABLE "public"."resource_package" ADD CONSTRAINT "check_resource_package_scope"
  CHECK ("scope" IN ('workspace', 'global'));

UPDATE "public"."resource_package"
SET
  "package_type" = 'geogebra',
  "scope" = 'global',
  "workspaceId" = 0,
  "original_filename" = "name" || '.itcr.zip'
WHERE LOWER("name") = 'geogebra';

UPDATE "public"."resource_package"
SET "original_filename" = "name" || '.itcr.zip'
WHERE "original_filename" IS NULL;

-- rollback ALTER TABLE "public"."resource_package" DROP CONSTRAINT IF EXISTS "check_resource_package_scope";
-- rollback ALTER TABLE "public"."resource_package" DROP CONSTRAINT IF EXISTS "check_resource_package_type";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN IF EXISTS "original_filename";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN IF EXISTS "content_hash";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN IF EXISTS "detected_version";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN IF EXISTS "scope";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN IF EXISTS "package_type";

-- changeset jurei733:3
-- comment: Add validation task progress messages and cache keys

ALTER TABLE "public"."job" ADD COLUMN IF NOT EXISTS "progress_message" TEXT;
ALTER TABLE "public"."job" ADD COLUMN IF NOT EXISTS "cache_key" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "idx_job_validation_cache_key"
  ON "public"."job" ("workspace_id", "type", "cache_key")
  WHERE "type" = 'validation-task' AND "cache_key" IS NOT NULL;

-- rollback DROP INDEX IF EXISTS "public"."idx_job_validation_cache_key";
-- rollback ALTER TABLE "public"."job" DROP COLUMN IF EXISTS "cache_key";
-- rollback ALTER TABLE "public"."job" DROP COLUMN IF EXISTS "progress_message";

-- changeset jurei733:4
-- comment: Remove orphaned unit notes before enforcing cascade cleanup
DELETE FROM "public"."unit_note" note
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."unit" unit_row
  WHERE unit_row."id" = note."unitId"
);
-- rollback SELECT 1;

-- changeset jurei733:5
-- comment: Ensure unit notes are deleted with their unit at database level
ALTER TABLE "public"."unit_note" DROP CONSTRAINT IF EXISTS "FK_unit_note_unit";
ALTER TABLE "public"."unit_note"
  ADD CONSTRAINT "FK_unit_note_unit"
  FOREIGN KEY ("unitId")
  REFERENCES "public"."unit" ("id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION;
-- rollback ALTER TABLE "public"."unit_note" DROP CONSTRAINT IF EXISTS "FK_unit_note_unit";

-- changeset jurei733:6
-- comment: Track whether auto/manual coding is current after test result changes
CREATE TABLE IF NOT EXISTS "public"."coding_unit_freshness" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "unit_id" INTEGER NOT NULL,
  "version" VARCHAR(2) NOT NULL,
  "state" VARCHAR(32) NOT NULL,
  "reason" VARCHAR(32) NOT NULL,
  "affected_response_count" INTEGER NOT NULL DEFAULT 0,
  "source_revision" INTEGER NOT NULL DEFAULT 0,
  "coded_revision" INTEGER,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "FK_coding_unit_freshness_unit"
    FOREIGN KEY ("unit_id")
    REFERENCES "public"."unit" ("id")
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_coding_unit_freshness_workspace_unit_version"
  ON "public"."coding_unit_freshness" ("workspace_id", "unit_id", "version");

CREATE INDEX IF NOT EXISTS "idx_coding_unit_freshness_workspace_state"
  ON "public"."coding_unit_freshness" ("workspace_id", "state");

CREATE INDEX IF NOT EXISTS "idx_coding_unit_freshness_workspace_version_state"
  ON "public"."coding_unit_freshness" ("workspace_id", "version", "state");

-- rollback DROP TABLE IF EXISTS "public"."coding_unit_freshness";

-- changeset jurei733:12
-- comment: Track whether manual coding jobs need review after test result changes
ALTER TABLE "public"."coding_job"
  ADD COLUMN IF NOT EXISTS "freshness_status" VARCHAR(32) NOT NULL DEFAULT 'current',
  ADD COLUMN IF NOT EXISTS "freshness_reason" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "freshness_updated_at" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS "freshness_affected_units" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "freshness_affected_responses" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "idx_coding_job_workspace_freshness"
  ON "public"."coding_job" ("workspace_id", "freshness_status");

-- rollback DROP INDEX IF EXISTS "public"."idx_coding_job_workspace_freshness";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "freshness_affected_responses";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "freshness_affected_units";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "freshness_updated_at";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "freshness_reason";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "freshness_status";

-- changeset jurei733:7
-- comment: Store monotonically increasing test-result revisions per workspace
CREATE TABLE IF NOT EXISTS "public"."workspace_test_results_revision" (
  "workspace_id" INTEGER PRIMARY KEY,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- rollback DROP TABLE IF EXISTS "public"."workspace_test_results_revision";

-- changeset jurei733:8
-- comment: Store aggregation settings snapshots on coding jobs

ALTER TABLE "public"."coding_job"
  ADD COLUMN IF NOT EXISTS "aggregation_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "aggregation_threshold" INTEGER,
  ADD COLUMN IF NOT EXISTS "response_matching_flags" JSONB,
  ADD COLUMN IF NOT EXISTS "aggregation_settings_version" INTEGER;

-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "aggregation_settings_version";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "response_matching_flags";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "aggregation_threshold";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "aggregation_enabled";

-- changeset jurei733:9
-- comment: Persist coding display options on job definitions for generated manual coding jobs

ALTER TABLE "public"."job_definitions"
  ADD COLUMN IF NOT EXISTS "show_score" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allow_comments" BOOLEAN NOT NULL DEFAULT true;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "allow_comments";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "show_score";

-- changeset jurei733:10
-- comment: Persist coder capacity settings for job definitions

ALTER TABLE "public"."job_definitions"
  ADD COLUMN IF NOT EXISTS "assigned_coder_configs" JSONB NULL;

UPDATE "public"."job_definitions"
SET "assigned_coder_configs" = (
  SELECT jsonb_agg(
    jsonb_build_object(
      'coderId',
      coder_values.value::integer,
      'capacityPercent',
      100
    )
    ORDER BY coder_values.ordinality
  )
  FROM jsonb_array_elements_text(COALESCE("assigned_coders", '[]'::jsonb))
    WITH ORDINALITY AS coder_values(value, ordinality)
)
WHERE "assigned_coder_configs" IS NULL
  AND "assigned_coders" IS NOT NULL;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_coder_configs";

-- changeset jurei733:11
-- comment: Persist stable distribution seed for job definitions

ALTER TABLE "public"."job_definitions"
  ADD COLUMN IF NOT EXISTS "distribution_seed" TEXT NULL;

UPDATE "public"."job_definitions"
SET "distribution_seed" = 'job-definition:' || "id"::text
WHERE "distribution_seed" IS NULL;

ALTER TABLE "public"."job_definitions"
  ALTER COLUMN "distribution_seed" SET NOT NULL;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "distribution_seed";

-- changeset jurei733:13
-- comment: Repair applied manual coding jobs whose v2 results were cleared after application
-- Historical rows cannot reliably distinguish reset from autocoder cleanup, so affected jobs are conservatively marked stale.
WITH affected_jobs AS (
  SELECT
    cj."id" AS "coding_job_id",
    COUNT(DISTINCT CONCAT_WS('|', cju."person_login", cju."booklet_name", cju."unit_name")) AS "affected_units",
    COUNT(DISTINCT cju."response_id") AS "affected_responses"
  FROM "public"."coding_job" cj
  INNER JOIN "public"."coding_job_unit" cju
    ON cju."coding_job_id" = cj."id"
    AND COALESCE(cju."workspace_id", cj."workspace_id") = cj."workspace_id"
  LEFT JOIN "public"."response" resp
    ON resp."id" = cju."response_id"
  WHERE cj."training_id" IS NULL
    AND cj."status" = 'results_applied'
    AND (
      resp."id" IS NULL
      OR (
        resp."status_v2" IS NULL
        AND resp."code_v2" IS NULL
        AND resp."score_v2" IS NULL
      )
    )
  GROUP BY cj."id"
)
UPDATE "public"."coding_job" cj
SET "status" = 'completed',
    "freshness_status" = 'stale_source',
    "freshness_reason" = 'AUTOCODE_RUN',
    "freshness_updated_at" = now(),
    "freshness_affected_units" = GREATEST(
      COALESCE(cj."freshness_affected_units", 0),
      affected_jobs."affected_units"::int
    ),
    "freshness_affected_responses" = GREATEST(
      COALESCE(cj."freshness_affected_responses", 0),
      affected_jobs."affected_responses"::int
    ),
    "updated_at" = now()
FROM affected_jobs
WHERE cj."id" = affected_jobs."coding_job_id";

-- rollback SELECT 1;

-- changeset jurei733:14 splitStatements:false
-- comment: Validate response status_v3 values before numeric migration

DO $$
DECLARE
  invalid_count INTEGER;
  invalid_examples TEXT;
BEGIN
  WITH normalized AS (
    SELECT BTRIM("status_v3"::TEXT) AS value
    FROM "public"."response"
    WHERE "status_v3" IS NOT NULL
  ),
  invalid AS (
    SELECT value
    FROM normalized
    WHERE value <> ''
      AND value NOT IN (
        'UNSET',
        'NOT_REACHED',
        'DISPLAYED',
        'VALUE_CHANGED',
        'DERIVE_ERROR',
        'CODING_COMPLETE',
        'NO_CODING',
        'INVALID',
        'CODING_INCOMPLETE',
        'CODING_ERROR',
        'PARTLY_DISPLAYED',
        'DERIVE_PENDING',
        'INTENDED_INCOMPLETE',
        'CODE_SELECTION_PENDING'
      )
      AND NOT (
        CASE
          WHEN value ~ '^[0-9]+$' THEN value::NUMERIC BETWEEN 0 AND 13
          ELSE FALSE
        END
      )
  ),
  examples AS (
    SELECT DISTINCT value
    FROM invalid
    ORDER BY value
    LIMIT 10
  )
  SELECT
    (SELECT COUNT(*) FROM invalid),
    (SELECT STRING_AGG(value, ', ') FROM examples)
  INTO invalid_count, invalid_examples;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION
      'Cannot migrate response.status_v3 to SMALLINT: found % invalid value(s). Examples: %',
      invalid_count,
      invalid_examples;
  END IF;
END $$;

-- rollback SELECT 1;

-- changeset jurei733:15
-- comment: Normalize response status_v3 to numeric SMALLINT like status_v1 and status_v2

ALTER TABLE "public"."response"
  ALTER COLUMN "status_v3" TYPE SMALLINT
  USING CASE
    WHEN BTRIM("status_v3"::TEXT) = '' THEN NULL
    WHEN BTRIM("status_v3"::TEXT) = 'UNSET' THEN 0
    WHEN BTRIM("status_v3"::TEXT) = 'NOT_REACHED' THEN 1
    WHEN BTRIM("status_v3"::TEXT) = 'DISPLAYED' THEN 2
    WHEN BTRIM("status_v3"::TEXT) = 'VALUE_CHANGED' THEN 3
    WHEN BTRIM("status_v3"::TEXT) = 'DERIVE_ERROR' THEN 4
    WHEN BTRIM("status_v3"::TEXT) = 'CODING_COMPLETE' THEN 5
    WHEN BTRIM("status_v3"::TEXT) = 'NO_CODING' THEN 6
    WHEN BTRIM("status_v3"::TEXT) = 'INVALID' THEN 7
    WHEN BTRIM("status_v3"::TEXT) = 'CODING_INCOMPLETE' THEN 8
    WHEN BTRIM("status_v3"::TEXT) = 'CODING_ERROR' THEN 9
    WHEN BTRIM("status_v3"::TEXT) = 'PARTLY_DISPLAYED' THEN 10
    WHEN BTRIM("status_v3"::TEXT) = 'DERIVE_PENDING' THEN 11
    WHEN BTRIM("status_v3"::TEXT) = 'INTENDED_INCOMPLETE' THEN 12
    WHEN BTRIM("status_v3"::TEXT) = 'CODE_SELECTION_PENDING' THEN 13
    ELSE BTRIM("status_v3"::TEXT)::SMALLINT
  END;

-- rollback ALTER TABLE "public"."response" ALTER COLUMN "status_v3" TYPE VARCHAR(255);

-- changeset jurei733:16
-- comment: Extend workspace journal entries to support canonical audit events

ALTER TABLE "public"."journal_entries"
  ADD COLUMN IF NOT EXISTS "actor_user_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "actor_type" VARCHAR(20) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "event_type" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "result" VARCHAR(20) NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS "summary" TEXT,
  ADD COLUMN IF NOT EXISTS "correlation_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "job_id" VARCHAR(255);

UPDATE "public"."journal_entries"
SET
  "actor_user_id" = CASE
    WHEN "actor_user_id" IS NULL AND "user_id" ~ '^[0-9]+$' THEN "user_id"::INTEGER
    ELSE "actor_user_id"
  END,
  "event_type" = COALESCE(
    "event_type",
    CASE
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'TEST_PERSON'
        THEN 'TEST_PERSON_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'TEST_RESULTS'
        THEN 'TEST_RESULTS_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'TEST_LOGS'
        THEN 'TEST_LOGS_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'BOOKLET'
        THEN 'BOOKLET_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'UNIT'
        THEN 'UNIT_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'RESPONSE'
        THEN 'RESPONSE_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        THEN CONCAT(UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')), '_DELETED')
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'RESET_VERSION'
        THEN 'CODING_VERSION_RESET'
      ELSE CONCAT(
        UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')),
        '_',
        UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_'))
      )
    END
  ),
  "summary" = COALESCE("summary", CONCAT("action_type", ' ', "entity_type", ' ', "entity_id"::TEXT))
WHERE "event_type" IS NULL
   OR "summary" IS NULL
   OR ("actor_user_id" IS NULL AND "user_id" ~ '^[0-9]+$');

ALTER TABLE "public"."journal_entries"
  ALTER COLUMN "entity_id" DROP NOT NULL,
  ALTER COLUMN "entity_id" TYPE VARCHAR(255)
  USING "entity_id"::TEXT;

CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_timestamp"
  ON "public"."journal_entries" ("workspace_id", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_event_type"
  ON "public"."journal_entries" ("workspace_id", "event_type");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_actor_user"
  ON "public"."journal_entries" ("workspace_id", "actor_user_id");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_result"
  ON "public"."journal_entries" ("workspace_id", "result");

-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_result";
-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_actor_user";
-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_event_type";
-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_timestamp";
-- rollback ALTER TABLE "public"."journal_entries" ALTER COLUMN "entity_id" TYPE INTEGER USING CASE WHEN "entity_id" ~ '^-?[0-9]+$' THEN "entity_id"::INTEGER ELSE 0 END;
-- rollback ALTER TABLE "public"."journal_entries" ALTER COLUMN "entity_id" SET NOT NULL;
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "job_id";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "correlation_id";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "summary";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "result";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "event_type";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "actor_type";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "actor_user_id";

-- changeset jurei733:17
-- comment: Add bookletlog indexes for flat-response filter option queries

CREATE INDEX IF NOT EXISTS "idx_bookletlog_controller_booklet_parameter_id"
  ON "public"."bookletlog" ("bookletid", "parameter", "id")
  WHERE "key" = 'CONTROLLER';

CREATE INDEX IF NOT EXISTS "idx_bookletlog_current_unit_booklet_parameter"
  ON "public"."bookletlog" ("bookletid", "parameter")
  WHERE "key" = 'CURRENT_UNIT_ID';

-- rollback DROP INDEX IF EXISTS "public"."idx_bookletlog_current_unit_booklet_parameter";
-- rollback DROP INDEX IF EXISTS "public"."idx_bookletlog_controller_booklet_parameter_id";

-- changeset jurei733:18
-- comment: Separate workspace coding capability from access level

ALTER TABLE "public"."workspace_user"
  ADD COLUMN IF NOT EXISTS "can_code" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "public"."workspace_user"
SET "can_code" = TRUE
WHERE "access_level" = 1;

UPDATE "public"."workspace_user" wu
SET "can_code" = TRUE
FROM "public"."coding_job_coder" cjc
JOIN "public"."coding_job" cj
  ON cj."id" = cjc."coding_job_id"
WHERE wu."workspace_id" = cj."workspace_id"
  AND wu."user_id" = cjc."user_id"
  AND wu."access_level" > 0;

UPDATE "public"."workspace_user"
SET "can_code" = FALSE
WHERE COALESCE("access_level", 0) <= 0;

-- rollback ALTER TABLE "public"."workspace_user" DROP COLUMN IF EXISTS "can_code";
