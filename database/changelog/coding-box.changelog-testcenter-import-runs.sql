-- liquibase formatted sql

-- changeset iqb:testcenter-durable-import-runs
-- comment: Retain Testcenter import outcomes independently of the progress cache
CREATE TABLE "public"."testcenter_import_run" (
  "workspace_id" INTEGER NOT NULL,
  "import_run_id" VARCHAR(128) NOT NULL,
  "progress" JSONB NOT NULL,
  PRIMARY KEY ("workspace_id", "import_run_id"),
  CONSTRAINT "testcenter_import_run_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id") ON DELETE CASCADE
);

-- rollback DROP TABLE "public"."testcenter_import_run";
