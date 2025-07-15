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

-- changeset jurei733:2
CREATE TABLE "public"."test_person_coding_job" (
                                                 "id" SERIAL PRIMARY KEY,
                                                 "workspace_id" INTEGER NOT NULL,
                                                 "person_ids" TEXT,
                                                 "status" VARCHAR(50) NOT NULL,
                                                 "progress" INTEGER,
                                                 "error" TEXT,
                                                 "result" TEXT,
                                                 "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
                                                 "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_test_person_coding_job_workspace_id" ON "public"."test_person_coding_job" ("workspace_id");
CREATE INDEX "idx_test_person_coding_job_status" ON "public"."test_person_coding_job" ("status");

-- rollback DROP TABLE IF EXISTS "public"."test_person_coding_job";

-- changeset jurei733:3
CREATE TABLE "public"."job" (
                              "id" SERIAL PRIMARY KEY,
                              "workspace_id" INTEGER NOT NULL,
                              "type" VARCHAR(50) NOT NULL,
                              "status" VARCHAR(50) NOT NULL,
                              "progress" INTEGER,
                              "error" TEXT,
                              "result" TEXT,
                              "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
                              "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "idx_job_workspace_id" ON "public"."job" ("workspace_id");
CREATE INDEX "idx_job_type" ON "public"."job" ("type");
CREATE INDEX "idx_job_status" ON "public"."job" ("status");
-- rollback DROP TABLE IF EXISTS "public"."job";

-- changeset jurei733:4

ALTER TABLE "public"."job" ADD COLUMN "unit_id" INTEGER;
ALTER TABLE "public"."job" ADD COLUMN "variable_id" VARCHAR(255);
-- rollback ALTER TABLE "public"."job" DROP COLUMN "unit_id"; ALTER TABLE "public"."job" DROP COLUMN "variable_id";

-- changeset jurei733:5

ALTER TABLE "public"."job" ADD COLUMN "person_ids" TEXT;
-- rollback ALTER TABLE "public"."job" DROP COLUMN "person_ids";

-- changeset jurei733:6

ALTER TABLE "public"."job" ADD COLUMN "group_names" TEXT;
-- rollback ALTER TABLE "public"."job" DROP COLUMN "group_names";

-- changeset jurei733:7

ALTER TABLE "public"."job" ADD COLUMN "duration_ms" BIGINT;
-- rollback ALTER TABLE "public"."job" DROP COLUMN "duration_ms";

