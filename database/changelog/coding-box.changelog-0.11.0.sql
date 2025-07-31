-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE setting (
  key VARCHAR(255) PRIMARY KEY NOT NULL,
  content TEXT NOT NULL
);

-- rollback DROP TABLE IF EXISTS setting;

-- changeset jurei733:2
ALTER TABLE "public"."file_upload" ADD COLUMN "structured_data" JSONB NULL;
-- rollback ALTER TABLE "public"."file_upload" DROP COLUMN "structured_data";

-- changeset jurei733:3
CREATE TABLE replay_statistics (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  workspace_id INTEGER NOT NULL,
  unit_id VARCHAR(255) NOT NULL,
  booklet_id VARCHAR(255) NULL,
  test_person_login VARCHAR(255) NULL,
  test_person_code VARCHAR(255) NULL,
  duration_milliseconds INTEGER NOT NULL,
  replay_url VARCHAR(2000) NULL
);

-- rollback DROP TABLE IF EXISTS replay_statistics;

-- changeset jurei733:4
ALTER TABLE "public"."replay_statistics" ADD COLUMN "success" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "public"."replay_statistics" ADD COLUMN "error_message" VARCHAR(2000) NULL;
-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN "success";
-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN "error_message";
