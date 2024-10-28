-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."logs"
(
  "id"           SERIAL PRIMARY KEY,
  "unit_id"      VARCHAR(50) NOT NULL,
  "test_group"   VARCHAR(100),
  "workspace_id" INTEGER NOT NULL,
  "log_entry"    VARCHAR(100),
  "timestamp"    BIGINT,
  "booklet_id"   VARCHAR(100)
);
-- rollback DROP TABLE "public"."logs";

-- changeset jurei733:2
CREATE TABLE "public"."persons" (
  "id"            SERIAL PRIMARY KEY,
  "group"         VARCHAR(100) NOT NULL,
  "login"         VARCHAR(100) NOT NULL,
  "code"          VARCHAR(100) NOT NULL,
  "booklets"      JSONB,
  "workspace_id"  INTEGER,
  "uploaded_at"   TIMESTAMP WITH TIME ZONE DEFAULT now(),
  "source"        VARCHAR(100)
);
-- rollback DROP TABLE "public"."persons";
