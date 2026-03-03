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

-- changeset jurei733:2
-- comment: Persist coder-training discussion results per training/response for comparison table

CREATE TABLE "public"."coder_training_discussion_result" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "training_id" INTEGER NOT NULL,
  "response_id" INTEGER NOT NULL,
  "code" INTEGER,
  "score" INTEGER,
  "manager_user_id" INTEGER,
  "manager_name" VARCHAR(255),
  "created_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE "public"."coder_training_discussion_result"
  ADD CONSTRAINT "uq_coder_training_discussion_result_training_response"
  UNIQUE ("training_id", "response_id");

ALTER TABLE "public"."coder_training_discussion_result"
  ADD CONSTRAINT "fk_coder_training_discussion_result_training"
  FOREIGN KEY ("training_id") REFERENCES "public"."coder_training"("id") ON DELETE CASCADE;

ALTER TABLE "public"."coder_training_discussion_result"
  ADD CONSTRAINT "fk_coder_training_discussion_result_response"
  FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE CASCADE;

ALTER TABLE "public"."coder_training_discussion_result"
  ADD CONSTRAINT "fk_coder_training_discussion_result_manager_user"
  FOREIGN KEY ("manager_user_id") REFERENCES "public"."user"("id") ON DELETE SET NULL;

CREATE INDEX "idx_coder_training_discussion_result_workspace_training"
  ON "public"."coder_training_discussion_result" ("workspace_id", "training_id");

CREATE INDEX "idx_coder_training_discussion_result_manager_user"
  ON "public"."coder_training_discussion_result" ("manager_user_id");

-- rollback DROP TABLE "public"."coder_training_discussion_result";
