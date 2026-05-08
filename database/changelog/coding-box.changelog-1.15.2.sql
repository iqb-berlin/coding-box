-- liquibase formatted sql

-- changeset codex:1
-- comment: Add validation task progress messages and cache keys

ALTER TABLE "public"."job" ADD COLUMN "progress_message" TEXT;
ALTER TABLE "public"."job" ADD COLUMN "cache_key" VARCHAR(64);

CREATE INDEX "idx_job_validation_cache_key"
  ON "public"."job" ("workspace_id", "type", "cache_key")
  WHERE "type" = 'validation-task' AND "cache_key" IS NOT NULL;

-- rollback DROP INDEX IF EXISTS "public"."idx_job_validation_cache_key";
-- rollback ALTER TABLE "public"."job" DROP COLUMN "cache_key";
-- rollback ALTER TABLE "public"."job" DROP COLUMN "progress_message";
