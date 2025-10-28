-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add notes column to coding_job_unit table for storing coder notes

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "notes" TEXT NULL;

-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "notes";
