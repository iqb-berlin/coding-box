-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE IF NOT EXISTS "public"."coding_job" (
                                                   "id" INTEGER PRIMARY KEY REFERENCES "public"."job"("id") ON DELETE CASCADE,
                                                   "name" VARCHAR(255) NOT NULL,
                                                   "description" TEXT NULL
);
-- rollback DROP TABLE IF EXISTS "public"."coding_job";

-- changeset jurei733:2
CREATE INDEX IF NOT EXISTS "idx_coding_job_name" ON "public"."coding_job"("name");
-- rollback DROP INDEX IF EXISTS "idx_coding_job_name" ON "public"."coding_job";

-- changeset jurei733:3
CREATE TABLE IF NOT EXISTS "public"."variable" (
                                                 "id" SERIAL PRIMARY KEY,
                                                 "workspace_id" INTEGER NOT NULL,
                                                 "unit_name" VARCHAR(255) NOT NULL,
                                                 "variable_id" VARCHAR(255) NOT NULL
);
-- rollback DROP TABLE IF EXISTS "public"."variable";

-- changeset jurei733:4
CREATE TABLE IF NOT EXISTS "public"."variable_bundle" (
                                                        "id" SERIAL PRIMARY KEY,
                                                        "workspace_id" INTEGER NOT NULL,
                                                        "name" VARCHAR(255) NOT NULL,
                                                        "description" TEXT NULL,
                                                        "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                                        "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- rollback DROP TABLE IF EXISTS "public"."variable_bundle";

-- changeset jurei733:5
CREATE TABLE IF NOT EXISTS "public"."coding_job_variable" (
                                                            "coding_job_id" INTEGER NOT NULL REFERENCES "public"."coding_job"("id") ON DELETE CASCADE,
                                                            "variable_id" INTEGER NOT NULL REFERENCES "public"."variable"("id") ON DELETE CASCADE,
                                                            PRIMARY KEY ("coding_job_id", "variable_id")
);
-- rollback DROP TABLE IF EXISTS "public"."coding_job_variable";

-- changeset jurei733:6
CREATE TABLE IF NOT EXISTS "public"."coding_job_variable_bundle" (
                                                                   "coding_job_id" INTEGER NOT NULL REFERENCES "public"."coding_job"("id") ON DELETE CASCADE,
                                                                   "variable_bundle_id" INTEGER NOT NULL REFERENCES "public"."variable_bundle"("id") ON DELETE CASCADE,
                                                                   PRIMARY KEY ("coding_job_id", "variable_bundle_id")
);
-- rollback DROP TABLE IF EXISTS "public"."coding_job_variable_bundle";

-- changeset jurei733:7
CREATE TABLE IF NOT EXISTS "public"."variable_bundle_variables" (
                                                                  "bundle_id" INTEGER NOT NULL REFERENCES "public"."variable_bundle"("id") ON DELETE CASCADE,
                                                                  "variable_bundle_id" INTEGER NOT NULL REFERENCES "public"."variable"("id") ON DELETE CASCADE,
                                                                  PRIMARY KEY ("bundle_id", "variable_bundle_id")
);
-- rollback DROP TABLE IF EXISTS "public"."variable_bundle_variables";

-- changeset jurei733:8
CREATE TABLE IF NOT EXISTS "public"."coding_job_coders" (
                                                          "coding_job_id" INTEGER NOT NULL REFERENCES "public"."coding_job"("id") ON DELETE CASCADE,
                                                          "coder_id" INTEGER NOT NULL,
                                                          PRIMARY KEY ("coding_job_id", "coder_id")
);
-- rollback DROP TABLE IF EXISTS "public"."coding_job_coders";
