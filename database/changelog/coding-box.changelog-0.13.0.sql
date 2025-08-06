-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."coding_job" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_coding_job_workspace_id" ON "public"."coding_job" ("workspace_id");
CREATE INDEX "idx_coding_job_status" ON "public"."coding_job" ("status");

-- rollback DROP TABLE IF EXISTS "public"."coding_job";

-- changeset jurei733:2
CREATE TABLE "public"."coding_job_coder" (
  "id" SERIAL PRIMARY KEY,
  "coding_job_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "fk_coding_job_coder_coding_job" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coding_job_coder_coding_job_id" ON "public"."coding_job_coder" ("coding_job_id");
CREATE INDEX "idx_coding_job_coder_user_id" ON "public"."coding_job_coder" ("user_id");

-- rollback DROP TABLE IF EXISTS "public"."coding_job_coder";

-- changeset jurei733:3
CREATE TABLE "public"."coding_job_variable" (
  "id" SERIAL PRIMARY KEY,
  "coding_job_id" INTEGER NOT NULL,
  "unit_name" VARCHAR(255) NOT NULL,
  "variable_id" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "fk_coding_job_variable_coding_job" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coding_job_variable_coding_job_id" ON "public"."coding_job_variable" ("coding_job_id");

-- rollback DROP TABLE IF EXISTS "public"."coding_job_variable";

-- changeset jurei733:4
CREATE TABLE "public"."coding_job_variable_bundle" (
  "id" SERIAL PRIMARY KEY,
  "coding_job_id" INTEGER NOT NULL,
  "variable_bundle_id" INTEGER NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "fk_coding_job_variable_bundle_coding_job" FOREIGN KEY ("coding_job_id") REFERENCES "public"."coding_job" ("id") ON DELETE CASCADE,
  CONSTRAINT "fk_coding_job_variable_bundle_variable_bundle" FOREIGN KEY ("variable_bundle_id") REFERENCES "public"."variable_bundle" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_coding_job_variable_bundle_coding_job_id" ON "public"."coding_job_variable_bundle" ("coding_job_id");
CREATE INDEX "idx_coding_job_variable_bundle_variable_bundle_id" ON "public"."coding_job_variable_bundle" ("variable_bundle_id");

-- rollback DROP TABLE IF EXISTS "public"."coding_job_variable_bundle";
