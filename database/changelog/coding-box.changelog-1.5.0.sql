-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add notes column to coding_job_unit table for storing coder notes

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "notes" TEXT NULL;

-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "notes";

-- changeset jurei733:1
-- comment: Add comment column to coding_job table for storing job-level comments

ALTER TABLE "public"."coding_job" ADD COLUMN "comment" TEXT NULL;

-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN "comment";

-- changeset jurei733:2
-- comment: Create job_definitions table for storing coding job duration configuration

CREATE TABLE "public"."job_definitions" (
  "id" SERIAL NOT NULL,
  "coding_job_id" INTEGER NOT NULL,
  "duration_seconds" INTEGER NULL,
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "PK_job_definitions" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_job_definitions_coding_job_id" UNIQUE ("coding_job_id"),
  CONSTRAINT "FK_job_definitions_coding_job_id" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- rollback DROP TABLE "public"."job_definitions";

-- changeset jurei733:3
-- comment: Add max_coding_cases column to job_definitions table for limiting maximum number of coding cases

ALTER TABLE "public"."job_definitions" ADD COLUMN "max_coding_cases" INTEGER NULL;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "max_coding_cases";

-- changeset jurei733:4
-- comment: Add double coding configuration fields to job_definitions table

ALTER TABLE "public"."job_definitions" ADD COLUMN "double_coding_absolute" INTEGER NULL;
ALTER TABLE "public"."job_definitions" ADD COLUMN "double_coding_percentage" DECIMAL(5,2) NULL;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "double_coding_absolute";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "double_coding_percentage";

-- changeset jurei733:5
-- comment: Add approval workflow and assigned resources columns to job_definitions table

-- Make coding_job_id nullable to allow independent job definitions
ALTER TABLE "public"."job_definitions" ALTER COLUMN "coding_job_id" DROP NOT NULL;

-- Add status column for approval workflow
CREATE TYPE job_definition_status AS ENUM('draft', 'pending_review', 'approved');
ALTER TABLE "public"."job_definitions" ADD COLUMN "status" job_definition_status NOT NULL DEFAULT 'draft';

-- Add assigned resources columns
ALTER TABLE "public"."job_definitions" ADD COLUMN "assigned_variables" JSONB NULL;
ALTER TABLE "public"."job_definitions" ADD COLUMN "assigned_variable_bundles" JSONB NULL;
ALTER TABLE "public"."job_definitions" ADD COLUMN "assigned_coders" JSONB NULL;

-- rollback DROP TYPE IF EXISTS job_definition_status;
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "status";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_variables";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_variable_bundles";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_coders";
-- rollback ALTER TABLE "public"."job_definitions" ALTER COLUMN "coding_job_id" SET NOT NULL;
