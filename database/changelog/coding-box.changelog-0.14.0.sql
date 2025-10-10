-- liquibase formatted sql

-- changeset jurei733:1
-- Add new columns to response table for coding functionality

ALTER TABLE "public"."response" ADD COLUMN "coded_status_v2" TEXT;
ALTER TABLE "public"."response" ADD COLUMN "coded_code_v2" INTEGER;
ALTER TABLE "public"."response" ADD COLUMN "coded_score_v2" INTEGER;
ALTER TABLE "public"."response" ADD COLUMN "coded_status_v3" TEXT;
ALTER TABLE "public"."response" ADD COLUMN "coded_code_v3" INTEGER;
ALTER TABLE "public"."response" ADD COLUMN "coded_score_v3" INTEGER;

-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "coded_status_v2";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "coded_code_v2";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "coded_score_v2";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "coded_status_v3";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "coded_code_v3";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "coded_score_v3";
