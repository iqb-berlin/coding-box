-- liquibase formatted sql

-- changeset jurei733:1
CREATE TABLE "public"."journal_entries" (
  "id" SERIAL PRIMARY KEY,
  "timestamp" TIMESTAMP NOT NULL DEFAULT NOW(),
  "user_id" VARCHAR(255) NOT NULL,
  "workspace_id" INTEGER NOT NULL,
  "action_type" VARCHAR(50) NOT NULL,
  "entity_type" VARCHAR(50) NOT NULL,
  "entity_id" INTEGER NOT NULL,
  "details" JSONB
);

CREATE INDEX "idx_journal_entries_workspace_id" ON "public"."journal_entries" ("workspace_id");
CREATE INDEX "idx_journal_entries_user_id" ON "public"."journal_entries" ("user_id");
CREATE INDEX "idx_journal_entries_action_type" ON "public"."journal_entries" ("action_type");
CREATE INDEX "idx_journal_entries_entity_type" ON "public"."journal_entries" ("entity_type");
CREATE INDEX "idx_journal_entries_timestamp" ON "public"."journal_entries" ("timestamp");

-- rollback DROP TABLE IF EXISTS "public"."journal_entries";
