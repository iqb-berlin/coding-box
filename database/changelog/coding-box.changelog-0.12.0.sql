-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE IF NOT EXISTS "job" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "status" VARCHAR(255) NOT NULL,
  "progress" INTEGER NULL,
  "error" VARCHAR(255) NULL,
  "result" TEXT NULL,
  "type" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- rollback DROP TABLE IF EXISTS "job";

-- changeset jurei733:2
CREATE TABLE IF NOT EXISTS "coding_job" (
  "id" INTEGER PRIMARY KEY REFERENCES "job"("id") ON DELETE CASCADE,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT NULL
);
-- rollback DROP TABLE IF EXISTS "coding_job";

-- changeset jurei733:3
CREATE INDEX IF NOT EXISTS "idx_job_workspace_id" ON "job"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_job_type" ON "job"("type");
CREATE INDEX IF NOT EXISTS "idx_coding_job_name" ON "coding_job"("name");
-- rollback DROP INDEX IF EXISTS "idx_job_workspace_id";
-- rollback DROP INDEX IF EXISTS "idx_job_type";
-- rollback DROP INDEX IF EXISTS "idx_coding_job_name";

-- changeset jurei733:4
CREATE TABLE IF NOT EXISTS "variable" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "unit_name" VARCHAR(255) NOT NULL,
  "variable_id" VARCHAR(255) NOT NULL
);
-- rollback DROP TABLE IF EXISTS "variable";

-- changeset jurei733:5
CREATE TABLE IF NOT EXISTS "variable_bundle" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- rollback DROP TABLE IF EXISTS "variable_bundle";

-- changeset jurei733:6
CREATE TABLE IF NOT EXISTS "coding_job_variable" (
  "coding_job_id" INTEGER NOT NULL REFERENCES "coding_job"("id") ON DELETE CASCADE,
  "variable_id" INTEGER NOT NULL REFERENCES "variable"("id") ON DELETE CASCADE,
  PRIMARY KEY ("coding_job_id", "variable_id")
);
-- rollback DROP TABLE IF EXISTS "coding_job_variable";

-- changeset jurei733:7
CREATE TABLE IF NOT EXISTS "coding_job_variable_bundle" (
  "coding_job_id" INTEGER NOT NULL REFERENCES "coding_job"("id") ON DELETE CASCADE,
  "variable_bundle_id" INTEGER NOT NULL REFERENCES "variable_bundle"("id") ON DELETE CASCADE,
  PRIMARY KEY ("coding_job_id", "variable_bundle_id")
);
-- rollback DROP TABLE IF EXISTS "coding_job_variable_bundle";

-- changeset jurei733:8
CREATE TABLE IF NOT EXISTS "variable_bundle_variables" (
  "bundle_id" INTEGER NOT NULL REFERENCES "variable_bundle"("id") ON DELETE CASCADE,
  "variable_bundle_id" INTEGER NOT NULL REFERENCES "variable"("id") ON DELETE CASCADE,
  PRIMARY KEY ("bundle_id", "variable_bundle_id")
);
-- rollback DROP TABLE IF EXISTS "variable_bundle_variables";

-- changeset jurei733:9
CREATE INDEX IF NOT EXISTS "idx_variable_workspace_id" ON "variable"("workspace_id");
CREATE INDEX IF NOT EXISTS "idx_variable_bundle_workspace_id" ON "variable_bundle"("workspace_id");
-- rollback DROP INDEX IF EXISTS "idx_variable_workspace_id";
-- rollback DROP INDEX IF EXISTS "idx_variable_bundle_workspace_id";

-- changeset jurei733:10
CREATE TABLE IF NOT EXISTS "coding_job_coders" (
  "coding_job_id" INTEGER NOT NULL REFERENCES "coding_job"("id") ON DELETE CASCADE,
  "coder_id" INTEGER NOT NULL,
  PRIMARY KEY ("coding_job_id", "coder_id")
);
-- rollback DROP TABLE IF EXISTS "coding_job_coders";

-- changeset jurei733:11
ALTER TABLE "variable_bundle_variables"
RENAME COLUMN "variable_bundle_id" TO "variable_id";
-- rollback ALTER TABLE "variable_bundle_variables" RENAME COLUMN "variable_id" TO "variable_bundle_id";
