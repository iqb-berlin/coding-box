-- liquibase formatted sql

-- changeset jurei733:1 runInTransaction:false
-- comment: Add index for response status_v2 filtering without blocking writes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_response_status_v2"
  ON "public"."response" ("status_v2");

-- rollback DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_status_v2";

-- changeset jurei733:2 runInTransaction:false
-- comment: Add index for response status_v3 filtering without blocking writes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_response_status_v3"
  ON "public"."response" ("status_v3");

-- rollback DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_status_v3";
