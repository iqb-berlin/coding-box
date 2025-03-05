-- liquibase formatted sql

-- changeset jurei733:1
ALTER TABLE "public"."workspace_user" ADD access_level int NULL;
-- rollback ALTER TABLE "public"."workspace_user" DROP COLUMN access_level;

