-- liquibase formatted sql

-- changeset jurei733:1
--validCheckSum: 9:07488bba2e47a938b6e337fe296cc376
-- comment: Persist DERIVE_ERROR opt-in for coder-training variables

ALTER TABLE "public"."coder_training_variable"
  ADD COLUMN IF NOT EXISTS "include_derive_error" BOOLEAN NOT NULL DEFAULT FALSE;

-- rollback ALTER TABLE "public"."coder_training_variable" DROP COLUMN IF EXISTS "include_derive_error";

-- changeset jurei733:2
-- comment: Persist full display options for coder trainings

ALTER TABLE "public"."coder_training"
  ADD COLUMN IF NOT EXISTS "show_score" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allow_comments" BOOLEAN NOT NULL DEFAULT true;

-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN IF EXISTS "allow_comments";
-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN IF EXISTS "show_score";
