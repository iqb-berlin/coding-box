-- liquibase formatted sql

-- changeset jurei733:813-1
-- comment: Extend the existing workspace revision with a coding-status revision
ALTER TABLE "public"."workspace_test_results_revision"
  ADD COLUMN IF NOT EXISTS "status_revision" BIGINT NOT NULL DEFAULT 0;

-- rollback ALTER TABLE "public"."workspace_test_results_revision" DROP COLUMN IF EXISTS "status_revision";
