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

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "status";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_variables";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_variable_bundles";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "assigned_coders";
-- rollback ALTER TABLE "public"."job_definitions" ALTER COLUMN "coding_job_id" SET NOT NULL;
-- rollback DROP TYPE IF EXISTS job_definition_status;

-- changeset jurei733:6
-- comment: Change job_definitions and coding_job relationship from one-to-one to many-to-one

-- Add job_definition_id column to coding_job table
ALTER TABLE "public"."coding_job" ADD COLUMN "job_definition_id" INTEGER NULL;

-- Add foreign key constraint
ALTER TABLE "public"."coding_job" ADD CONSTRAINT "FK_coding_job_job_definition_id" FOREIGN KEY ("job_definition_id") REFERENCES "public"."job_definitions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Drop old foreign key from job_definitions
ALTER TABLE "public"."job_definitions" DROP CONSTRAINT IF EXISTS "FK_job_definitions_coding_job_id";

-- Drop old unique constraint
ALTER TABLE "public"."job_definitions" DROP CONSTRAINT IF EXISTS "UQ_job_definitions_coding_job_id";

-- Remove old coding_job_id column from job_definitions
ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "coding_job_id";

-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "job_definition_id";
-- rollback ALTER TABLE "public"."job_definitions" DROP CONSTRAINT IF EXISTS "FK_coding_job_job_definition_id";
-- rollback ALTER TABLE "public"."job_definitions" ADD COLUMN "coding_job_id" INTEGER NULL;
-- rollback ALTER TABLE "public"."job_definitions" ADD CONSTRAINT "UQ_job_definitions_coding_job_id" UNIQUE ("coding_job_id");
-- rollback ALTER TABLE "public"."job_definitions" ADD CONSTRAINT "FK_job_definitions_coding_job_id" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- changeset jurei733:7
-- comment: Add coding display options to coding_job table for controlling UI elements during coding

ALTER TABLE "public"."coding_job" ADD COLUMN "show_score" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."coding_job" ADD COLUMN "allow_comments" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "public"."coding_job" ADD COLUMN "suppress_general_instructions" BOOLEAN NOT NULL DEFAULT false;

-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "show_score";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "allow_comments";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN IF EXISTS "suppress_general_instructions";

-- changeset jurei733:8
-- comment: Add uncertain column to coding_job_unit table for storing uncertain coding information as integer

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "uncertain" INTEGER NULL;

-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "uncertain";

-- changeset jurei733:9
-- comment: Rename uncertain column to coding_issue_option to match entity property naming

ALTER TABLE "public"."coding_job_unit" RENAME COLUMN "uncertain" TO "coding_issue_option";

-- rollback ALTER TABLE "public"."coding_job_unit" RENAME COLUMN "coding_issue_option" TO "uncertain";
