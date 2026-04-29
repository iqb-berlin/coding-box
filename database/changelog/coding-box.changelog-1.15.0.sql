-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Mark autocoder-generated response rows so repeated runs do not use their own generated outputs as input

ALTER TABLE "public"."response"
  ADD COLUMN "is_autocoder_generated" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX "idx_response_is_autocoder_generated"
  ON "public"."response" ("is_autocoder_generated");

CREATE UNIQUE INDEX "uq_response_autocoder_generated_key"
  ON "public"."response" ("unitid", "variableid", COALESCE("subform", ''))
  WHERE "is_autocoder_generated" IS TRUE;

-- rollback DROP INDEX IF EXISTS "public"."uq_response_autocoder_generated_key";
-- rollback DROP INDEX IF EXISTS "public"."idx_response_is_autocoder_generated";
-- rollback ALTER TABLE "public"."response" DROP COLUMN IF EXISTS "is_autocoder_generated";
