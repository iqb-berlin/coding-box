-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."variable_analysis_job" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "unit_id" INTEGER,
  "variable_id" VARCHAR(255),
  "status" VARCHAR(50) NOT NULL,
  "error" TEXT,
  "result" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_variable_analysis_job_workspace_id" ON "public"."variable_analysis_job" ("workspace_id");
CREATE INDEX "idx_variable_analysis_job_status" ON "public"."variable_analysis_job" ("status");

-- rollback DROP TABLE IF EXISTS "public"."variable_analysis_job";
