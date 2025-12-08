-- liquibase formatted sql

-- changeset julian:1
-- comment: Fix persons unique constraint to include workspace_id to prevent data loss when importing test results across workspaces

-- Drop old unique constraints that don't include workspace_id
ALTER TABLE "public"."persons" DROP CONSTRAINT IF EXISTS "person_id";
ALTER TABLE "public"."persons" DROP CONSTRAINT IF EXISTS "persons_pk";
DROP INDEX IF EXISTS person_unique_idx;

-- Create new unique constraint that includes workspace_id
ALTER TABLE "public"."persons" ADD CONSTRAINT "persons_pk" UNIQUE ("code", "group", "login", "workspace_id");

CREATE UNIQUE INDEX person_unique_idx ON "public"."persons" ("code", "group", "login", "workspace_id");

-- rollback ALTER TABLE "public"."persons" DROP CONSTRAINT "persons_pk";
-- rollback DROP INDEX IF EXISTS person_unique_idx;
-- rollback ALTER TABLE "public"."persons" ADD CONSTRAINT person_id UNIQUE ("group", "login", "code");
-- rollback CREATE UNIQUE INDEX person_unique_idx ON "public"."persons" ("code", "group", "login");
