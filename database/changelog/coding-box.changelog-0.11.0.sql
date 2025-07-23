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
