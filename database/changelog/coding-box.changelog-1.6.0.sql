-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add person_group column to coding_job_unit table

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "person_group" VARCHAR(255) NOT NULL DEFAULT '';

-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "person_group";

-- changeset jurei733:1
-- comment: Add workspace_id column to job_definitions table to match entity definition

-- Delete all existing job_definitions as this table is newly introduced and workspace-scoping is being added
DELETE FROM "public"."job_definitions";

ALTER TABLE "public"."job_definitions" ADD COLUMN "workspace_id" INTEGER NOT NULL;

-- Add index for performance
CREATE INDEX "IDX_job_definitions_workspace_id" ON "public"."job_definitions" ("workspace_id");

-- rollback DROP INDEX IF EXISTS "IDX_job_definitions_workspace_id";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN "workspace_id";
-- rollback -- Cannot rollback the DELETE statement
