-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add person_group column to coding_job_unit table

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "person_group" VARCHAR(255) NOT NULL DEFAULT '';

-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "person_group";
