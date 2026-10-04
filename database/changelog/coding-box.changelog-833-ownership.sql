-- liquibase formatted sql

-- changeset iqb:833-resource-ownership
-- comment: Record immutable resource creators; existing resources remain unassigned
ALTER TABLE "public"."variable_bundle"
  ADD COLUMN "creator_user_id" INTEGER NULL REFERENCES "public"."user" ("id") ON DELETE SET NULL;
ALTER TABLE "public"."job_definitions"
  ADD COLUMN "creator_user_id" INTEGER NULL REFERENCES "public"."user" ("id") ON DELETE SET NULL;
ALTER TABLE "public"."coding_job"
  ADD COLUMN "creator_user_id" INTEGER NULL REFERENCES "public"."user" ("id") ON DELETE SET NULL;
ALTER TABLE "public"."coder_training"
  ADD COLUMN "creator_user_id" INTEGER NULL REFERENCES "public"."user" ("id") ON DELETE SET NULL;

CREATE INDEX "variable_bundle_workspace_creator_idx" ON "public"."variable_bundle" ("workspace_id", "creator_user_id");
CREATE INDEX "job_definitions_workspace_creator_idx" ON "public"."job_definitions" ("workspace_id", "creator_user_id");
CREATE INDEX "coding_job_workspace_creator_idx" ON "public"."coding_job" ("workspace_id", "creator_user_id");
CREATE INDEX "coder_training_workspace_creator_idx" ON "public"."coder_training" ("workspace_id", "creator_user_id");

-- rollback ALTER TABLE "public"."coder_training" DROP COLUMN "creator_user_id";
-- rollback ALTER TABLE "public"."coding_job" DROP COLUMN "creator_user_id";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN "creator_user_id";
-- rollback ALTER TABLE "public"."variable_bundle" DROP COLUMN "creator_user_id";
