-- liquibase formatted sql

-- changeset codex:1
-- comment: Add resource package metadata for global packages and version display

ALTER TABLE "public"."resource_package" ADD COLUMN "package_type" VARCHAR(30) NOT NULL DEFAULT 'resource';
ALTER TABLE "public"."resource_package" ADD COLUMN "scope" VARCHAR(20) NOT NULL DEFAULT 'workspace';
ALTER TABLE "public"."resource_package" ADD COLUMN "detected_version" VARCHAR(100);
ALTER TABLE "public"."resource_package" ADD COLUMN "content_hash" VARCHAR(64);
ALTER TABLE "public"."resource_package" ADD COLUMN "original_filename" VARCHAR(255);

ALTER TABLE "public"."resource_package" ADD CONSTRAINT "check_resource_package_type"
  CHECK ("package_type" IN ('resource', 'geogebra'));

ALTER TABLE "public"."resource_package" ADD CONSTRAINT "check_resource_package_scope"
  CHECK ("scope" IN ('workspace', 'global'));

UPDATE "public"."resource_package"
SET
  "package_type" = 'geogebra',
  "scope" = 'global',
  "workspaceId" = 0,
  "original_filename" = "name" || '.itcr.zip'
WHERE LOWER("name") = 'geogebra';

UPDATE "public"."resource_package"
SET "original_filename" = "name" || '.itcr.zip'
WHERE "original_filename" IS NULL;

-- rollback ALTER TABLE "public"."resource_package" DROP CONSTRAINT "check_resource_package_scope";
-- rollback ALTER TABLE "public"."resource_package" DROP CONSTRAINT "check_resource_package_type";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN "original_filename";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN "content_hash";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN "detected_version";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN "scope";
-- rollback ALTER TABLE "public"."resource_package" DROP COLUMN "package_type";
