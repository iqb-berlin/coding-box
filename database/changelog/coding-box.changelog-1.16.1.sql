-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Persist DERIVE_ERROR opt-in for coder-training variables

ALTER TABLE "public"."coder_training_variable"
  ADD COLUMN "include_derive_error" BOOLEAN NOT NULL DEFAULT FALSE;

-- rollback ALTER TABLE "public"."coder_training_variable" DROP COLUMN IF EXISTS "include_derive_error";
