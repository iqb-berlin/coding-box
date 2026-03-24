-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Add case selection mode and reference training options to coder_training

ALTER TABLE "public"."coder_training" ADD COLUMN "case_selection_mode" VARCHAR(30) NOT NULL DEFAULT 'oldest_first';

ALTER TABLE "public"."coder_training" ADD COLUMN "reference_training_ids" JSONB;

ALTER TABLE "public"."coder_training" ADD COLUMN "reference_mode" VARCHAR(20);

ALTER TABLE "public"."coder_training" ADD CONSTRAINT "check_coder_training_case_selection_mode"
  CHECK ("case_selection_mode" IN ('oldest_first', 'newest_first', 'random', 'random_per_testgroup', 'random_testgroups'));

ALTER TABLE "public"."coder_training" ADD CONSTRAINT "check_coder_training_reference_mode"
  CHECK ("reference_mode" IS NULL OR "reference_mode" IN ('same', 'different'));

-- rollback ALTER TABLE "public"."coder_training" DROP CONSTRAINT "check_coder_training_reference_mode";
-- rollback ALTER TABLE "public"."coder_training" DROP CONSTRAINT "check_coder_training_case_selection_mode";
-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN "reference_mode";
-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN "reference_training_ids";
-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN "case_selection_mode";

-- changeset jurei733:2
-- comment: Add supervisor_comment to coding_job_unit and clean up legacy ghost-append headers in response values

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "supervisor_comment" TEXT;

UPDATE "public"."response"
SET "value" = split_part("value", E'\n\n--- ORIGINAL RESPONSE ---\n', 2)
WHERE "value" LIKE E'%\n\n--- ORIGINAL RESPONSE ---\n%';

-- rollback UPDATE "public"."response" SET "value" = '[RESTORED]' || "value" WHERE "value" IS NOT NULL; -- Note: Rollback of data cleanup is imprecise without historical backup
-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "supervisor_comment";

-- changeset jurei733:3
-- comment: Add workspace_id to coding_job_unit for denormalization and query performance

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "workspace_id" INTEGER;

-- Populate workspace_id from linked coding_job
UPDATE "public"."coding_job_unit" cju
SET "workspace_id" = cj."workspace_id"
FROM "public"."coding_job" cj
WHERE cju."coding_job_id" = cj."id";

-- Add index as it is a primary filter column
CREATE INDEX "IDX_coding_job_unit_workspace_id" ON "public"."coding_job_unit" ("workspace_id");

-- rollback DROP INDEX IF EXISTS "IDX_coding_job_unit_workspace_id";
-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN IF EXISTS "workspace_id";


