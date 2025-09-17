-- liquibase formatted sql

-- changeset julian:1
ALTER TABLE "public"."file_upload" ADD CONSTRAINT "file_upload_workspace_fileid" UNIQUE ("workspace_id", "file_id");
-- rollback ALTER TABLE "public"."file_upload" DROP CONSTRAINT IF EXISTS "file_upload_workspace_fileid";
