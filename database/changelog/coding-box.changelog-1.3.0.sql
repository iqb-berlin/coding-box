-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Create coder_training table to track coder training sessions

CREATE TABLE "public"."coder_training" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "label" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

-- rollback DROP TABLE IF EXISTS "public"."coder_training";

-- changeset jurei733:1
-- comment: Add training_id column to coding_job table to link jobs to trainings

ALTER TABLE "public"."coding_job" ADD COLUMN "training_id" INTEGER NULL;
ALTER TABLE "public"."coding_job" ADD CONSTRAINT "fk_coding_job_training_id" FOREIGN KEY ("training_id") REFERENCES "public"."coder_training" ("id") ON DELETE SET NULL;

CREATE INDEX "idx_coding_job_training_id" ON "public"."coding_job" ("training_id");

-- rollback ALTER TABLE "public"."coding_job" DROP CONSTRAINT IF EXISTS "fk_coding_job_training_id";
-- rollback DROP INDEX IF EXISTS "idx_coding_job_training_id";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN "training_id";

-- changeset jurei733:2
-- comment: Add is_open column to coding_job_unit table to track units marked as open

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "is_open" BOOLEAN DEFAULT FALSE;

-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "is_open";
