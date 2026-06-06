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

-- changeset jurei733:4
-- comment: Store stable distribution snapshots on job definitions

ALTER TABLE "public"."job_definitions"
  ADD COLUMN "distribution_snapshots" JSONB NULL;

-- rollback ALTER TABLE "public"."job_definitions" DROP COLUMN IF EXISTS "distribution_snapshots";

-- changeset jurei733:5
-- comment: Persist DERIVE_ERROR opt-in for coder-training variables

ALTER TABLE "public"."coder_training_variable"
  ADD COLUMN IF NOT EXISTS "include_derive_error" BOOLEAN NOT NULL DEFAULT FALSE;

-- rollback ALTER TABLE "public"."coder_training_variable" DROP COLUMN IF EXISTS "include_derive_error";

-- changeset jurei733:6
-- comment: Scope missings profiles to workspaces

ALTER TABLE "public"."missings_profile"
  ADD COLUMN "workspace_id" INTEGER;

ALTER TABLE "public"."missings_profile"
  DROP CONSTRAINT IF EXISTS "missings_profile_label_key";

WITH missings_profile_scopes AS (
  SELECT "id" AS "workspace_id"
  FROM "public"."workspace"
  UNION
  SELECT "workspace_id"
  FROM "public"."coding_job"
  WHERE "missings_profile_id" IS NOT NULL
  UNION
  SELECT "workspace_id"
  FROM "public"."job_definitions"
  WHERE "missings_profile_id" IS NOT NULL
)
INSERT INTO "public"."missings_profile" ("workspace_id", "label", "missings")
SELECT scopes."workspace_id", mp."label", mp."missings"
FROM missings_profile_scopes scopes
CROSS JOIN "public"."missings_profile" mp
WHERE mp."workspace_id" IS NULL;

UPDATE "public"."coding_job" cj
SET "missings_profile_id" = scoped."id"
FROM "public"."missings_profile" global_profile,
     "public"."missings_profile" scoped
WHERE cj."missings_profile_id" = global_profile."id"
  AND global_profile."workspace_id" IS NULL
  AND scoped."workspace_id" = cj."workspace_id"
  AND scoped."label" = global_profile."label";

UPDATE "public"."job_definitions" jd
SET "missings_profile_id" = scoped."id"
FROM "public"."missings_profile" global_profile,
     "public"."missings_profile" scoped
WHERE jd."missings_profile_id" = global_profile."id"
  AND global_profile."workspace_id" IS NULL
  AND scoped."workspace_id" = jd."workspace_id"
  AND scoped."label" = global_profile."label";

DELETE FROM "public"."missings_profile"
WHERE "workspace_id" IS NULL;

ALTER TABLE "public"."missings_profile"
  ALTER COLUMN "workspace_id" SET NOT NULL;

ALTER TABLE "public"."missings_profile"
  ADD CONSTRAINT "uq_missings_profile_workspace_label"
    UNIQUE ("workspace_id", "label");

-- rollback ALTER TABLE "public"."missings_profile" DROP CONSTRAINT IF EXISTS "uq_missings_profile_workspace_label";
-- rollback ALTER TABLE "public"."missings_profile" DROP COLUMN IF EXISTS "workspace_id";
-- rollback -- Cannot safely restore the previous global label uniqueness after profiles have been duplicated per workspace.
