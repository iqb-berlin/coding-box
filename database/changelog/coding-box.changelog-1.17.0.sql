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
