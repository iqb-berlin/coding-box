-- liquibase formatted sql

-- changeset jurei733:1
-- comment: Ensure IQB standard missings profile exists for job definition backfill

INSERT INTO "public"."missings_profile" ("label", "missings")
SELECT 'IQB-Standard',
       '[{"id":"mci","label":"missing coding impossible","description":"(1) Item müsste/könnte bearbeitet worden sein, aber (2) Antwort ist aufgrund technischer Probleme (z.B. Scanfehler) nicht auswertbar.","code":-97},{"id":"mir","label":"missing invalid response","description":"(1) Item wurde bearbeitet, aber (2a) leere Antwort oder (2b) ungültige (Spaß-)Antwort. Das Item wurde zwar bearbeitet, aber es wurde seitens der Testperson kein ernsthafter Lösungsversuch unternommen. Beispiel: Antworten wie \"kein Plan\", \"egal\", oder eine gemalte Sonne.","code":-98},{"id":"mbi_mbo","label":"mbi / mbo","description":"Item wurde nicht bearbeitet aber gesehen oder Item wurde nicht gesehen, aber es gibt nachfolgend gesehene oder bearbeitete Items.","code":-99}]'
WHERE NOT EXISTS (
  SELECT 1 FROM "public"."missings_profile" WHERE "label" = 'IQB-Standard'
);

-- rollback -- Cannot safely rollback idempotent default-profile creation without risking deletion of a pre-existing profile.

-- changeset jurei733:2
-- comment: Add missings profile reference to job definitions and backfill legacy rows

ALTER TABLE "public"."job_definitions"
  ADD COLUMN "missings_profile_id" INTEGER;

UPDATE "public"."job_definitions"
SET "missings_profile_id" = (
  SELECT "id"
  FROM "public"."missings_profile"
  WHERE "label" = 'IQB-Standard'
  ORDER BY "id"
  LIMIT 1
)
WHERE "missings_profile_id" IS NULL;

ALTER TABLE "public"."job_definitions"
  ADD CONSTRAINT "fk_job_definitions_missings_profile"
    FOREIGN KEY ("missings_profile_id") REFERENCES "public"."missings_profile"("id");

-- rollback ALTER TABLE "public"."job_definitions" DROP CONSTRAINT IF EXISTS "fk_job_definitions_missings_profile";
-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "missings_profile_id";

-- changeset jurei733:3
-- comment: Backfill legacy coding jobs that still use the implicit IQB standard missings profile

UPDATE "public"."coding_job"
SET "missings_profile_id" = (
  SELECT "id"
  FROM "public"."missings_profile"
  WHERE "label" = 'IQB-Standard'
  ORDER BY "id"
  LIMIT 1
)
WHERE "missings_profile_id" IS NULL;

-- rollback -- Cannot safely restore implicit default profile references after backfill.
