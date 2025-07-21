-- liquibase formatted sql

-- changeset jurei733:1
-- The consider field is used to mark test takers as excluded from consideration
-- When set to false, the test taker is excluded and not included in reports or analysis
ALTER TABLE "public"."persons" ADD COLUMN IF NOT EXISTS "consider" BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_persons_consider ON "public"."persons"(consider);
CREATE INDEX IF NOT EXISTS idx_persons_workspace_consider ON "public"."persons"(workspace_id, consider);

-- rollback ALTER TABLE "public"."persons" DROP COLUMN IF EXISTS "consider"; DROP INDEX IF EXISTS idx_persons_consider; DROP INDEX IF EXISTS idx_persons_workspace_consider;
