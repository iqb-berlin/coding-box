-- liquibase formatted sql

-- changeset jurei733:1
ALTER TABLE "public"."replay_statistics"
  ADD COLUMN "client_timings" JSONB NULL;

-- rollback ALTER TABLE "public"."replay_statistics" DROP COLUMN "client_timings";
