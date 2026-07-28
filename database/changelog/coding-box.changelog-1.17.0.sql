-- liquibase formatted sql

-- changeset jurei733:819-1
-- comment: Add centrally managed, scheduled system notifications
CREATE TABLE "public"."system_notification" (
  "id" SERIAL PRIMARY KEY,
  "type" VARCHAR(20) NOT NULL,
  "severity" VARCHAR(20) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "message" VARCHAR(2000) NOT NULL,
  "starts_at" TIMESTAMP WITH TIME ZONE,
  "ends_at" TIMESTAMP WITH TIME ZONE,
  "visible_from" TIMESTAMP WITH TIME ZONE,
  "visible_until" TIMESTAMP WITH TIME ZONE,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "dismissible" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "chk_system_notification_type"
    CHECK ("type" IN ('update', 'maintenance', 'outage', 'info')),
  CONSTRAINT "chk_system_notification_severity"
    CHECK ("severity" IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT "chk_system_notification_event_window"
    CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at"),
  CONSTRAINT "chk_system_notification_visibility_window"
    CHECK ("visible_until" IS NULL OR "visible_from" IS NULL OR "visible_until" > "visible_from")
);

CREATE INDEX "idx_system_notification_visibility"
  ON "public"."system_notification" ("enabled", "visible_from", "visible_until");

-- rollback DROP TABLE "public"."system_notification";

-- changeset iqb:910-response-value-prefix-trigram-index runInTransaction:false
--validCheckSum: 9:24df5085f5581c17d5730dc56c66d2eb
-- comment: Accelerate substring searches over the first 2000 response value characters
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_value_prefix_search_trgm";
DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_value_search_trgm";

CREATE INDEX CONCURRENTLY "idx_response_value_prefix_search_trgm"
  ON "public"."response" USING GIN ((LEFT("value", 2000)) gin_trgm_ops)
  WHERE "is_autocoder_generated" IS NOT TRUE;

-- rollback DROP INDEX CONCURRENTLY IF EXISTS "public"."idx_response_value_prefix_search_trgm";

-- changeset jurei733:917-replay-request-correlation
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

-- changeset jurei733:839-job-definition-name-description
-- comment: Add user-facing names and descriptions to job definitions
ALTER TABLE "public"."job_definitions"
  ADD COLUMN "name" VARCHAR(255),
  ADD COLUMN "description" TEXT;

UPDATE "public"."job_definitions"
SET "name" = 'Definition #' || "id";

ALTER TABLE "public"."job_definitions"
  ALTER COLUMN "name" SET NOT NULL;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "description";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "name";

-- changeset jurei733:838-double-coding-review-decisions
-- comment: Persist manager drafts and immutable decisions for double-coding review
CREATE TABLE "public"."double_coding_review_decision" (
  "id" SERIAL PRIMARY KEY,
  "workspace_id" INTEGER NOT NULL,
  "response_id" INTEGER NOT NULL,
  "manager_user_id" INTEGER NULL,
  "manager_key" VARCHAR(255) NOT NULL,
  "manager_name" VARCHAR(255) NOT NULL,
  "state" VARCHAR(16) NOT NULL,
  "selected_code" BIGINT NULL,
  "effective_code" BIGINT NULL,
  "score" BIGINT NULL,
  "comment" TEXT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "finalized_at" TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT "double_coding_review_decision_state_check"
    CHECK ("state" IN ('draft', 'applied', 'superseded')),
  CONSTRAINT "double_coding_review_decision_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace" ("id") ON DELETE CASCADE,
  CONSTRAINT "double_coding_review_decision_response_fk"
    FOREIGN KEY ("response_id") REFERENCES "public"."response" ("id") ON DELETE CASCADE,
  CONSTRAINT "double_coding_review_decision_manager_fk"
    FOREIGN KEY ("manager_user_id") REFERENCES "public"."user" ("id") ON DELETE SET NULL
);

CREATE INDEX "double_coding_review_decision_response_idx"
  ON "public"."double_coding_review_decision" ("workspace_id", "response_id");

CREATE UNIQUE INDEX "double_coding_review_decision_open_draft_idx"
  ON "public"."double_coding_review_decision" ("workspace_id", "response_id", "manager_user_id")
  WHERE "state" = 'draft';

-- rollback DROP TABLE IF EXISTS "public"."double_coding_review_decision";
