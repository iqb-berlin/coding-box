-- liquibase formatted sql

-- changeset iqb:917-replay-request-correlation
-- comment: Store opaque replay attempt and request identifiers for diagnostics
ALTER TABLE "public"."replay_statistics"
  ADD COLUMN "replay_attempt_id" VARCHAR(128) NULL,
  ADD COLUMN "request_id" VARCHAR(128) NULL;

CREATE INDEX "replay_statistics_attempt_idx"
  ON "public"."replay_statistics" ("workspace_id", "replay_attempt_id")
  WHERE "replay_attempt_id" IS NOT NULL;

-- rollback DROP INDEX IF EXISTS "public"."replay_statistics_attempt_idx";
-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN IF EXISTS "request_id";
-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN IF EXISTS "replay_attempt_id";
