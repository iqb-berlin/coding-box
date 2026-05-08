-- liquibase formatted sql

-- changeset codex:1
-- comment: Remove orphaned unit notes before enforcing cascade cleanup
DELETE FROM "public"."unit_note" note
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."unit" unit_row
  WHERE unit_row."id" = note."unitId"
);
-- rollback SELECT 1;

-- changeset codex:2
-- comment: Ensure unit notes are deleted with their unit at database level
ALTER TABLE "public"."unit_note"
  ADD CONSTRAINT "FK_unit_note_unit"
  FOREIGN KEY ("unitId")
  REFERENCES "public"."unit" ("id")
  ON DELETE CASCADE
  ON UPDATE NO ACTION;
-- rollback ALTER TABLE "public"."unit_note" DROP CONSTRAINT IF EXISTS "FK_unit_note_unit";
