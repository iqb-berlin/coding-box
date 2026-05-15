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
