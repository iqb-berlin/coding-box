-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Extend workspace journal entries to support canonical audit events

ALTER TABLE "public"."journal_entries"
  ADD COLUMN IF NOT EXISTS "actor_user_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "actor_type" VARCHAR(20) NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS "event_type" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "result" VARCHAR(20) NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS "summary" TEXT,
  ADD COLUMN IF NOT EXISTS "correlation_id" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "job_id" VARCHAR(255);

UPDATE "public"."journal_entries"
SET
  "actor_user_id" = CASE
    WHEN "actor_user_id" IS NULL AND "user_id" ~ '^[0-9]+$' THEN "user_id"::INTEGER
    ELSE "actor_user_id"
  END,
  "event_type" = COALESCE(
    "event_type",
    CASE
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'TEST_PERSON'
        THEN 'TEST_PERSON_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'TEST_RESULTS'
        THEN 'TEST_RESULTS_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'TEST_LOGS'
        THEN 'TEST_LOGS_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'BOOKLET'
        THEN 'BOOKLET_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'UNIT'
        THEN 'UNIT_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        AND UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')) = 'RESPONSE'
        THEN 'RESPONSE_DELETED'
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'DELETE'
        THEN CONCAT(UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')), '_DELETED')
      WHEN UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_')) = 'RESET_VERSION'
        THEN 'CODING_VERSION_RESET'
      ELSE CONCAT(
        UPPER(REPLACE(REPLACE("entity_type", '-', '_'), ' ', '_')),
        '_',
        UPPER(REPLACE(REPLACE("action_type", '-', '_'), ' ', '_'))
      )
    END
  ),
  "summary" = COALESCE("summary", CONCAT("action_type", ' ', "entity_type", ' ', "entity_id"::TEXT))
WHERE "event_type" IS NULL
   OR "summary" IS NULL
   OR ("actor_user_id" IS NULL AND "user_id" ~ '^[0-9]+$');

ALTER TABLE "public"."journal_entries"
  ALTER COLUMN "entity_id" DROP NOT NULL,
  ALTER COLUMN "entity_id" TYPE VARCHAR(255)
  USING "entity_id"::TEXT;

CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_timestamp"
  ON "public"."journal_entries" ("workspace_id", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_event_type"
  ON "public"."journal_entries" ("workspace_id", "event_type");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_actor_user"
  ON "public"."journal_entries" ("workspace_id", "actor_user_id");
CREATE INDEX IF NOT EXISTS "idx_journal_entries_workspace_result"
  ON "public"."journal_entries" ("workspace_id", "result");

-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_result";
-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_actor_user";
-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_event_type";
-- rollback DROP INDEX IF EXISTS "public"."idx_journal_entries_workspace_timestamp";
-- rollback ALTER TABLE "public"."journal_entries" ALTER COLUMN "entity_id" TYPE INTEGER USING CASE WHEN "entity_id" ~ '^-?[0-9]+$' THEN "entity_id"::INTEGER ELSE 0 END;
-- rollback ALTER TABLE "public"."journal_entries" ALTER COLUMN "entity_id" SET NOT NULL;
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "job_id";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "correlation_id";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "summary";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "result";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "event_type";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "actor_type";
-- rollback ALTER TABLE "public"."journal_entries" DROP COLUMN IF EXISTS "actor_user_id";
