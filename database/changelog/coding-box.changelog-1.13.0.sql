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
