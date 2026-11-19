-- liquibase formatted sql

-- changeset iqb:1029-response-cache-unit-index runInTransaction:false
-- comment: Match the response cache warmup cursor and sort order without blocking writes to unit.
-- Drop a possible invalid index left behind by an interrupted concurrent build before retrying.
DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_unit_bookletid_id";

CREATE INDEX CONCURRENTLY "idx_unit_bookletid_id"
  ON "public"."unit" ("bookletid", "id");

-- rollback DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_unit_bookletid_id";
