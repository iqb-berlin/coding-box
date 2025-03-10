-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."logs"
(
  "id"          SERIAL
    PRIMARY KEY,
  "unit_id"      VARCHAR(50) NOT NULL,
  "test_group"   VARCHAR(100),
  "workspace_id" INTEGER NOT NULL,
  "log_entry"    VARCHAR(100),
  "timestamp"    BIGINT,
  "booklet_id"   VARCHAR(100)
);
-- rollback DROP TABLE "public"."logs";

