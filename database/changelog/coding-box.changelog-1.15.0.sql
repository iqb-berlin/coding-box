-- liquibase formatted sql

-- changeset jurei733:1
ALTER TABLE "public"."replay_statistics"
  ADD COLUMN "client_timings" JSONB NULL;

ALTER TABLE "public"."replay_statistics"
  ADD COLUMN "server_timings" JSONB NULL;

-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN "server_timings";
-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN "client_timings";
