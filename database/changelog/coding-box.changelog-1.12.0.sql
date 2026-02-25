-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Add case_ordering_mode to coding_job_variable_bundle and variable_bundle_id to coding_job_unit

ALTER TABLE "public"."coding_job_variable_bundle" ADD COLUMN "case_ordering_mode" VARCHAR(20);

ALTER TABLE "public"."coding_job_unit" ADD COLUMN "variable_bundle_id" INTEGER;

ALTER TABLE "public"."coder_training" ADD COLUMN "case_ordering_mode" VARCHAR(20) NOT NULL DEFAULT 'continuous';

ALTER TABLE "public"."coder_training_bundle" ADD COLUMN "case_ordering_mode" VARCHAR(20);

-- rollback ALTER TABLE "public"."coder_training_bundle" DROP COLUMN "case_ordering_mode";
-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN "case_ordering_mode";
-- rollback ALTER TABLE "public"."coding_job_unit" DROP COLUMN "variable_bundle_id";
-- rollback ALTER TABLE "public"."coding_job_variable_bundle" DROP COLUMN "case_ordering_mode";
