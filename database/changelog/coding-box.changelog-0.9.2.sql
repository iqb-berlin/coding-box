-- liquibase formatted sql

-- changeset jurei733:1
ALTER TABLE "public"."job" ADD COLUMN "validation_type" VARCHAR(50);
ALTER TABLE "public"."job" ADD COLUMN "page" INTEGER;
ALTER TABLE "public"."job" ADD COLUMN "limit" INTEGER;

CREATE INDEX "idx_job_validation_type" ON "public"."job" ("validation_type");

-- rollback ALTER TABLE "public"."job" DROP COLUMN "validation_type"; ALTER TABLE "public"."job" DROP COLUMN "page"; ALTER TABLE "public"."job" DROP COLUMN "limit"; DROP INDEX IF EXISTS "idx_job_validation_type";

-- changeset jurei733:2
CREATE INDEX idx_responses_unitid ON response(unitid);
CREATE INDEX idx_responses_variableid ON response(variableid);
CREATE INDEX idx_responses_codedstatus ON response(codedstatus);

-- rollback DROP INDEX IF EXISTS idx_responses_unitid; DROP INDEX IF EXISTS idx_responses_variableid; DROP INDEX IF EXISTS idx_responses_codedstatus;

