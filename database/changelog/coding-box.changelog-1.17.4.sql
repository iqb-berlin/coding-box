-- liquibase formatted sql

-- changeset jurei733:1012-autocoder-finalization-outbox
-- comment: Persist post-commit autocoder cache finalization for durable retries
CREATE TABLE "public"."autocoder_finalization_task" (
  "id" BIGSERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "auto_coder_run" SMALLINT NOT NULL,
  "job_id" VARCHAR(128) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(4000) NULL,
  "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "locked_until" TIMESTAMP WITH TIME ZONE NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "autocoder_finalization_task_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id")
    ON DELETE CASCADE,
  CONSTRAINT "autocoder_finalization_task_run_check"
    CHECK ("auto_coder_run" IN (1, 2)),
  CONSTRAINT "autocoder_finalization_task_job_unique" UNIQUE ("job_id")
);

CREATE INDEX "autocoder_finalization_task_pending_idx"
  ON "public"."autocoder_finalization_task" ("next_attempt_at", "id");

-- rollback DROP TABLE IF EXISTS "public"."autocoder_finalization_task";
