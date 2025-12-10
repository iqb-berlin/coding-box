-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add case_ordering_mode column to coding_job table for preserving case sorting when job is started

ALTER TABLE "public"."coding_job" ADD COLUMN "case_ordering_mode" VARCHAR(20) NOT NULL DEFAULT 'continuous';

-- Add check constraint to ensure only valid values
ALTER TABLE "public"."coding_job" ADD CONSTRAINT "check_coding_job_case_ordering_mode" 
  CHECK ("case_ordering_mode" IN ('continuous', 'alternating'));

-- rollback ALTER TABLE "public"."coding_job" DROP CONSTRAINT "check_coding_job_case_ordering_mode";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN "case_ordering_mode";
