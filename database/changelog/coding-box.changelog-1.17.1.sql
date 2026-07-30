-- liquibase formatted sql

-- changeset jurei733:813-1
-- comment: Extend the existing workspace revision with a coding-status revision
ALTER TABLE "public"."workspace_test_results_revision"
  ADD COLUMN IF NOT EXISTS "status_revision" BIGINT NOT NULL DEFAULT 0;

-- rollback ALTER TABLE "public"."workspace_test_results_revision" DROP COLUMN IF EXISTS "status_revision";

-- changeset jurei733:813-2
-- comment: Persist aggregated slow and failed HTTP requests for the server administration
CREATE TABLE "public"."request_monitoring_incident" (
  "id" SERIAL PRIMARY KEY,
  "fingerprint" CHAR(64) NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "method" VARCHAR(10) NOT NULL,
  "path" VARCHAR(500) NOT NULL,
  "workspace_id" INTEGER,
  "status_code" INTEGER,
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "max_duration_ms" INTEGER NOT NULL,
  "last_request_id" VARCHAR(128) NOT NULL,
  "last_error_message" VARCHAR(1000),
  "postgres_total_count" INTEGER,
  "postgres_idle_count" INTEGER,
  "postgres_waiting_count" INTEGER,
  "first_occurred_at" TIMESTAMPTZ NOT NULL,
  "last_occurred_at" TIMESTAMPTZ NOT NULL,
  "resolved_at" TIMESTAMPTZ,
  CONSTRAINT "uq_request_monitoring_incident_fingerprint" UNIQUE ("fingerprint"),
  CONSTRAINT "chk_request_monitoring_incident_kind"
    CHECK ("kind" IN ('slow', 'failed', 'in_flight', 'aborted', 'closed'))
);

CREATE INDEX "idx_request_monitoring_incident_open_last"
  ON "public"."request_monitoring_incident" ("resolved_at", "last_occurred_at" DESC);

-- rollback DROP TABLE "public"."request_monitoring_incident";
