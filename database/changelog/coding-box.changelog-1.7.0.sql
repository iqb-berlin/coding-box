-- liquibase formatted sql

-- changeset jurei733:0
-- comment: Add case_ordering_mode column to job_definitions table for configurable case sorting

ALTER TABLE "public"."job_definitions" ADD COLUMN "case_ordering_mode" VARCHAR(20) NOT NULL DEFAULT 'continuous';

-- Add check constraint to ensure only valid values
ALTER TABLE "public"."job_definitions" ADD CONSTRAINT "check_case_ordering_mode" 
  CHECK ("case_ordering_mode" IN ('continuous', 'alternating'));

-- rollback ALTER TABLE "public"."job_definitions" DROP CONSTRAINT "check_case_ordering_mode";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN "case_ordering_mode";
