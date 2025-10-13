-- liquibase formatted sql

-- changeset jurei733:1
-- Add new columns to response table for coding functionality

ALTER TABLE "public"."response" ADD COLUMN "status_v2" TEXT;
ALTER TABLE "public"."response" ADD COLUMN "code_v2" INTEGER;
ALTER TABLE "public"."response" ADD COLUMN "score_v2" INTEGER;
ALTER TABLE "public"."response" ADD COLUMN "status_v3" TEXT;
ALTER TABLE "public"."response" ADD COLUMN "code_v3" INTEGER;
ALTER TABLE "public"."response" ADD COLUMN "score_v3" INTEGER;

-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "status_v2";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "code_v2";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "score_v2";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "status_v3";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "code_v3";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "score_v3";

-- changeset jurei733:2
-- comment: Migrate response table columns from codedstatus to status_v1, code to code_v1, and score to score_v1
ALTER TABLE "public"."response" RENAME COLUMN "codedstatus" TO "status_v1";
ALTER TABLE "public"."response" RENAME COLUMN "code" TO "code_v1";
ALTER TABLE "public"."response" RENAME COLUMN "score" TO "score_v1";

-- rollback ALTER TABLE "public"."response" RENAME COLUMN "status_v1" TO "codedstatus";
-- rollback ALTER TABLE "public"."response" RENAME COLUMN "code_v1" TO "code";
-- rollback ALTER TABLE "public"."response" RENAME COLUMN "score_v1" TO "score";
